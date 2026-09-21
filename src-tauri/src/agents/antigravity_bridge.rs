//! Loopback adapter for the desktop's Cloud Code transport.
//! Account/login calls retain Google's authentication; inference uses CPA only.

use axum::{
    body::{to_bytes, Body, Bytes},
    extract::{Request, State},
    http::{header, Method, Response, StatusCode},
    Router,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    io,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

const MAX_BODY: usize = 32 * 1024 * 1024;
const MAX_EVENT: usize = 4 * 1024 * 1024;
const GOOGLE_ENDPOINT: &str = "https://daily-cloudcode-pa.googleapis.com";

#[derive(Clone)]
pub(super) struct RouteConfig {
    pub port: u16,
    pub key: String,
    pub model: String,
}

pub(super) struct Bridge {
    pub endpoint: String,
    state: Arc<BridgeState>,
    stop: CancellationToken,
}

struct BridgeState {
    prefix: String,
    route: Mutex<RouteConfig>,
    local: reqwest::Client,
    google: reqwest::Client,
    google_endpoint: String,
    stop: CancellationToken,
    stats: Mutex<BridgeStats>,
}

#[derive(Default, Clone)]
pub(super) struct BridgeStats {
    pub inference_requests: u64,
    pub completed_responses: u64,
    pub last_error: Option<String>,
}

impl Bridge {
    pub async fn start(route: RouteConfig) -> Result<Self, String> {
        Self::start_with_google(route, GOOGLE_ENDPOINT.to_owned()).await
    }

    async fn start_with_google(
        route: RouteConfig,
        google_endpoint: String,
    ) -> Result<Self, String> {
        validate_route(&route)?;
        let mut secret = [0u8; 24];
        getrandom::fill(&mut secret).map_err(|_| "Unable to create desktop bridge session")?;
        let prefix = format!(
            "/{}/",
            secret
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "Unable to bind Antigravity desktop bridge")?;
        let address = listener
            .local_addr()
            .map_err(|_| "Unable to read desktop bridge address")?;
        let stop = CancellationToken::new();
        let local = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| "Unable to initialize CPA transport")?;
        let google = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Unable to initialize desktop account transport")?;
        let state = Arc::new(BridgeState {
            prefix: prefix.clone(),
            route: Mutex::new(route),
            local,
            google,
            google_endpoint,
            stop: stop.clone(),
            stats: Mutex::new(BridgeStats::default()),
        });
        let router = Router::new().fallback(handle).with_state(state.clone());
        let shutdown = stop.clone();
        let server_state = state.clone();
        tokio::spawn(async move {
            if axum::serve(listener, router)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
                .is_err()
            {
                server_state.fail("Desktop bridge listener stopped");
            }
        });
        Ok(Self {
            endpoint: format!("http://{address}{}", prefix.trim_end_matches('/')),
            state,
            stop,
        })
    }

    pub fn update(&self, route: RouteConfig) -> Result<(), String> {
        validate_route(&route)?;
        *self
            .state
            .route
            .lock()
            .map_err(|_| "Desktop route lock is poisoned")? = route;
        Ok(())
    }

    pub fn stats(&self) -> BridgeStats {
        self.state
            .stats
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

fn validate_route(route: &RouteConfig) -> Result<(), String> {
    if route.port == 0 || route.key.trim().is_empty() || route.key.chars().any(char::is_control) {
        return Err("Invalid CPA connection settings".to_owned());
    }
    if route.model.is_empty()
        || route.model.len() > 200
        || !route
            .model
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        || !route.model.as_bytes()[0].is_ascii_alphanumeric()
    {
        return Err("Unsupported Antigravity model identifier".to_owned());
    }
    Ok(())
}

impl BridgeState {
    fn fail(&self, message: &str) {
        if let Ok(mut stats) = self.stats.lock() {
            stats.last_error = Some(message.to_owned());
        }
    }
    fn complete(&self) {
        if let Ok(mut stats) = self.stats.lock() {
            stats.completed_responses += 1;
            stats.last_error = None;
        }
    }
}

fn error(status: StatusCode, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"error":{"code":status.as_u16(),"message":message}}).to_string(),
        ))
        .unwrap()
}

