use super::*;

pub(crate) fn validate_core_api_key(api_key: &str) -> Result<(), String> {
    if api_key.is_empty() {
        return Err("Auth key cannot be empty".to_string());
    }
    if !api_key.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err("Auth key can only contain visible ASCII characters and must not contain spaces".to_string());
    }
    if is_example_core_api_key(api_key) {
        return Err("Cannot use the example auth key from the core template".to_string());
    }
    Ok(())
}

pub(crate) fn validate_api_key_remark(remark: &str) -> Result<(), String> {
    if remark.chars().count() > 80 {
        return Err("Key remark cannot exceed 80 characters".to_string());
    }
    if remark.chars().any(char::is_control) {
        return Err("Key remark cannot contain newlines or control characters".to_string());
    }
    Ok(())
}

pub(crate) fn validate_api_access_provider_section(section: &str) -> Result<(), String> {
    if matches!(
        section,
        "gemini-api-key" | "codex-api-key" | "claude-api-key" | "openai-compatibility"
    ) {
        Ok(())
    } else {
        Err("Invalid API access type".to_string())
    }
}

pub(crate) fn api_access_key_hash(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| sha256_bytes(value.as_bytes()))
}

pub(crate) fn usage_provider_section(provider: &str) -> Option<&'static str> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "codex" => Some("codex-api-key"),
        "claude" => Some("claude-api-key"),
        "gemini" | "aistudio" => Some("gemini-api-key"),
        "openai" | "openai-compatibility" => Some("openai-compatibility"),
        _ => None,
    }
}

impl GuiConfigFile {
    pub(crate) fn api_access_remark_for_source(
        &self,
        provider: &str,
        source: &str,
    ) -> Option<&str> {
        let hash = api_access_key_hash(source)?;
        let preferred_section = usage_provider_section(provider);
        self.api_access_remarks
            .iter()
            .find(|entry| {
                preferred_section == Some(entry.provider_section.as_str())
                    && entry.api_key_hash == hash
                    && !entry.remark.is_empty()
            })
            .or_else(|| {
                self.api_access_remarks
                    .iter()
                    .find(|entry| entry.api_key_hash == hash && !entry.remark.is_empty())
            })
            .map(|entry| entry.remark.as_str())
    }
}

pub(crate) fn validate_management_secret_key(secret_key: &str) -> Result<(), String> {
    if secret_key.chars().count() > 512 {
        return Err("Management secret key cannot exceed 512 characters".to_string());
    }
    if secret_key.chars().any(char::is_control) {
        return Err("Management secret key cannot contain control characters".to_string());
    }
    Ok(())
}

pub(crate) fn validate_strong_management_secret_key(secret_key: &str) -> Result<(), String> {
    validate_management_secret_key(secret_key)?;
    if secret_key.trim().is_empty() {
        return Err("WebUI secret key cannot be empty".to_string());
    }
    if secret_key.trim() == LEGACY_DEFAULT_MANAGEMENT_SECRET_KEY {
        return Err("Cannot continue using the legacy default WebUI secret key 123456".to_string());
    }
    if is_hashed_management_secret_key(secret_key) {
        return Err("The GUI config must store the plaintext WebUI secret key usable for management API authentication".to_string());
    }
    Ok(())
}

pub(crate) fn generate_management_secret_key() -> Result<String, String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|error| format!("Failed to generate WebUI security key: {error}"))?;
    Ok(format!("wui-Aa9_{}", URL_SAFE_NO_PAD.encode(random)))
}

pub(crate) fn management_secret_requires_rotation(secret_key: &str) -> bool {
    let secret_key = secret_key.trim();
    secret_key.is_empty()
        || secret_key == LEGACY_DEFAULT_MANAGEMENT_SECRET_KEY
        || is_hashed_management_secret_key(secret_key)
}

pub(crate) fn ensure_strong_management_secret(config: &mut GuiConfigFile) -> Result<bool, String> {
    if !management_secret_requires_rotation(&config.management_secret_key) {
        return Ok(false);
    }
    config.management_secret_key = generate_management_secret_key()?;
    Ok(true)
}

pub(crate) fn normalize_management_secret_key(secret_key: String) -> Result<String, String> {
    let secret_key = secret_key.trim().to_string();
    validate_strong_management_secret_key(&secret_key)?;
    Ok(secret_key)
}

pub(crate) fn is_example_core_api_key(api_key: &str) -> bool {
    let value = api_key.trim();
    value == "your-api-key" || value.starts_with("your-api-key-")
}

pub(crate) fn is_hashed_management_secret_key(secret_key: &str) -> bool {
    let value = secret_key.trim();
    value.starts_with("$2a$")
        || value.starts_with("$2b$")
        || value.starts_with("$2y$")
        || value.starts_with("$argon2")
        || value.starts_with("$scrypt$")
        || value.starts_with("bcrypt:")
        || value.starts_with("argon2:")
        || value.starts_with("argon2id:")
        || value.starts_with("sha256:")
        || value.starts_with("sha512:")
}

pub(crate) fn validate_routing_strategy(strategy: &str) -> Result<(), String> {
    if matches!(strategy, "round-robin" | "fill-first") {
        return Ok(());
    }
    Err("Routing strategy only supports round-robin or fill-first".to_string())
}

