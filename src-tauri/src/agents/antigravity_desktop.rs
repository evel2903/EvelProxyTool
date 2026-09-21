use super::antigravity_bridge::{Bridge, RouteConfig};
use super::*;

struct DesktopSession {
    bridge: Bridge,
    child: Child,
}
static DESKTOP_SESSION: LazyLock<tokio::sync::Mutex<Option<DesktopSession>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(None));

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AntigravityDesktopStatus {
    running: bool,
    inference_requests: u64,
    completed_responses: u64,
    last_error: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_antigravity_desktop_status() -> AntigravityDesktopStatus {
    let mut session = DESKTOP_SESSION.lock().await;
    if let Some(active) = session.as_mut() {
        let stats = active.bridge.stats();
        let running = matches!(active.child.try_wait(), Ok(None));
        return AntigravityDesktopStatus {
            running,
            inference_requests: stats.inference_requests,
            completed_responses: stats.completed_responses,
            last_error: stats.last_error,
        };
    }
    AntigravityDesktopStatus::default()
}

pub(crate) fn antigravity_desktop_version_supported(version: Option<&str>) -> bool {
    cfg!(target_os = "windows") && matches!(version, Some("2.15.1" | "2.15.1.0"))
}

pub(super) fn close_desktop_connection() -> Result<(), String> {
    let mut session = DESKTOP_SESSION
        .try_lock()
        .map_err(|_| "Wait for the desktop launch to finish before restoring its configuration")?;
    // Drop the bridge to stop proxying; leave the user's desktop/work untouched.
    session.take();
    Ok(())
}

pub(super) async fn launch_antigravity_desktop(
    home: &Path,
    port: u16,
    key: &str,
    model: &str,
) -> Result<(), String> {
    if !antigravity_desktop_version_supported(read_antigravity_version(home).as_deref()) {
        return Err(
            "The desktop bridge currently supports Antigravity 2.15.1 on Windows".to_owned(),
        );
    }
    let executable =
        find_antigravity_app_executable(home).ok_or("Antigravity desktop was not found")?;
    let route = RouteConfig {
        port,
        key: key.to_owned(),
        model: model.to_owned(),
    };
    // Verify CPA/key/model before creating a session or opening the desktop.
    let available = fetch_agent_models(port, key).await?;
    if !available.iter().any(|candidate| candidate.name == model) {
        return Err(
            "The applied Antigravity model is no longer available in CPA; refresh and apply again"
                .to_owned(),
        );
    }
    let mut session = DESKTOP_SESSION.lock().await;
    if let Some(active) = session.as_mut() {
        if active
            .child
            .try_wait()
            .map_err(|_| "Unable to inspect the managed desktop process")?
            .is_none()
        {
            return active.bridge.update(route);
        }
    }
    session.take();
    let check_path = executable.clone();
    if tauri::async_runtime::spawn_blocking(move || desktop_is_running(&check_path))
        .await
        .map_err(|_| "Unable to check Antigravity desktop")??
    {
        return Err("Close Antigravity desktop after saving your work, then launch it from EvelProxyTool so the proxy connection takes effect".to_owned());
    }
    let bridge = Bridge::start(route).await?;
    let mut command = desktop_command(&executable, &bridge.endpoint);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_background_command(&mut command);
    let child = command
        .spawn()
        .map_err(|_| "Unable to launch Antigravity desktop")?;
    *session = Some(DesktopSession { bridge, child });
    Ok(())
}

fn desktop_command(executable: &Path, endpoint: &str) -> Command {
    let mut command = Command::new(executable);
    // Native code reads this variable before constructing its Cloud Code client.
    // No binary/ASAR patch and no global environment change are needed.
    command.env("CLOUD_CODE_URL", endpoint);
    command
}

#[cfg(target_os = "windows")]
fn desktop_is_running(executable: &Path) -> Result<bool, String> {
    let mut command = Command::new(windows_powershell_executable());
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference = 'Stop'; $matches = @(Get-CimInstance Win32_Process -Filter \"Name = 'Antigravity.exe'\" | Where-Object { $_.ExecutablePath -eq $env:CPA_DESKTOP_PATH }); if ($matches.Count -gt 0) { 'running' } else { 'stopped' }"])
        .env("CPA_DESKTOP_PATH", executable).stdin(Stdio::null());
    configure_background_command(&mut command);
    let output = command
        .output()
        .map_err(|_| "Unable to inspect desktop processes")?;
    if !output.status.success() {
        return Err("Unable to inspect desktop processes".to_owned());
    }
    match String::from_utf8_lossy(&output.stdout).trim() {
        "running" => Ok(true),
        "stopped" => Ok(false),
        _ => Err("Unexpected desktop process status".to_owned()),
    }
}

#[cfg(not(target_os = "windows"))]
fn desktop_is_running(_executable: &Path) -> Result<bool, String> {
    Err("Antigravity desktop bridge is currently Windows-only".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_command_uses_native_endpoint_without_cli_or_api_key_arguments() {
        let executable = Path::new("test-only-antigravity.exe");
        let command = desktop_command(executable, "http://127.0.0.1:1234/test-session");
        assert_eq!(command.get_program(), executable.as_os_str());
        assert_eq!(command.get_args().count(), 0);
        let variables: Vec<_> = command.get_envs().collect();
        assert_eq!(variables.len(), 1);
        assert_eq!(variables[0].0, "CLOUD_CODE_URL");
        assert_eq!(
            variables[0].1.unwrap(),
            "http://127.0.0.1:1234/test-session"
        );
    }
    #[test]
    fn unknown_desktop_versions_do_not_claim_compatibility() {
        for version in [None, Some("2.14.0"), Some("2.16.0"), Some("unknown")] {
            assert!(!antigravity_desktop_version_supported(version));
        }
    }
}