fn control_method(method: &str) -> bool {
    matches!(
        method,
        "loadCodeAssist"
            | "onboardUser"
            | "fetchAvailableModels"
            | "fetchUserInfo"
            | "getUserStatus"
            | "fetchUserStatus"
            | "fetchUserTier"
            | "retrieveUserQuota"
            | "getUserTier"
            | "fetchModelConfigs"
            | "fetchMcpServerConfigs"
            | "fetchMcpServers"
            | "recordCodeAssistMetrics"
            | "logClientError"
            | "recordJesiMetrics"
            | "getCodeAssistSettings"
            | "fetchAdminControls"
            | "fetchCodeCustomizationState"
            | "getCodeAssistGlobalUserSetting"
            | "listModelConfigs"
            | "listExperiments"
            | "listCloudAICompanionProjects"
            | "retrieveUserQuotaSummary"
            | "checkUrlDenylist"
            | "checkUrlAntivirus"
            | "fetchFromTrawlerCache"
            | "searchSnippets"
            | "writeTrajectoryAcls"
            | "recordTrajectoryAnalytics"
            | "recordClientEvent"
    )
}

async fn handle(State(state): State<Arc<BridgeState>>, request: Request) -> Response<Body> {
    // A random per-process path authenticates this loopback listener. Browser
    // origins are never accepted; the native language server is the caller.
    if request.headers().contains_key(header::ORIGIN) {
        return error(StatusCode::FORBIDDEN, "Browser requests are not accepted");
    }
    let Some(path) = request.uri().path().strip_prefix(&state.prefix) else {
        return error(StatusCode::NOT_FOUND, "Unknown desktop bridge session");
    };
    // The desktop also fetches its plugin catalog using REST collection routes.
    // Keep these read-only requests on Google's authenticated control plane.
    let collection = matches!(
        path,
        "v1internal/agentPlugins" | "v1internal/buildWithGooglePlugins"
    );
    let Some(method) = path
        .strip_prefix("v1internal:")
        .or_else(|| collection.then_some(path))
    else {
        return error(StatusCode::NOT_FOUND, "Unknown Cloud Code route");
    };
    let method = method.to_owned();
    let expected_method = if collection {
        Method::GET
    } else {
        Method::POST
    };
    if request.method() != expected_method {
        return error(
            StatusCode::METHOD_NOT_ALLOWED,
            "Unexpected Cloud Code HTTP method",
        );
    }
    let inference = matches!(
        method.as_str(),
        "generateContent" | "streamGenerateContent" | "countTokens"
    );
    if !inference && !collection && !control_method(&method) {
        if method.len() <= 64 && method.bytes().all(|b| b.is_ascii_alphabetic()) {
            state.fail(&format!("Unsupported desktop Cloud Code method: {method}"));
        } else {
            state.fail("Unsupported desktop Cloud Code method");
        }
        return error(
            StatusCode::NOT_IMPLEMENTED,
            "Unsupported desktop Cloud Code method",
        );
    }
    let query = request.uri().query().unwrap_or("").to_owned();
    if (collection && query.len() > 4096)
        || (!collection && !query.is_empty() && query != "alt=sse" && query != "alt=json")
    {
        return error(StatusCode::BAD_REQUEST, "Unsupported Cloud Code query");
    }
    let (parts, body) = request.into_parts();
    let bytes = match tokio::time::timeout(Duration::from_secs(30), to_bytes(body, MAX_BODY)).await
    {
        Ok(Ok(bytes)) => bytes,
        _ => {
            return error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Request body is too large or incomplete",
            )
        }
    };
    if !inference {
        let Some(auth) = parts.headers.get(header::AUTHORIZATION) else {
            return error(StatusCode::UNAUTHORIZED, "Sign in to Antigravity first");
        };
        if !auth
            .to_str()
            .is_ok_and(|v| v.starts_with("Bearer ") && v.len() > 7)
        {
            return error(
                StatusCode::UNAUTHORIZED,
                "Expected desktop account authentication",
            );
        }
        let url = if collection {
            format!(
                "{}/{method}{}",
                state.google_endpoint,
                if query.is_empty() {
                    String::new()
                } else {
                    format!("?{query}")
                }
            )
        } else {
            format!("{}/v1internal:{method}", state.google_endpoint)
        };
        let mut upstream = state
            .google
            .request(expected_method, url)
            .body(bytes)
            .header(header::CONTENT_TYPE, "application/json");
        for name in [
            "authorization",
            "user-agent",
            "x-goog-api-client",
            "x-goog-user-project",
            "accept",
        ] {
            if let Some(value) = parts.headers.get(name) {
                upstream = upstream.header(name, value);
            }
        }
        return forward_control(state, upstream).await;
    }
    let route = match state.route.lock() {
        Ok(route) => route.clone(),
        Err(_) => {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Desktop route is unavailable",
            )
        }
    };
    let body = match prepare_request(&bytes, &method) {
        Ok(body) => body,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };
    let stream = method == "streamGenerateContent";
    let url = format!(
        "http://127.0.0.1:{}/v1beta/models/{}:{method}{}",
        route.port,
        route.model,
        if stream { "?alt=sse" } else { "" }
    );
    // Never copy the incoming Google OAuth token, project, cookies or headers
    // to CPA. CPA owns upstream credentials and account selection.
    let upstream = state
        .local
        .post(url)
        .header("x-goog-api-key", &route.key)
        .json(&body);
    if let Ok(mut stats) = state.stats.lock() {
        stats.inference_requests += 1;
    }
    let response = tokio::select! {
        _ = state.stop.cancelled() => return error(StatusCode::SERVICE_UNAVAILABLE, "Desktop bridge stopped"),
        result = tokio::time::timeout(Duration::from_secs(120), upstream.send()) => match result {
            Ok(Ok(response)) => response,
            _ => { state.fail("CPA did not respond"); return error(StatusCode::BAD_GATEWAY, "CPA did not respond"); }
        }
    };
    let status = response.status();
    if !status.is_success() {
        state.fail(&format!("CPA returned HTTP {}", status.as_u16()));
        return bounded_response(response).await;
    }
    if stream {
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        if !content_type.starts_with("text/event-stream") {
            state.fail("CPA returned an unexpected streaming content type");
            return error(
                StatusCode::BAD_GATEWAY,
                "CPA did not return an event stream",
            );
        }
        let mut upstream = response.bytes_stream();
        let output = async_stream::try_stream! {
            let mut decoder = SseDecoder::default();
            let mut finished = false;
            loop {
                let next = tokio::select! {
                    _ = state.stop.cancelled() => Err(io::Error::other("Desktop bridge stopped")),
                    result = tokio::time::timeout(Duration::from_secs(120), upstream.next()) =>
                        result.map_err(|_| io::Error::other("CPA stream timed out")),
                };
                let next = next?;
                match next {
                    Some(Ok(chunk)) => {
                        for event in decoder.push(&chunk)? {
                            finished |= event.finished;
                            yield Bytes::from(event.bytes);
                        }
                    }
                    Some(Err(_)) => { state.fail("CPA stream disconnected"); Err(io::Error::other("CPA stream disconnected"))?; }
                    None => break,
                }
            }
            decoder.finish()?;
            if finished { state.complete(); }
            else { state.fail("CPA stream ended without a completion"); Err(io::Error::other("Incomplete CPA stream"))?; }
        };
        // Body owns the generator/reqwest response: disconnecting the desktop
        // drops them and cancels further upstream reads without a detached task.
        let body = Body::from_stream::<
            std::pin::Pin<Box<dyn futures_util::Stream<Item = Result<Bytes, io::Error>> + Send>>,
        >(Box::pin(output));
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(body)
            .unwrap();
    }
    let bytes = match read_bounded(response).await {
        Ok(bytes) => bytes,
        Err(()) => return error(StatusCode::BAD_GATEWAY, "Invalid CPA response"),
    };
    let response = serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| {
        if method == "countTokens" {
            v.get("totalTokens")
                .and_then(Value::as_u64)
                .map(|_| v.clone())
        } else {
            wrap_response(v).ok()
        }
    });
    match response {
        Some(value) => {
            if method != "countTokens" && terminal_response(&value) {
                state.complete();
            }
            Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(value.to_string()))
                .unwrap()
        }
        None => {
            state.fail("Invalid CPA response");
            error(StatusCode::BAD_GATEWAY, "Invalid CPA response")
        }
    }
}