pub(crate) fn normalize_optional_config_string(
    value: String,
    field_name: &str,
) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.chars().any(char::is_control) {
        return Err(format!("{field_name} cannot contain control characters"));
    }
    Ok(value)
}

pub(crate) fn config_update_error_with_rollback(
    error: String,
    rollback_error: Option<String>,
) -> String {
    match rollback_error {
        Some(rollback_error) => format!("{error}; rolling back core config also failed: {rollback_error}"),
        None => error,
    }
}

pub(crate) fn merge_core_config_yaml(
    template: &str,
    current: Option<&str>,
    config: &GuiConfigFile,
) -> Result<String, String> {
    let base = match current {
        Some(current) => current.to_string(),
        None => merge_core_config_fields(template, None)?,
    };
    apply_gui_managed_settings(&base, config)
}

pub(crate) fn merge_core_config_fields(
    template: &str,
    current: Option<&str>,
) -> Result<String, String> {
    let current_value = current
        .map(|current| {
            let current = serde_norway::from_str::<serde_norway::Value>(current)
                .map_err(|err| format!("Failed to parse existing core config, aborting write to avoid data loss: {err}"))?;
            if !current.is_mapping() {
                return Err("Existing core config root must be a YAML mapping, aborting write".to_string());
            }
            Ok(current)
        })
        .transpose()?;
    merge_core_config_value(template, current_value)
}

pub(crate) fn merge_core_config_fields_tolerant(
    template: &str,
    current: &str,
) -> Result<String, String> {
    let current = match serde_norway::from_str::<serde_norway::Value>(current) {
        Ok(current) if current.is_mapping() => current,
        _ => recover_parseable_top_level_yaml_fields(current),
    };
    merge_core_config_value(template, Some(current))
}

pub(crate) fn merge_core_config_value(
    template: &str,
    current: Option<serde_norway::Value>,
) -> Result<String, String> {
    let template_value = serde_norway::from_str::<serde_norway::Value>(template)
        .map_err(|err| format!("Failed to parse core config template: {err}"))?;
    if !template_value.is_mapping() {
        return Err("Core config template root must be a YAML mapping".to_string());
    }
    let mut merged = template_value.clone();

    if let Some(current) = current {
        merge_yaml_values(&mut merged, current);
    }

    let rendered = render_yaml_value_changes(template, &template_value, &merged)?;
    let rendered_value = serde_norway::from_str::<serde_norway::Value>(&rendered)
        .map_err(|err| format!("Failed to validate migrated core config: {err}"))?;
    if !rendered_value.is_mapping() {
        return Err("Migrated core config root must be a YAML mapping".to_string());
    }
    Ok(rendered)
}

pub(crate) fn recover_parseable_top_level_yaml_fields(content: &str) -> serde_norway::Value {
    let lines = yaml_line_ranges(content);
    let boundaries = lines
        .iter()
        .copied()
        .filter(|range| is_top_level_yaml_boundary(yaml_line_content(content, *range)))
        .collect::<Vec<_>>();
    let mut recovered = serde_norway::Mapping::new();

    for (index, (start, _)) in boundaries.iter().copied().enumerate() {
        let line = yaml_line_content(content, boundaries[index]);
        if !is_top_level_yaml_mapping_field(line) {
            continue;
        }
        let end = boundaries
            .get(index + 1)
            .map(|(next_start, _)| *next_start)
            .unwrap_or(content.len());
        let Ok(value) = serde_norway::from_str::<serde_norway::Value>(&content[start..end]) else {
            continue;
        };
        let Some(mapping) = value.as_mapping() else {
            continue;
        };
        for (key, value) in mapping {
            recovered.insert(key.clone(), value.clone());
        }
    }

    serde_norway::Value::Mapping(recovered)
}

pub(crate) fn is_top_level_yaml_boundary(line: &str) -> bool {
    if line.is_empty()
        || line.chars().next().is_some_and(char::is_whitespace)
        || line.starts_with('#')
        || is_indentationless_yaml_sequence_item(line)
    {
        return false;
    }
    !matches!(line.trim(), "---" | "...") && !line.starts_with('%')
}

pub(crate) fn is_top_level_yaml_mapping_field(line: &str) -> bool {
    let mut single_quoted = false;
    let mut double_quoted = false;
    let mut escaped = false;
    for (index, character) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if double_quoted && character == '\\' {
            escaped = true;
            continue;
        }
        match character {
            '\'' if !double_quoted => single_quoted = !single_quoted,
            '"' if !single_quoted => double_quoted = !double_quoted,
            ':' if !single_quoted && !double_quoted => {
                let rest = &line[index + character.len_utf8()..];
                return rest.is_empty() || rest.chars().next().is_some_and(char::is_whitespace);
            }
            _ => {}
        }
    }
    false
}

pub(crate) fn patch_core_network_yaml(
    content: &str,
    config: &GuiConfigFile,
) -> Result<Option<String>, String> {
    patch_core_yaml_document(content, |document| {
        let original = document.clone();
        apply_network_settings(document, config)?;
        Ok(*document != original)
    })
}

