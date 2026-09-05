#[cfg(target_os = "windows")]
use super::windows_explorer_executable;
use super::{
    auth_dir_path_for_core, configure_background_command, core_install_dir,
    is_hashed_management_secret_key, open_oauth_url_inner, path_to_string, truncate_for_error,
    GuiConfigFile, GuiConfigState,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthStartResult {
    url: String,
    state: Option<String>,
    opened: bool,
    open_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthStatusResult {
    status: String,
    error: Option<String>,
}

#[derive(Deserialize)]
struct OAuthStartApiResponse {
    url: Option<String>,
    state: Option<String>,
    error: Option<String>,
    #[serde(rename = "error_message")]
    error_message: Option<String>,
}

#[derive(Deserialize)]
struct OAuthStatusApiResponse {
    status: Option<String>,
    error: Option<String>,
    #[serde(rename = "error_message")]
    error_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagementRequest {
    method: String,
    path: String,
    query: Option<HashMap<String, String>>,
    body: Option<serde_json::Value>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

#[tauri::command]
pub(crate) async fn management_request(
    gui_config_state: tauri::State<'_, GuiConfigState>,
    request: ManagementRequest,
) -> Result<serde_json::Value, String> {
    let config = gui_config_state.snapshot()?;
    let method = match request.method.trim().to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("Unsupported management API request method".to_string()),
    };
    let path = request.path.trim();
    if path.is_empty() || path.contains("://") || path.contains("..") {
        return Err("Invalid management API path".to_string());
    }

    let client = management_http_client()?;
    let mut builder = client
        .request(method, management_endpoint(&config, path)?)
        .header("Authorization", management_authorization(&config)?);
    if let Some(timeout_ms) = request.timeout_ms {
        builder = builder.timeout(Duration::from_millis(timeout_ms.clamp(1_000, 120_000)));
    }
    if let Some(query) = request.query {
        builder = builder.query(&query);
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| format!("Management API request failed: {err}"))?;
    read_management_value(response).await
}

#[tauri::command]
pub(crate) async fn upload_auth_file(
    gui_config_state: tauri::State<'_, GuiConfigState>,
    name: String,
    data: Vec<u8>,
) -> Result<serde_json::Value, String> {
    let name = validate_auth_file_upload(&name, &data)?;

    let config = gui_config_state.snapshot()?;
    let client = management_http_client()?;
    let mut query = HashMap::new();
    query.insert("name".to_string(), name);
    let response = client
        .post(management_endpoint(&config, "auth-files")?)
        .header("Authorization", management_authorization(&config)?)
        .query(&query)
        .header("Content-Type", "application/json")
        .body(data)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "Auth file upload timed out".to_string()
            } else if error.is_connect() {
                "Could not connect to the management API to upload the auth file".to_string()
            } else {
                "Failed to upload auth file".to_string()
            }
        })?;
    if !response.status().is_success() {
        // An upload error body can contain the submitted credentials. Keep it
        // out of notifications and logs while retaining the actionable status.
        return Err(format!(
            "Failed to upload auth file (HTTP {})",
            response.status().as_u16()
        ));
    }
    read_management_value(response)
        .await
        .map_err(|_| "Failed to read auth file upload response".to_string())
}

const MAX_AUTH_FILE_BYTES: usize = 10 * 1024 * 1024;

fn validate_auth_file_upload(name: &str, data: &[u8]) -> Result<String, String> {
    let name = name.trim();
    if name.len() <= 5 || !name.to_ascii_lowercase().ends_with(".json") {
        return Err("Auth file name must end with .json".to_string());
    }
    if name.chars().any(|character| {
        character.is_control()
            || matches!(character, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
    }) {
        return Err("Auth file name must be a valid file name without a path".to_string());
    }
    // Windows device names remain reserved with an extension, including extra
    // extensions and the superscript port numbers recognized by Windows.
    let base = name.split('.').next().unwrap_or_default().trim_end();
    let base = base.to_ascii_uppercase();
    let reserved_port = base
        .strip_prefix("COM")
        .or_else(|| base.strip_prefix("LPT"))
        .is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        });
    if matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) || reserved_port
    {
        return Err("Auth file name is reserved by the operating system".to_string());
    }
    if data.len() > MAX_AUTH_FILE_BYTES {
        return Err("Auth file must not exceed 10 MiB".to_string());
    }
    let value: serde_json::Value = serde_json::from_slice(data)
        .map_err(|_| "Auth file must contain valid JSON".to_string())?;
    if !value.as_object().is_some_and(|object| !object.is_empty()) {
        return Err("Auth file must contain a nonempty JSON object".to_string());
    }
    Ok(name.to_string())
}