fn prepare_request(bytes: &[u8], method: &str) -> Result<Value, &'static str> {
    let mut envelope: Value =
        serde_json::from_slice(bytes).map_err(|_| "Invalid Cloud Code JSON")?;
    let body = envelope
        .get_mut("request")
        .filter(|v| v.is_object())
        .ok_or("Missing Cloud Code request")?
        .take();
    if method == "countTokens" {
        // The countTokens contract is passed through as a Gemini request body;
        // callers already supply contents/generateContentRequest in request.
        return Ok(body);
    }
    if !envelope
        .get("model")
        .is_some_and(|v| v.as_str().is_some_and(|s| !s.is_empty()))
    {
        return Err("Missing Cloud Code model");
    }
    if body.get("model").is_some() {
        return Err("Unexpected nested model");
    }
    Ok(body)
}

fn wrap_response(value: Value) -> Result<Value, &'static str> {
    if !value.is_object() || value.get("response").is_some() {
        return Err("Invalid Gemini response");
    }
    if value.get("error").is_some() {
        return Ok(value);
    }
    if [
        "candidates",
        "usageMetadata",
        "cpaUsageMetadata",
        "promptFeedback",
        "totalTokens",
    ]
    .iter()
    .any(|key| value.get(*key).is_some())
    {
        Ok(json!({"response":value}))
    } else {
        Err("Unknown Gemini response")
    }
}