pub(crate) fn patch_core_network_routing_yaml(
    content: &str,
    config: &GuiConfigFile,
) -> Result<Option<String>, String> {
    patch_core_yaml_document(content, |document| {
        let original = document.clone();
        apply_network_settings(document, config)?;
        set_core_yaml_top_level_value(
            document,
            "proxy-url",
            serde_norway::Value::String(config.proxy_url.clone()),
        )?;
        set_core_yaml_nested_value(
            document,
            "routing",
            "session-affinity",
            serde_norway::Value::Bool(config.routing_session_affinity),
        )?;
        set_core_yaml_nested_value(
            document,
            "routing",
            "session-affinity-ttl",
            serde_norway::Value::String(config.routing_session_affinity_ttl.clone()),
        )?;
        set_core_yaml_top_level_value(
            document,
            "request-retry",
            serde_norway::to_value(config.request_retry)
                .map_err(|err| format!("Failed to serialize request retry count: {err}"))?,
        )?;
        set_core_yaml_top_level_value(
            document,
            "max-retry-credentials",
            serde_norway::to_value(config.max_retry_credentials)
                .map_err(|err| format!("Failed to serialize max retry credential count: {err}"))?,
        )?;
        set_core_yaml_top_level_value(
            document,
            "max-retry-interval",
            serde_norway::to_value(config.max_retry_interval)
                .map_err(|err| format!("Failed to serialize max retry wait time: {err}"))?,
        )?;
        set_core_yaml_nested_value(
            document,
            "streaming",
            "bootstrap-retries",
            serde_norway::to_value(config.streaming_bootstrap_retries)
                .map_err(|err| format!("Failed to serialize streaming bootstrap retry count: {err}"))?,
        )?;
        Ok(*document != original)
    })
}

pub(crate) fn merge_yaml_values(base: &mut serde_norway::Value, current: serde_norway::Value) {
    match (base, current) {
        (
            serde_norway::Value::Mapping(base_mapping),
            serde_norway::Value::Mapping(current_mapping),
        ) => {
            for (key, current_value) in current_mapping {
                if let Some(base_value) = base_mapping.get_mut(&key) {
                    merge_yaml_values(base_value, current_value);
                } else {
                    base_mapping.insert(key, current_value);
                }
            }
        }
        (base, current) => *base = current,
    }
}

pub(crate) fn apply_network_settings(
    document: &mut serde_norway::Value,
    config: &GuiConfigFile,
) -> Result<(), String> {
    let mapping = document
        .as_mapping_mut()
        .ok_or_else(|| "Core config top level must be a YAML mapping".to_string())?;

    let host = config.host.trim();
    mapping.insert(
        serde_norway::Value::String("host".to_string()),
        serde_norway::Value::String(host.to_string()),
    );
    mapping.insert(
        serde_norway::Value::String("port".to_string()),
        serde_norway::to_value(config.port).map_err(|err| format!("Failed to serialize core port: {err}"))?,
    );
    Ok(())
}

pub(crate) fn apply_gui_managed_settings(
    content: &str,
    config: &GuiConfigFile,
) -> Result<String, String> {
    let host = config.host.trim();
    let updated = patch_core_yaml_document(content, |document| {
        let mut changed = false;
        changed |= set_core_yaml_top_level_value(
            document,
            "host",
            serde_norway::Value::String(host.to_string()),
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "port",
            serde_norway::to_value(config.port)
                .map_err(|err| format!("Failed to serialize core port: {err}"))?,
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "auth-dir",
            serde_norway::Value::String(config.auth_dir.clone()),
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "usage-statistics-enabled",
            serde_norway::Value::Bool(config.usage_statistics_enabled),
        )?;
        changed |= set_core_yaml_nested_value(
            document,
            "remote-management",
            "secret-key",
            serde_norway::Value::String(config.management_secret_key.clone()),
        )?;
        changed |= set_core_yaml_nested_value(
            document,
            "plugins",
            "enabled",
            serde_norway::Value::Bool(config.plugins_enabled),
        )?;
        changed |= set_core_yaml_nested_value(
            document,
            "routing",
            "strategy",
            serde_norway::Value::String(config.routing_strategy.clone()),
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "proxy-url",
            serde_norway::Value::String(config.proxy_url.clone()),
        )?;
        changed |= set_core_yaml_nested_value(
            document,
            "routing",
            "session-affinity",
            serde_norway::Value::Bool(config.routing_session_affinity),
        )?;
        changed |= set_core_yaml_nested_value(
            document,
            "routing",
            "session-affinity-ttl",
            serde_norway::Value::String(config.routing_session_affinity_ttl.clone()),
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "request-retry",
            serde_norway::to_value(config.request_retry)
                .map_err(|err| format!("Failed to serialize request retry count: {err}"))?,
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "max-retry-credentials",
            serde_norway::to_value(config.max_retry_credentials)
                .map_err(|err| format!("Failed to serialize max retry credential count: {err}"))?,
        )?;
        changed |= set_core_yaml_top_level_value(
            document,
            "max-retry-interval",
            serde_norway::to_value(config.max_retry_interval)
                .map_err(|err| format!("Failed to serialize max retry wait time: {err}"))?,
        )?;
        changed |= set_core_yaml_nested_value(
            document,
            "streaming",
            "bootstrap-retries",
            serde_norway::to_value(config.streaming_bootstrap_retries)
                .map_err(|err| format!("Failed to serialize streaming bootstrap retry count: {err}"))?,
        )?;
        Ok(changed)
    })?
    .unwrap_or_else(|| content.to_string());

    let updated = patch_core_api_keys_yaml(&updated, &gui_api_key_values(&config.api_keys))?;
    serde_norway::from_str::<serde_norway::Value>(&updated)
        .map_err(|err| format!("Failed to validate startup core config: {err}"))?;
    Ok(updated)
}

