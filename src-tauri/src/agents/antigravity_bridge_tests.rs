use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone)]
struct Captured {
    path: String,
    headers: axum::http::HeaderMap,
    body: Value,
}
struct MockServer {
    port: u16,
    requests: Arc<Mutex<Vec<Captured>>>,
    stop: CancellationToken,
}
impl Drop for MockServer {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

async fn mock_server(
    status: StatusCode,
    content_type: &'static str,
    payload: Vec<u8>,
) -> MockServer {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let captured = requests.clone();
    let app = Router::new().fallback(move |request: Request| {
        let captured = captured.clone();
        let payload = payload.clone();
        async move {
            let (parts, body) = request.into_parts();
            let bytes = to_bytes(body, MAX_BODY).await.unwrap();
            captured.lock().unwrap().push(Captured {
                path: parts.uri.to_string(),
                headers: parts.headers,
                body: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
            });
            let chunks: Vec<Result<Bytes, io::Error>> = payload
                .chunks(7)
                .map(|b| Ok(Bytes::copy_from_slice(b)))
                .collect();
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, content_type)
                .body(Body::from_stream(futures_util::stream::iter(chunks)))
                .unwrap()
        }
    });
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let stop = CancellationToken::new();
    let shutdown = stop.clone();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown.cancelled_owned())
            .await
            .unwrap();
    });
    MockServer {
        port,
        requests,
        stop,
    }
}

fn route(port: u16) -> RouteConfig {
    RouteConfig {
        port,
        key: "synthetic-cpa-key".to_owned(),
        model: "gemini-test-high".to_owned(),
    }
}
fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}
fn envelope() -> Value {
    json!({"model":"native-default","project":"synthetic-project","request":{
        "contents":[{"role":"model","parts":[{"functionCall":{"name":"read_fixture","args":{}},"thoughtSignature":"synthetic-signature"}]}],
        "tools":[{"functionDeclarations":[{"name":"read_fixture","parameters":{"type":"OBJECT","additionalProperties":false}}]}]
    }})
}
fn completion() -> Value {
    json!({"candidates":[{"content":{"role":"model","parts":[{"text":"Xin chào"}]},"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":7}})
}

#[tokio::test]
async fn antigravity_bridge_desktop_catalog_and_analytics_keep_native_auth() {
    let google = mock_server(StatusCode::OK, "application/json", b"{}".to_vec()).await;
    let cpa = mock_server(StatusCode::OK, "application/json", b"{}".to_vec()).await;
    let bridge =
        Bridge::start_with_google(route(cpa.port), format!("http://127.0.0.1:{}", google.port))
            .await
            .unwrap();
    for path in [
        "v1internal/agentPlugins?page_size=1000",
        "v1internal/buildWithGooglePlugins?page_size=1000&page_token=fixture",
    ] {
        let response = client()
            .get(format!("{}/{path}", bridge.endpoint))
            .bearer_auth("synthetic-google-token")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let rejected = client()
            .post(format!("{}/{path}", bridge.endpoint))
            .bearer_auth("synthetic-google-token")
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::METHOD_NOT_ALLOWED);
    }
    for method in [
        "writeTrajectoryAcls",
        "recordTrajectoryAnalytics",
        "recordClientEvent",
    ] {
        let response = client()
            .post(format!("{}/v1internal:{method}", bridge.endpoint))
            .bearer_auth("synthetic-google-token")
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    let requests = google.requests.lock().unwrap();
    assert_eq!(requests.len(), 5);
    assert_eq!(requests[0].path, "/v1internal/agentPlugins?page_size=1000");
    assert_eq!(
        requests[1].path,
        "/v1internal/buildWithGooglePlugins?page_size=1000&page_token=fixture"
    );
    for request in requests.iter() {
        assert_eq!(
            request.headers["authorization"],
            "Bearer synthetic-google-token"
        );
        assert!(!request.headers.contains_key("x-goog-api-key"));
    }
    assert!(cpa.requests.lock().unwrap().is_empty());
    assert_eq!(bridge.stats().completed_responses, 0);
    assert!(bridge.stats().last_error.is_none());
}

#[tokio::test]
async fn antigravity_bridge_real_http_inference_uses_cpa_key_and_selected_model() {
    let mock = mock_server(
        StatusCode::OK,
        "application/json",
        completion().to_string().into_bytes(),
    )
    .await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let input = envelope();
    let response = client()
        .post(format!("{}/v1internal:generateContent", bridge.endpoint))
        .bearer_auth("synthetic-google-token")
        .header("cookie", "synthetic-cookie")
        .json(&input)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.json::<Value>().await.unwrap(),
        json!({"response":completion()})
    );
    let requests = mock.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].path,
        "/v1beta/models/gemini-test-high:generateContent"
    );
    assert_eq!(requests[0].body, input["request"]);
    assert_eq!(requests[0].headers["x-goog-api-key"], "synthetic-cpa-key");
    assert!(!requests[0].headers.contains_key("authorization"));
    assert!(!requests[0].headers.contains_key("cookie"));
    assert_eq!(bridge.stats().completed_responses, 1);
}