#[tauri::command]
pub(crate) fn open_auth_files_directory(
    gui_config_state: tauri::State<'_, GuiConfigState>,
) -> Result<(), String> {
    let config = gui_config_state.snapshot()?;
    let install_dir = core_install_dir()?;
    let auth_dir = auth_dir_path_for_core(&config.auth_dir, &install_dir);
    fs::create_dir_all(&auth_dir)
        .map_err(|error| format!("Failed to create credentials directory {}: {error}", path_to_string(&auth_dir)))?;
    open_directory_in_file_manager(&auth_dir)
}

fn open_directory_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = Command::new(windows_explorer_executable());
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command.arg(path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_background_command(&mut command);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open credentials directory {}: {error}", path_to_string(path)))
}

#[tauri::command]
pub(crate) async fn start_oauth_login(
    app: tauri::AppHandle,
    gui_config_state: tauri::State<'_, GuiConfigState>,
    provider: String,
    browser: Option<String>,
) -> Result<OAuthStartResult, String> {
    let config = gui_config_state.snapshot()?;
    let provider_key = normalize_management_oauth_provider(&provider)?;
    let client = management_http_client()?;
    let mut request = client
        .get(management_endpoint(
            &config,
            &format!("{provider_key}-auth-url"),
        )?)
        .header("Authorization", management_authorization(&config)?);
    if management_oauth_uses_webui_callback(&provider_key) {
        request = request.query(&[("is_webui", "true")]);
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("Failed to request OAuth login link: {err}"))?;
    let payload = read_management_json::<OAuthStartApiResponse>(response).await?;
    if let Some(error) = payload
        .error
        .or(payload.error_message)
        .filter(|value| !value.trim().is_empty())
    {
        return Err(error);
    }
    let url = payload
        .url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Core did not return an OAuth login link".to_string())?;
    let state = payload
        .state
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let (opened, open_error) = match open_oauth_url_inner(&app, &url, browser.as_deref()) {
        Ok(()) => (true, None),
        Err(error) => (false, Some(error)),
    };

    Ok(OAuthStartResult {
        url,
        state,
        opened,
        open_error,
    })
}

#[tauri::command]
pub(crate) async fn get_oauth_status(
    gui_config_state: tauri::State<'_, GuiConfigState>,
    state: String,
) -> Result<OAuthStatusResult, String> {
    let state = state.trim().to_string();
    if state.is_empty() {
        return Err("OAuth state cannot be empty".to_string());
    }
    let config = gui_config_state.snapshot()?;
    let client = management_http_client()?;
    let response = client
        .get(management_endpoint(&config, "get-auth-status")?)
        .header("Authorization", management_authorization(&config)?)
        .query(&[("state", state)])
        .send()
        .await
        .map_err(|err| format!("Failed to query OAuth status: {err}"))?;
    let payload = read_management_json::<OAuthStatusApiResponse>(response).await?;
    let status = payload
        .status
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "wait".to_string());
    Ok(OAuthStatusResult {
        status,
        error: payload
            .error
            .or(payload.error_message)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

#[tauri::command]
pub(crate) async fn submit_oauth_callback(
    gui_config_state: tauri::State<'_, GuiConfigState>,
    provider: String,
    redirect_url: String,
) -> Result<(), String> {
    let redirect_url = redirect_url.trim().to_string();
    if redirect_url.is_empty() {
        return Err("Callback URL cannot be empty".to_string());
    }
    let config = gui_config_state.snapshot()?;
    let provider_key = normalize_management_oauth_provider(&provider)?;
    let client = management_http_client()?;
    let body = serde_json::json!({
        "provider": provider_key,
        "redirect_url": redirect_url,
    });
    let response = client
        .post(management_endpoint(&config, "oauth-callback")?)
        .header("Authorization", management_authorization(&config)?)
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("Failed to submit OAuth callback: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read OAuth callback response: {err}"))?;
    if !status.is_success() {
        return Err(format_management_error(status.as_u16(), &text));
    }
    Ok(())
}

pub(crate) fn management_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("Failed to create management API client: {err}"))
}

pub(crate) fn management_authorization(config: &GuiConfigFile) -> Result<String, String> {
    let secret_key = config.management_secret_key.trim();
    if secret_key.is_empty() || is_hashed_management_secret_key(secret_key) {
        return Err("Management interface unavailable: no plaintext management key available".to_string());
    }
    Ok(format!("Bearer {secret_key}"))
}

pub(crate) fn management_endpoint(config: &GuiConfigFile, path: &str) -> Result<String, String> {
    if config.port == 0 {
        return Err("Invalid core port".to_string());
    }
    let path = path.trim_start_matches('/');
    Ok(format!(
        "http://127.0.0.1:{}/v0/management/{path}",
        config.port
    ))
}