pub(crate) fn write_bytes_directly(path: &Path, content: &[u8]) -> Result<(), String> {
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create config directory {}: {error}", path_to_string(directory)))?;

    let write_result = (|| -> io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(path)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(content)?;
        file.set_len(content.len() as u64)?;
        file.sync_all()
    })();

    write_result.map_err(|error| format!("Failed to write config directly {}: {error}", path_to_string(path)))?;
    remember_software_write(path, content);
    Ok(())
}

pub(crate) fn write_bytes_atomically(path: &Path, content: &[u8]) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create config directory {}: {error}", path_to_string(directory)))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.yaml");
    let temporary_path = directory.join(format!(
        ".{file_name}.tmp.{}.{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));

    let write_result = (|| -> io::Result<()> {
        let mut file = File::create(&temporary_path)?;
        file.write_all(content)?;
        file.sync_all()?;
        // ReplaceFileW requires the replacement file handle to be closed.
        // Unix rename permits replacing an open file, so this otherwise only
        // surfaces on Windows as ERROR_SHARING_VIOLATION (os error 32).
        drop(file);
        replace_file_atomically(&temporary_path, path)
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!(
            "Failed to atomically write config {}: {error}",
            path_to_string(path)
        ));
    }

    remember_software_write(path, content);

    Ok(())
}

pub(crate) fn normalized_config_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub(crate) fn remember_software_write(path: &Path, content: &[u8]) {
    if let Ok(mut hashes) = CONFIG_WRITE_HASHES.lock() {
        hashes.insert(normalized_config_path(path), sha256_bytes(content));
    }
}

pub(crate) fn consume_software_write(path: &Path) -> bool {
    let Ok(content) = fs::read(path) else {
        return false;
    };
    let key = normalized_config_path(path);
    let hash = sha256_bytes(&content);
    let Ok(mut hashes) = CONFIG_WRITE_HASHES.lock() else {
        return false;
    };
    hashes
        .remove(&key)
        .is_some_and(|expected_hash| expected_hash == hash)
}

pub(crate) fn write_yaml_if_changed(path: &Path, content: &str) -> Result<bool, String> {
    if fs::read_to_string(path).ok().as_deref() == Some(content) {
        return Ok(false);
    }

    write_bytes_atomically(path, content.as_bytes())?;

    Ok(true)
}

#[cfg(not(windows))]
pub(crate) fn replace_file_atomically(
    temporary_path: &Path,
    destination_path: &Path,
) -> io::Result<()> {
    fs::rename(temporary_path, destination_path)
}

#[cfg(windows)]
pub(crate) fn replace_file_atomically(
    temporary_path: &Path,
    destination_path: &Path,
) -> io::Result<()> {
    if !destination_path.exists() {
        return fs::rename(temporary_path, destination_path);
    }

    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    let destination = destination_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = temporary_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            replacement.as_ptr(),
            ptr::null(),
            0,
            ptr::null(),
            ptr::null(),
        )
    };

    if replaced == 0 {
        return Err(io::Error::last_os_error());
    }

    Ok(())
}

pub(crate) fn fixed_oauth_dir() -> Result<PathBuf, String> {
    Ok(core_base_dir()?.join(OAUTH_DIR_NAME))
}

pub(crate) fn auth_dir_path_for_core(auth_dir: &str, install_dir: &Path) -> PathBuf {
    if auth_dir.trim() == DEFAULT_AUTH_DIR {
        return install_dir
            .parent()
            .map(|parent| parent.join(OAUTH_DIR_NAME))
            .unwrap_or_else(|| install_dir.join(auth_dir));
    }
    let auth_dir = PathBuf::from(auth_dir);
    if auth_dir.is_absolute() {
        auth_dir
    } else {
        install_dir.join(auth_dir)
    }
}

pub(crate) fn should_import_core_api_keys(
    had_existing_gui_config: bool,
    core_api_keys: &[String],
) -> bool {
    had_existing_gui_config || !core_api_keys.is_empty()
}

pub(crate) fn file_modified_time(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok()?.modified().ok()
}