#[tokio::test]
async fn antigravity_bridge_control_plane_keeps_google_auth_separate() {
    let google = mock_server(
        StatusCode::OK,
        "application/json",
        br#"{"currentTier":{"id":"fixture"}}"#.to_vec(),
    )
    .await;
    let cpa = mock_server(StatusCode::OK, "application/json", b"{}".to_vec()).await;
    let bridge =
        Bridge::start_with_google(route(cpa.port), format!("http://127.0.0.1:{}", google.port))
            .await
            .unwrap();
    let response = client()
        .post(format!("{}/v1internal:loadCodeAssist", bridge.endpoint))
        .bearer_auth("synthetic-google-token")
        .header("x-goog-api-key", "must-not-forward")
        .json(&json!({"metadata":{"ideType":"fixture"}}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.json::<Value>().await.unwrap()["currentTier"]["id"],
        "fixture"
    );
    let requests = google.requests.lock().unwrap();
    assert_eq!(
        requests[0].headers["authorization"],
        "Bearer synthetic-google-token"
    );
    assert!(!requests[0].headers.contains_key("x-goog-api-key"));
    assert!(cpa.requests.lock().unwrap().is_empty());
    assert_eq!(bridge.stats().inference_requests, 0);
}

#[tokio::test]
async fn antigravity_bridge_requires_session_path_and_rejects_browser_and_unknown_routes() {
    let mock = mock_server(StatusCode::OK, "application/json", b"{}".to_vec()).await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let root = bridge.endpoint.rsplit_once('/').unwrap().0;
    for (url, origin, expected) in [
        (
            format!("{root}/v1internal:generateContent"),
            false,
            StatusCode::NOT_FOUND,
        ),
        (
            format!("{}/v1internal:generateContent", bridge.endpoint),
            true,
            StatusCode::FORBIDDEN,
        ),
        (
            format!("{}/v1internal:unknownMethod", bridge.endpoint),
            false,
            StatusCode::NOT_IMPLEMENTED,
        ),
        (
            format!("{}/v1internal:loadCodeAssist", bridge.endpoint),
            false,
            StatusCode::UNAUTHORIZED,
        ),
        (
            format!(
                "{}/v1internal:generateContent?target=elsewhere",
                bridge.endpoint
            ),
            false,
            StatusCode::BAD_REQUEST,
        ),
    ] {
        let mut request = client().post(url).json(&envelope());
        if origin {
            request = request.header("origin", "https://example.invalid");
        }
        assert_eq!(request.send().await.unwrap().status(), expected);
    }
    assert!(mock.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn antigravity_bridge_cpa_http_errors_are_not_successes() {
    let payload = br#"{"error":{"code":429,"message":"Synthetic quota error"}}"#.to_vec();
    let mock = mock_server(
        StatusCode::TOO_MANY_REQUESTS,
        "application/json",
        payload.clone(),
    )
    .await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let response = client()
        .post(format!("{}/v1internal:generateContent", bridge.endpoint))
        .json(&envelope())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.bytes().await.unwrap().as_ref(), payload);
    assert_eq!(bridge.stats().completed_responses, 0);
    assert_eq!(
        bridge.stats().last_error.as_deref(),
        Some("CPA returned HTTP 429")
    );
}

#[tokio::test]
async fn antigravity_bridge_streams_terminal_response_and_updates_model_without_rebinding() {
    let payload = format!(": keepalive\r\n\r\ndata: {}\r\n\r\n", completion());
    let mock = mock_server(StatusCode::OK, "text/event-stream", payload.into_bytes()).await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let mut updated = route(mock.port);
    updated.model = "gemini-another".to_owned();
    bridge.update(updated).unwrap();
    let response = client()
        .post(format!(
            "{}/v1internal:streamGenerateContent?alt=sse",
            bridge.endpoint
        ))
        .json(&envelope())
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    let text = response.text().await.unwrap();
    assert!(text.starts_with(": keepalive\n\n"));
    let wrapped: Value = serde_json::from_str(text.split_once("data: ").unwrap().1.trim()).unwrap();
    assert_eq!(wrapped, json!({"response":completion()}));
    assert_eq!(
        mock.requests.lock().unwrap()[0].path,
        "/v1beta/models/gemini-another:streamGenerateContent?alt=sse"
    );
    assert_eq!(bridge.stats().completed_responses, 1);
}

#[test]
fn antigravity_bridge_sse_survives_all_byte_boundaries_and_preserves_tool_signatures() {
    let response = json!({"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_fixture","args":{"text":"Chào anh"}},"thoughtSignature":"synthetic-signature"}]},"finishReason":"STOP"}]});
    let wire = format!("id: fixture\r\ndata: {response}\r\n\r\n").into_bytes();
    for boundary in 0..=wire.len() {
        let mut decoder = SseDecoder::default();
        let mut events = decoder.push(&wire[..boundary]).unwrap();
        events.extend(decoder.push(&wire[boundary..]).unwrap());
        decoder.finish().unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].finished);
        let text = std::str::from_utf8(&events[0].bytes).unwrap();
        let actual: Value =
            serde_json::from_str(text.split_once("data: ").unwrap().1.trim()).unwrap();
        assert_eq!(actual, json!({"response":response}));
    }
}