fn terminal_response(value: &Value) -> bool {
    let response = value.get("response").unwrap_or(value);
    response
        .get("promptFeedback")
        .and_then(|v| v.get("blockReason"))
        .is_some()
        || response
            .get("candidates")
            .and_then(Value::as_array)
            .is_some_and(|values| {
                values.iter().any(|v| {
                    v.get("finishReason")
                        .and_then(Value::as_str)
                        .is_some_and(|s| !s.is_empty())
                })
            })
}

async fn forward_control(
    state: Arc<BridgeState>,
    request: reqwest::RequestBuilder,
) -> Response<Body> {
    tokio::select! {
        _ = state.stop.cancelled() => error(StatusCode::SERVICE_UNAVAILABLE, "Desktop bridge stopped"),
        result = request.timeout(Duration::from_secs(45)).send() => match result {
            Ok(response) => bounded_response(response).await,
            Err(_) => { state.fail("Desktop account service is unavailable"); error(StatusCode::BAD_GATEWAY, "Desktop account service is unavailable") }
        }
    }
}

async fn read_bounded(response: reqwest::Response) -> Result<Vec<u8>, ()> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(45), stream.next())
        .await
        .map_err(|_| ())?
    {
        let chunk = chunk.map_err(|_| ())?;
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn bounded_response(response: reqwest::Response) -> Response<Body> {
    let status = response.status();
    let content_type = response.headers().get(header::CONTENT_TYPE).cloned();
    let retry_after = response.headers().get(header::RETRY_AFTER).cloned();
    match read_bounded(response).await {
        Ok(bytes) => {
            let mut output = Response::builder().status(status);
            if let Some(value) = content_type {
                output = output.header(header::CONTENT_TYPE, value);
            }
            if let Some(value) = retry_after {
                output = output.header(header::RETRY_AFTER, value);
            }
            output.body(Body::from(bytes)).unwrap()
        }
        Err(()) => error(
            StatusCode::BAD_GATEWAY,
            "Upstream response is incomplete or too large",
        ),
    }
}

#[derive(Default)]
struct SseDecoder {
    pending: Vec<u8>,
    event: Vec<String>,
    event_bytes: usize,
}
struct SseEvent {
    bytes: Vec<u8>,
    finished: bool,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> io::Result<Vec<SseEvent>> {
        let mut result = Vec::new();
        // Process per byte to bound the current event even when one HTTP chunk
        // contains many events. UTF-8 is decoded only after a full line arrives.
        for byte in bytes {
            self.event_bytes += 1;
            if self.event_bytes > MAX_EVENT {
                return Err(io::Error::other("SSE event is too large"));
            }
            if *byte != b'\n' {
                self.pending.push(*byte);
                continue;
            }
            let mut line = std::mem::take(&mut self.pending);
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            let line = String::from_utf8(line)
                .map_err(|_| io::Error::other("Invalid UTF-8 in CPA stream"))?;
            if line.is_empty() {
                if !self.event.is_empty() {
                    result.push(self.translate()?);
                }
                self.event.clear();
                self.event_bytes = 0;
            } else {
                self.event.push(line);
            }
        }
        Ok(result)
    }

    fn translate(&self) -> io::Result<SseEvent> {
        let data: Vec<&str> = self
            .event
            .iter()
            .filter_map(|line| {
                if line == "data" {
                    Some("")
                } else {
                    line.strip_prefix("data:")
                        .map(|s| s.strip_prefix(' ').unwrap_or(s))
                }
            })
            .collect();
        if data.is_empty() {
            return Ok(SseEvent {
                bytes: format!("{}\n\n", self.event.join("\n")).into_bytes(),
                finished: false,
            });
        }
        let raw: Value = serde_json::from_str(&data.join("\n"))
            .map_err(|_| io::Error::other("Invalid CPA stream event"))?;
        let wrapped = wrap_response(raw).map_err(io::Error::other)?;
        if wrapped.get("error").is_some() {
            return Err(io::Error::other("CPA returned a streaming error"));
        }
        let finished = terminal_response(&wrapped);
        let mut inserted = false;
        let mut lines = Vec::new();
        for line in &self.event {
            if line == "data" || line.starts_with("data:") {
                if !inserted {
                    lines.push(format!("data: {wrapped}"));
                    inserted = true;
                }
            } else {
                lines.push(line.clone());
            }
        }
        Ok(SseEvent {
            bytes: format!("{}\n\n", lines.join("\n")).into_bytes(),
            finished,
        })
    }

    fn finish(&self) -> io::Result<()> {
        if self.pending.is_empty() && self.event.is_empty() {
            Ok(())
        } else {
            Err(io::Error::other("Truncated CPA stream event"))
        }
    }
}

#[cfg(test)]
#[path = "antigravity_bridge_tests.rs"]
mod tests;