pub(crate) fn load_or_create_gui_config() -> Result<GuiConfigFile, String> {
    let config_path = gui_config_path()?;
    let legacy_config_path = legacy_gui_config_path()?;
    let gui_config_exists = config_path.is_file();
    let legacy_config_exists = legacy_config_path.is_file();
    let had_existing_gui_config = gui_config_exists || legacy_config_exists;

    let (mut config, presence, mut changed, gui_parse_failed) = if gui_config_exists {
        let content = fs::read_to_string(&config_path)
            .map_err(|err| format!("Failed to read GUI config {}: {err}", path_to_string(&config_path)))?;
        match (
            toml::from_str::<GuiConfigFile>(&content),
            toml::from_str::<GuiConfigPresence>(&content),
        ) {
            (Ok(config), Ok(presence)) => (config, presence, false, false),
            _ => (
                GuiConfigFile::default(),
                GuiConfigPresence::default(),
                true,
                true,
            ),
        }
    } else if legacy_config_exists {
        let content = fs::read_to_string(&legacy_config_path).map_err(|err| {
            format!(
                "Failed to read legacy GUI config {}: {err}",
                path_to_string(&legacy_config_path)
            )
        })?;
        let config = serde_yaml::from_str::<GuiConfigFile>(&content)
            .map_err(|err| format!("Failed to parse legacy GUI config: {err}"))?;
        let presence = serde_yaml::from_str::<GuiConfigPresence>(&content)
            .map_err(|err| format!("Failed to parse legacy GUI config fields: {err}"))?;
        (config, presence, true, false)
    } else {
        (
            GuiConfigFile::default(),
            GuiConfigPresence::default(),
            true,
            false,
        )
    };

    if gui_config_exists {
        if let Ok(content) = fs::read_to_string(&config_path) {
            changed |= [
                "codex-session-repair-on-launch",
                "claude-code-working-directory",
                "claude-code-working-directory-prompt-disabled",
            ]
            .iter()
            .any(|key| {
                content
                    .lines()
                    .any(|line| line.trim_start().starts_with(key))
            });
        }
    }

    let core_config_path = core_install_dir()?.join(CORE_CONFIG_FILE);
    let core_is_newer = file_modified_time(&core_config_path)
        .zip(file_modified_time(&config_path))
        .is_some_and(|(core, gui)| core > gui);
    if core_is_newer && !gui_parse_failed {
        if let Ok(core_settings) = read_installed_core_config_settings() {
            apply_core_settings_to_gui_config(&mut config, &core_settings);
            changed = true;
        }
    }

    let missing_core_settings = presence.host.is_none()
        || presence.port.is_none()
        || presence.auth_dir.is_none()
        || presence.api_keys.is_none()
        || presence.management_secret_key.is_none()
        || presence.usage_statistics_enabled.is_none()
        || presence.plugins_enabled.is_none()
        || presence.routing_strategy.is_none()
        || presence.proxy_url.is_none()
        || presence.routing_session_affinity.is_none()
        || presence.routing_session_affinity_ttl.is_none()
        || presence.request_retry.is_none()
        || presence.max_retry_credentials.is_none()
        || presence.max_retry_interval.is_none()
        || presence.streaming_bootstrap_retries.is_none();
    if missing_core_settings && !gui_parse_failed {
        if let Ok(core_settings) = read_installed_core_config_settings() {
            if presence.host.is_none() {
                config.host = core_settings.host.clone();
                config.allow_lan = !is_loopback_host(&config.host);
            }
            if presence.port.is_none() {
                config.port = core_settings.port;
            }
            if presence.auth_dir.is_none() {
                config.auth_dir = core_settings.auth_dir.clone();
            }
            if presence.api_keys.is_none()
                && should_import_core_api_keys(had_existing_gui_config, &core_settings.api_keys)
            {
                config.api_keys = merge_core_api_keys_with_gui_metadata(
                    &config.api_keys,
                    &core_settings.api_keys,
                    None,
                );
            }
            if presence.plugins_enabled.is_none() {
                config.plugins_enabled = core_settings.plugins_enabled;
            }
            if presence.usage_statistics_enabled.is_none() {
                config.usage_statistics_enabled = core_settings.usage_statistics_enabled;
            }
            if presence.management_secret_key.is_none() {
                config.management_secret_key = core_settings
                    .management_secret_key
                    .as_deref()
                    .filter(|secret_key| !is_hashed_management_secret_key(secret_key))
                    .unwrap_or_default()
                    .to_string();
            }
            if presence.routing_strategy.is_none() {
                config.routing_strategy = core_settings.routing_strategy;
            }
            if presence.proxy_url.is_none() {
                config.proxy_url = core_settings.proxy_url;
            }
            if presence.routing_session_affinity.is_none() {
                config.routing_session_affinity = core_settings.routing_session_affinity;
            }
            if presence.routing_session_affinity_ttl.is_none() {
                config.routing_session_affinity_ttl = core_settings.routing_session_affinity_ttl;
            }
            if presence.request_retry.is_none() {
                config.request_retry = core_settings.request_retry;
            }
            if presence.max_retry_credentials.is_none() {
                config.max_retry_credentials = core_settings.max_retry_credentials;
            }
            if presence.max_retry_interval.is_none() {
                config.max_retry_interval = core_settings.max_retry_interval;
            }
            if presence.streaming_bootstrap_retries.is_none() {
                config.streaming_bootstrap_retries = core_settings.streaming_bootstrap_retries;
            }
        }
        changed = true;
    }
    if presence.management_secret_key.is_none()
        && (had_existing_gui_config || core_config_path.is_file())
    {
        config.management_secret_key = read_installed_core_config_settings()
            .ok()
            .and_then(|settings| settings.management_secret_key)
            .filter(|secret_key| !is_hashed_management_secret_key(secret_key))
            .unwrap_or_default();
        changed = true;
    }
    if presence.host.is_none() || presence.auth_dir.is_none() {
        changed = true;
    }
    if presence.locale.is_none() {
        changed = true;
    }
    if presence.close_behavior.is_none() {
        changed = true;
    }
    if presence.start_core_on_launch.is_none() {
        changed = true;
    }
    if presence.silent_start.is_none() {
        changed = true;
    }
    let management_secret_rotated = ensure_strong_management_secret(&mut config)?;
    changed |= management_secret_rotated;
    changed |= sanitize_gui_config(&mut config)?;
    validate_gui_config(&config)?;
    if changed {
        write_gui_config(&config)?;
    }
    if management_secret_rotated {
        if let Err(error) = patch_core_management_secret_key(&config.management_secret_key) {
            eprintln!("Failed to update legacy CPA WebUI secret key, will retry on next core startup: {error}");
        }
    }
    if !config.auth_dir.trim().is_empty() {
        let install_dir = core_install_dir()?;
        let auth_dir = auth_dir_path_for_core(&config.auth_dir, &install_dir);
        fs::create_dir_all(&auth_dir)
            .map_err(|error| format!("Failed to create credentials directory {}: {error}", path_to_string(&auth_dir)))?;
    }
    Ok(config)
}