#[test]
fn antigravity_bridge_sse_rejects_invalid_truncated_and_oversized_events() {
    for wire in [
        b"data: nope\n\n".as_slice(),
        b"data: [DONE]\n\n",
        b"data: \xff\n\n",
        b"data: {}\n\n",
    ] {
        assert!(SseDecoder::default().push(wire).is_err());
    }
    let mut decoder = SseDecoder::default();
    decoder.push(b"data: {\"candidates\":[]}").unwrap();
    assert!(decoder.finish().is_err());
    assert!(SseDecoder::default()
        .push(&vec![b'x'; MAX_EVENT + 1])
        .is_err());
}

#[tokio::test]
async fn antigravity_bridge_incomplete_stream_is_not_counted_as_completed() {
    let mock = mock_server(
        StatusCode::OK,
        "text/event-stream",
        b"data: {\"candidates\":[]}\n\n".to_vec(),
    )
    .await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let result = client()
        .post(format!(
            "{}/v1internal:streamGenerateContent",
            bridge.endpoint
        ))
        .json(&envelope())
        .send()
        .await;
    if let Ok(response) = result {
        assert!(response.bytes().await.is_err());
    }
    assert_eq!(bridge.stats().completed_responses, 0);
    assert_eq!(
        bridge.stats().last_error.as_deref(),
        Some("CPA stream ended without a completion")
    );
}

struct DropSignal(Arc<AtomicBool>);
impl Drop for DropSignal {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn antigravity_bridge_client_disconnect_cancels_upstream_stream() {
    let dropped = Arc::new(AtomicBool::new(false));
    let tracked = dropped.clone();
    let app = Router::new().fallback(move || {
        let tracked = tracked.clone();
        async move {
            let stream = async_stream::stream! {
                let _guard = DropSignal(tracked);
                yield Ok::<_, io::Error>(Bytes::from_static(b"data: {\"candidates\":[]}\n\n"));
                std::future::pending::<()>().await;
            };
            Response::builder()
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from_stream(stream))
                .unwrap()
        }
    });
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let bridge = Bridge::start(route(port)).await.unwrap();
    let response = client()
        .post(format!(
            "{}/v1internal:streamGenerateContent",
            bridge.endpoint
        ))
        .json(&envelope())
        .send()
        .await
        .unwrap();
    let mut stream = response.bytes_stream();
    stream.next().await.unwrap().unwrap();
    drop(stream);
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        while !dropped.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    server.abort();
    assert!(
        result.is_ok(),
        "upstream body survived a disconnected desktop"
    );
    assert_eq!(bridge.stats().completed_responses, 0);
}

#[test]
fn antigravity_bridge_rejects_invalid_route_and_does_not_mutate_request() {
    for model in [
        "",
        "../private",
        "model?key=private",
        "model\r\nheader",
        " model",
    ] {
        let mut config = route(8317);
        config.model = model.to_owned();
        assert!(validate_route(&config).is_err());
    }
    let input = envelope();
    let bytes = serde_json::to_vec(&input).unwrap();
    assert_eq!(
        prepare_request(&bytes, "generateContent").unwrap(),
        input["request"]
    );
    assert_eq!(serde_json::from_slice::<Value>(&bytes).unwrap(), input);
}

#[tokio::test]
async fn antigravity_bridge_count_tokens_preserves_its_distinct_response_contract() {
    let mock = mock_server(
        StatusCode::OK,
        "application/json",
        br#"{"totalTokens":17}"#.to_vec(),
    )
    .await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let response = client()
        .post(format!("{}/v1internal:countTokens", bridge.endpoint))
        .json(&envelope())
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.json::<Value>().await.unwrap(),
        json!({"totalTokens":17})
    );
    assert_eq!(bridge.stats().completed_responses, 0);
}

#[tokio::test]
async fn antigravity_bridge_drop_closes_its_listener() {
    let mock = mock_server(
        StatusCode::OK,
        "application/json",
        completion().to_string().into_bytes(),
    )
    .await;
    let bridge = Bridge::start(route(mock.port)).await.unwrap();
    let endpoint = bridge.endpoint.clone();
    drop(bridge);
    let stopped = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if client()
                .post(format!("{endpoint}/v1internal:generateContent"))
                .json(&envelope())
                .send()
                .await
                .is_err()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    assert!(stopped.is_ok());
}