fn normalize_management_oauth_provider(provider: &str) -> Result<String, String> {
    let key = provider.trim().to_ascii_lowercase().replace('_', "-");
    let key = match key.as_str() {
        "claude" | "anthropic" => "anthropic".to_string(),
        "anti-gravity" => "antigravity".to_string(),
        "grok" | "x-ai" | "x.ai" => "xai".to_string(),
        other => other.to_string(),
    };
    if key.is_empty()
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err("Invalid OAuth provider".to_string());
    }
    Ok(key)
}

fn management_oauth_uses_webui_callback(provider_key: &str) -> bool {
    matches!(provider_key, "codex" | "anthropic" | "antigravity" | "xai")
}

async fn read_management_json<T>(response: reqwest::Response) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read management API response: {err}"))?;
    if !status.is_success() {
        return Err(format_management_error(status.as_u16(), &text));
    }
    if text.trim().is_empty() {
        return Err("Management API returned an empty response".to_string());
    }
    serde_json::from_str::<T>(&text).map_err(|err| {
        format!(
            "Failed to parse management API response: {err}; body={}",
            truncate_for_error(&text)
        )
    })
}

pub(crate) async fn read_management_value(
    response: reqwest::Response,
) -> Result<serde_json::Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read management API response: {err}"))?;
    if !status.is_success() {
        return Err(format_management_error(status.as_u16(), &text));
    }
    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => Ok(value),
        Err(_) => Ok(serde_json::Value::String(text)),
    }
}

pub(crate) async fn read_management_text(response: reqwest::Response) -> Result<String, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("Failed to read management API response: {err}"))?;
    if !status.is_success() {
        return Err(format_management_error(status.as_u16(), &text));
    }
    Ok(text)
}

fn format_management_error(status: u16, body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(message) = value
            .get("error")
            .and_then(|item| item.as_str())
            .or_else(|| value.get("message").and_then(|item| item.as_str()))
        {
            let message = message.trim();
            if !message.is_empty() {
                return format!("Management API error ({status}): {message}");
            }
        }
    }
    let body = body.trim();
    if body.is_empty() {
        format!("Management API error ({status})")
    } else {
        format!("Management API error ({status}): {}", truncate_for_error(body))
    }
}

#[cfg(test)]
mod auth_file_upload_tests {
    use super::{validate_auth_file_upload, MAX_AUTH_FILE_BYTES};

    const AUTH_JSON: &[u8] = br#"{"type":"codex","access_token":"example-secret"}"#;

    #[test]
    fn accepts_safe_json_names_and_preserves_credentials() {
        for name in ["codex-user@example.com.json", "account.JSON", "tài-khoản.json", "COM10.json"] {
            assert_eq!(validate_auth_file_upload(name, AUTH_JSON), Ok(name.to_string()));
        }
        assert_eq!(
            validate_auth_file_upload(" account.json ", AUTH_JSON),
            Ok("account.json".to_string())
        );
    }

    #[test]
    fn rejects_paths_streams_invalid_names_and_windows_devices() {
        for name in [
            "", ".json", "account.txt", "account.json.exe", "../account.json",
            "folder/account.json", "folder\\account.json", "C:\\account.json",
            "\\\\server\\account.json", "account.json:stream.json", "bad\0.json",
            "bad\nname.json", "bad<name.json", "bad>name.json", "bad\"name.json",
            "bad|name.json", "bad?name.json", "bad*name.json", "CON.json", "prn.json",
            "AUX.extra.json", "NUL .json", "COM1.json", "LPT9.json", "COM¹.json",
            "LPT².json", "COM³.json", "CONIN$.json", "CONOUT$.json", "CLOCK$.json",
        ] {
            assert!(validate_auth_file_upload(name, AUTH_JSON).is_err(), "accepted {name:?}");
        }
    }

    #[test]
    fn rejects_empty_malformed_and_non_object_json_without_exposing_tokens() {
        for data in [
            b"".as_slice(), b"   ", b"{}", b"[]", b"null", b"true", b"42",
            br#""example-secret""#, br#"{"access_token":"example-secret""#,
            b"{\"access_token\":\"\xff\"}",
        ] {
            let error = validate_auth_file_upload("account.json", data).unwrap_err();
            assert!(!error.contains("example-secret"));
        }
    }

    #[test]
    fn permits_the_size_boundary_and_rejects_larger_uploads() {
        let mut data = AUTH_JSON.to_vec();
        data.resize(MAX_AUTH_FILE_BYTES, b' ');
        assert!(validate_auth_file_upload("account.json", &data).is_ok());
        data.push(b' ');
        assert_eq!(
            validate_auth_file_upload("account.json", &data),
            Err("Auth file must not exceed 10 MiB".to_string())
        );
    }
}