pub(crate) fn apply_core_settings_to_gui_config(
    config: &mut GuiConfigFile,
    core_settings: &CoreConfigSettings,
) {
    config.host = core_settings.host.clone();
    config.port = core_settings.port;
    config.allow_lan = !is_loopback_host(&core_settings.host);
    config.auth_dir = core_settings.auth_dir.clone();
    config.api_keys =
        merge_core_api_keys_with_gui_metadata(&config.api_keys, &core_settings.api_keys, None);
    if let Some(secret_key) = core_settings
        .management_secret_key
        .as_deref()
        .filter(|secret_key| !is_hashed_management_secret_key(secret_key))
    {
        config.management_secret_key = secret_key.to_string();
    }
    config.usage_statistics_enabled = core_settings.usage_statistics_enabled;
    config.plugins_enabled = core_settings.plugins_enabled;
    config.routing_strategy = core_settings.routing_strategy.clone();
    config.proxy_url = core_settings.proxy_url.clone();
    config.routing_session_affinity = core_settings.routing_session_affinity;
    config.routing_session_affinity_ttl = core_settings.routing_session_affinity_ttl.clone();
    config.request_retry = core_settings.request_retry;
    config.max_retry_credentials = core_settings.max_retry_credentials;
    config.max_retry_interval = core_settings.max_retry_interval;
    config.streaming_bootstrap_retries = core_settings.streaming_bootstrap_retries;
}

pub(crate) fn default_api_key_entry() -> GuiApiKeyEntry {
    GuiApiKeyEntry {
        key: DEFAULT_API_KEY.to_string(),
        remark: DEFAULT_API_KEY_INITIAL_REMARK.to_string(),
    }
}

pub(crate) fn gui_api_key_values(entries: &[GuiApiKeyEntry]) -> Vec<String> {
    entries.iter().map(|entry| entry.key.clone()).collect()
}

pub(crate) fn effective_agent_api_key(config: &GuiConfigFile) -> &str {
    config
        .api_keys
        .iter()
        .map(|entry| entry.key.trim())
        .find(|key| !key.is_empty())
        .unwrap_or(DEFAULT_API_KEY)
}

pub(crate) fn merge_core_api_keys_with_gui_metadata(
    existing: &[GuiApiKeyEntry],
    core_api_keys: &[String],
    added_api_key: Option<&GuiApiKeyEntry>,
) -> Vec<GuiApiKeyEntry> {
    let mut merged: Vec<GuiApiKeyEntry> = Vec::new();

    for api_key in core_api_keys {
        let api_key = api_key.trim();
        if api_key.is_empty() || is_example_core_api_key(api_key) {
            continue;
        }
        if merged.iter().any(|entry| entry.key == api_key) {
            continue;
        }

        let remark = added_api_key
            .filter(|entry| entry.key == api_key)
            .map(|entry| entry.remark.clone())
            .or_else(|| {
                existing
                    .iter()
                    .find(|entry| entry.key == api_key)
                    .map(|entry| entry.remark.clone())
            })
            .unwrap_or_default();
        merged.push(GuiApiKeyEntry {
            key: api_key.to_string(),
            remark,
        });
    }

    merged
}

pub(crate) fn normalized_saved_window_size(width: u32, height: u32) -> SavedWindowSize {
    SavedWindowSize {
        width: width.clamp(MIN_MAIN_WINDOW_WIDTH, MAX_SAVED_WINDOW_DIMENSION),
        height: height.clamp(MIN_MAIN_WINDOW_HEIGHT, MAX_SAVED_WINDOW_DIMENSION),
    }
}

pub(crate) fn configured_window_size(config: &GuiConfigFile) -> Option<SavedWindowSize> {
    match (config.window_width, config.window_height) {
        (Some(width), Some(height)) => Some(normalized_saved_window_size(width, height)),
        _ => None,
    }
}

pub(crate) fn logical_window_size_from_physical(
    physical_size: &tauri::PhysicalSize<u32>,
    scale_factor: f64,
) -> Option<SavedWindowSize> {
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return None;
    }

    let width = (f64::from(physical_size.width) / scale_factor).round() as u32;
    let height = (f64::from(physical_size.height) / scale_factor).round() as u32;
    if width < MIN_MAIN_WINDOW_WIDTH || height < MIN_MAIN_WINDOW_HEIGHT {
        return None;
    }

    Some(normalized_saved_window_size(width, height))
}

pub(crate) fn fit_window_size_to_current_monitor<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    saved_size: SavedWindowSize,
) -> SavedWindowSize {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return saved_size;
    };

    let scale_factor = monitor.scale_factor();
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return saved_size;
    }

    let (frame_width, frame_height) = window
        .outer_size()
        .ok()
        .zip(window.inner_size().ok())
        .map(|(outer, inner)| {
            (
                outer.width.saturating_sub(inner.width),
                outer.height.saturating_sub(inner.height),
            )
        })
        .unwrap_or_default();
    let work_area = monitor.work_area();
    let max_width =
        (f64::from(work_area.size.width.saturating_sub(frame_width)) / scale_factor).floor() as u32;
    let max_height = (f64::from(work_area.size.height.saturating_sub(frame_height)) / scale_factor)
        .floor() as u32;

    SavedWindowSize {
        width: saved_size.width.min(max_width.max(MIN_MAIN_WINDOW_WIDTH)),
        height: saved_size
            .height
            .min(max_height.max(MIN_MAIN_WINDOW_HEIGHT)),
    }
}

pub(crate) fn restore_main_window_size(app: &tauri::AppHandle) -> Result<(), String> {
    let window_size_state = app.state::<MainWindowSizeState>();
    let Some(saved_size) = window_size_state.snapshot()? else {
        return Ok(());
    };
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window does not exist, cannot restore window size".to_string())?;
    let restored_size = fit_window_size_to_current_monitor(&window, saved_size);

    window
        .set_size(LogicalSize::new(
            f64::from(restored_size.width),
            f64::from(restored_size.height),
        ))
        .map_err(|error| format!("Failed to restore main window size: {error}"))?;
    window_size_state.replace(restored_size)
}

pub(crate) fn persist_main_window_size(app: &tauri::AppHandle) -> Result<(), String> {
    let window_size_state = app.state::<MainWindowSizeState>();
    let saved_size = match window_size_state.snapshot()? {
        Some(size) => size,
        None => {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Main window does not exist, cannot save window size".to_string())?;
            let physical_size = window
                .inner_size()
                .map_err(|error| format!("Failed to read main window size: {error}"))?;
            let scale_factor = window
                .scale_factor()
                .map_err(|error| format!("Failed to read main window scale factor: {error}"))?;
            logical_window_size_from_physical(&physical_size, scale_factor)
                .ok_or_else(|| "Main window size is invalid, save skipped".to_string())?
        }
    };

    app.state::<GuiConfigState>()
        .set_window_size(saved_size)
        .map(|_| ())
}

pub(crate) fn is_loopback_host(host: &str) -> bool {
    matches!(host.trim(), "127.0.0.1" | "localhost" | "::1")
}

pub(crate) fn sanitize_gui_config(config: &mut GuiConfigFile) -> Result<bool, String> {
    let mut changed = false;
    let normalized_locale = normalize_app_locale(&config.locale);
    if config.locale != normalized_locale {
        config.locale = normalized_locale.to_string();
        changed = true;
    }
    let host = config.host.trim();
    let host = if host.is_empty() {
        if config.allow_lan {
            "0.0.0.0"
        } else {
            "127.0.0.1"
        }
    } else {
        host
    };
    if config.host != host {
        config.host = host.to_string();
        changed = true;
    }
    let allow_lan = !is_loopback_host(&config.host);
    if config.allow_lan != allow_lan {
        config.allow_lan = allow_lan;
        changed = true;
    }
    let legacy_default_auth_dir = fixed_oauth_dir()?;
    if config.auth_dir.trim().is_empty()
        || Path::new(config.auth_dir.trim()) == legacy_default_auth_dir
    {
        config.auth_dir = DEFAULT_AUTH_DIR.to_string();
        changed = true;
    }
    let original_api_keys = config.api_keys.clone();
    let configured_keys = config
        .api_keys
        .iter()
        .map(|entry| entry.key.trim().to_string())
        .collect::<Vec<_>>();
    config.api_keys =
        merge_core_api_keys_with_gui_metadata(&config.api_keys, &configured_keys, None);
    for entry in &mut config.api_keys {
        entry.key = entry.key.trim().to_string();
        entry.remark = entry.remark.trim().to_string();
    }
    if config.api_keys != original_api_keys {
        changed = true;
    }
    let proxy_url = config.proxy_url.trim().to_string();
    if config.proxy_url != proxy_url {
        config.proxy_url = proxy_url;
        changed = true;
    }
    let routing_session_affinity_ttl = config.routing_session_affinity_ttl.trim().to_string();
    if config.routing_session_affinity_ttl != routing_session_affinity_ttl {
        config.routing_session_affinity_ttl = routing_session_affinity_ttl;
        changed = true;
    }
    let window_size = configured_window_size(config);
    let normalized_width = window_size.map(|size| size.width);
    let normalized_height = window_size.map(|size| size.height);
    if config.window_width != normalized_width || config.window_height != normalized_height {
        config.window_width = normalized_width;
        config.window_height = normalized_height;
        changed = true;
    }
    Ok(changed)
}

#[allow(dead_code)]
pub(crate) fn write_gui_config_legacy(config: &GuiConfigFile) -> Result<(), String> {
    validate_gui_config(config)?;
    let config_path = gui_config_path()?;
    let content =
        toml::to_string_pretty(config).map_err(|err| format!("Failed to serialize GUI config: {err}"))?;
    write_yaml_if_changed(&config_path, &content).map(|_| ())
}

pub(crate) fn write_gui_config(config: &GuiConfigFile) -> Result<(), String> {
    write_gui_config_to_path(config, &gui_config_path()?)
}

pub(crate) fn write_gui_config_to_path(
    config: &GuiConfigFile,
    config_path: &Path,
) -> Result<(), String> {
    use toml_edit::{value, Array, Document, InlineTable, Item, Value};

    validate_gui_config(config)?;
    let existing = fs::read_to_string(config_path).ok();
    let mut document = existing
        .as_deref()
        .filter(|content| !content.trim().is_empty())
        .and_then(|content| content.parse::<Document>().ok())
        .unwrap_or_default();
    let root = document.as_table_mut();
    for (key, item) in [
        ("locale", value(config.locale.as_str())),
        ("port", value(i64::from(config.port))),
        ("allow-lan", value(config.allow_lan)),
        ("host", value(config.host.as_str())),
        ("run-on-startup", value(config.run_on_startup)),
        ("start-core-on-launch", value(config.start_core_on_launch)),
        ("silent-start", value(config.silent_start)),
        ("close-behavior", value(config.close_behavior.as_str())),
        ("auth-dir", value(config.auth_dir.as_str())),
        (
            "management-secret-key",
            value(config.management_secret_key.as_str()),
        ),
        (
            "usage-statistics-enabled",
            value(config.usage_statistics_enabled),
        ),
        ("plugins-enabled", value(config.plugins_enabled)),
        ("routing-strategy", value(config.routing_strategy.as_str())),
        ("proxy-url", value(config.proxy_url.as_str())),
        (
            "routing-session-affinity",
            value(config.routing_session_affinity),
        ),
        (
            "routing-session-affinity-ttl",
            value(config.routing_session_affinity_ttl.as_str()),
        ),
        ("request-retry", value(i64::from(config.request_retry))),
        (
            "max-retry-credentials",
            value(i64::from(config.max_retry_credentials)),
        ),
        (
            "max-retry-interval",
            value(i64::from(config.max_retry_interval)),
        ),
        (
            "streaming-bootstrap-retries",
            value(i64::from(config.streaming_bootstrap_retries)),
        ),
    ] {
        set_codex_table_item(root, key, item);
    }
    for key in [
        "codex-session-repair-on-launch",
        "claude-code-working-directory",
        "claude-code-working-directory-prompt-disabled",
    ] {
        root.remove(key);
    }
    for (key, dimension) in [
        ("window-width", config.window_width),
        ("window-height", config.window_height),
    ] {
        if let Some(dimension) = dimension {
            set_codex_table_item(root, key, value(i64::from(dimension)));
        } else {
            root.remove(key);
        }
    }
    let mut api_keys = Array::new();
    for entry in &config.api_keys {
        let mut table = InlineTable::new();
        table.insert("key", Value::from(entry.key.as_str()));
        table.insert("remark", Value::from(entry.remark.as_str()));
        api_keys.push(Value::InlineTable(table));
    }
    set_codex_table_item(root, "api-keys", Item::Value(Value::Array(api_keys)));
    let mut api_access_remarks = Array::new();
    for entry in &config.api_access_remarks {
        let mut table = InlineTable::new();
        table.insert(
            "provider-section",
            Value::from(entry.provider_section.as_str()),
        );
        table.insert("api-key-hash", Value::from(entry.api_key_hash.as_str()));
        table.insert("remark", Value::from(entry.remark.as_str()));
        api_access_remarks.push(Value::InlineTable(table));
    }
    set_codex_table_item(
        root,
        "api-access-remarks",
        Item::Value(Value::Array(api_access_remarks)),
    );

    let content = document.to_string();
    toml::from_str::<GuiConfigFile>(&content)
        .map_err(|error| format!("Failed to validate GUI config: {error}"))?;
    if existing.as_deref() == Some(content.as_str()) {
        return Ok(());
    }
    write_bytes_directly(config_path, content.as_bytes())
}

pub(crate) fn validate_gui_config(config: &GuiConfigFile) -> Result<(), String> {
    if config.port == 0 {
        return Err("GUI config port must be between 1 and 65535".to_string());
    }
    if config.host.trim().is_empty() || config.host.chars().any(char::is_control) {
        return Err("GUI config host is invalid".to_string());
    }
    if config.auth_dir.trim().is_empty() || config.auth_dir.chars().any(char::is_control) {
        return Err("Credentials directory cannot be empty or contain control characters".to_string());
    }
    for entry in &config.api_keys {
        validate_core_api_key(&entry.key)?;
        validate_api_key_remark(&entry.remark)?;
    }
    for entry in &config.api_access_remarks {
        validate_api_access_provider_section(&entry.provider_section)?;
        if entry.api_key_hash.len() != 64
            || !entry
                .api_key_hash
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err("Invalid key fingerprint for API access remark".to_string());
        }
        validate_api_key_remark(&entry.remark)?;
    }
    validate_strong_management_secret_key(&config.management_secret_key)?;
    validate_routing_strategy(config.routing_strategy.trim())?;
    if config.proxy_url.chars().any(char::is_control) {
        return Err("Proxy URL cannot contain control characters".to_string());
    }
    if config
        .routing_session_affinity_ttl
        .chars()
        .any(char::is_control)
    {
        return Err("Session affinity TTL cannot contain control characters".to_string());
    }
    Ok(())
}

pub(crate) fn gui_config_path() -> Result<PathBuf, String> {
    Ok(core_base_dir()?.join(GUI_CONFIG_FILE))
}

pub(crate) fn legacy_gui_config_path() -> Result<PathBuf, String> {
    Ok(core_base_dir()?.join(LEGACY_GUI_CONFIG_FILE))
}
