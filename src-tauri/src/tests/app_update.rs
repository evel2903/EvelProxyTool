use super::support::*;
use super::*;

#[test]
fn release_atom_parser_reads_first_release_tag() {
    let xml = r#"
          <feed>
            <entry>
              <link href="https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.80"/>
              <title>v7.2.80</title>
            </entry>
            <entry><title>v7.2.79</title></entry>
          </feed>
        "#;

    assert_eq!(release_tag_from_atom(xml).as_deref(), Some("v7.2.80"));
}

#[test]
fn app_update_comparison_uses_semantic_versions() {
    assert!(is_app_update_available("v0.1.9", "v0.2.0").unwrap());
    assert!(is_app_update_available("v0.2.0-beta.1", "v0.2.0").unwrap());
    assert!(!is_app_update_available("v0.2.0", "v0.2.0").unwrap());
    assert!(!is_app_update_available("v0.2.0", "v0.1.9").unwrap());
}

fn portable_update_test_asset(version: &str, arch: &str) -> PortableUpdateAsset {
    let (_, display, suffix) = portable_update_asset_platform().unwrap();
    let name = format!("EvelProxyTool-v{version}-{display}-{arch}.{suffix}");
    PortableUpdateAsset {
        url: format!("{}v{version}/{name}", app_release_download_prefix()),
        fallback_urls: Vec::new(),
        sha256: "ab".repeat(32),
        size_bytes: 1024,
    }
}

#[cfg(windows)]
fn portable_update_test_legacy_asset(version: &str, arch: &str) -> PortableUpdateAsset {
    let name = format!("EvelProxyTool-update-v{version}-Windows-{arch}.zip");
    PortableUpdateAsset {
        url: format!("{}v{version}/{name}", app_release_download_prefix()),
        fallback_urls: Vec::new(),
        sha256: "ab".repeat(32),
        size_bytes: 1024,
    }
}

fn portable_update_test_manifest(version: &str) -> PortableUpdateManifest {
    let (platform, _, _) = portable_update_asset_platform().unwrap();
    PortableUpdateManifest {
        schema_version: 1,
        version: version.to_string(),
        published_at: "2026-07-24T00:00:00.000Z".to_string(),
        release_url: format!(
            "https://github.com/evel2903/EvelProxyTool/releases/tag/v{version}"
        ),
        assets: [
            (
                format!("{platform}-amd64"),
                portable_update_test_asset(version, "amd64"),
            ),
            (
                format!("{platform}-aarch64"),
                portable_update_test_asset(version, "aarch64"),
            ),
        ]
        .into_iter()
        .collect(),
        full_assets: None,
    }
}

#[test]
fn portable_update_manifest_accepts_one_or_two_matching_github_assets() {
    let manifest = portable_update_test_manifest("1.2.3");
    assert!(validate_portable_update_manifest(&manifest).is_ok());

    #[cfg(windows)]
    {
        let mut legacy_manifest = portable_update_test_manifest("1.2.3");
        legacy_manifest.assets.insert(
            "windows-amd64".to_string(),
            portable_update_test_legacy_asset("1.2.3", "amd64"),
        );
        legacy_manifest.assets.insert(
            "windows-aarch64".to_string(),
            portable_update_test_legacy_asset("1.2.3", "aarch64"),
        );
        assert!(validate_portable_update_manifest(&legacy_manifest).is_ok());

        let mut dual_manifest = portable_update_test_manifest("1.2.3");
        dual_manifest.assets = [
            (
                "windows-amd64".to_string(),
                portable_update_test_legacy_asset("1.2.3", "amd64"),
            ),
            (
                "windows-aarch64".to_string(),
                portable_update_test_legacy_asset("1.2.3", "aarch64"),
            ),
        ]
        .into_iter()
        .collect();
        dual_manifest.full_assets = Some(
            [
                (
                    "windows-amd64".to_string(),
                    portable_update_test_asset("1.2.3", "amd64"),
                ),
                (
                    "windows-aarch64".to_string(),
                    portable_update_test_asset("1.2.3", "aarch64"),
                ),
            ]
            .into_iter()
            .collect(),
        );
        assert!(validate_portable_update_manifest(&dual_manifest).is_ok());
    }

    let (platform, _, _) = portable_update_asset_platform().unwrap();
    let mut missing_arch = portable_update_test_manifest("1.2.3");
    missing_arch.assets.remove(&format!("{platform}-aarch64"));
    assert!(validate_portable_update_manifest(&missing_arch).is_ok());

    let mut invalid_timestamp = portable_update_test_manifest("1.2.3");
    invalid_timestamp.published_at = "not-a-timestamp".to_string();
    assert!(validate_portable_update_manifest(&invalid_timestamp).is_err());

    let mut foreign_host = portable_update_test_manifest("1.2.3");
    foreign_host
            .assets
            .get_mut(&format!("{platform}-amd64"))
            .unwrap()
            .url = "https://github.com.example.invalid/router-for-me/EvelProxyTool/releases/download/v1.2.3/update.zip".to_string();
    assert!(validate_portable_update_manifest(&foreign_host).is_err());

    let mut mismatched_tag = portable_update_test_manifest("1.2.3");
    let (_, display, suffix) = portable_update_asset_platform().unwrap();
    mismatched_tag
        .assets
        .get_mut(&format!("{platform}-amd64"))
        .unwrap()
        .url = format!(
        "{}v9.9.9/EvelProxyTool-v1.2.3-{display}-amd64.{suffix}",
        app_release_download_prefix()
    );
    assert!(validate_portable_update_manifest(&mismatched_tag).is_err());
}

#[test]
fn portable_update_urls_use_the_published_gui_repository() {
    assert_eq!(APP_RELEASES_URL, "https://github.com/evel2903/EvelProxyTool/releases");
    assert_eq!(
        app_release_download_prefix(),
        "https://github.com/evel2903/EvelProxyTool/releases/download/"
    );
    let (platform, _, _) = portable_update_asset_platform().unwrap();
    assert_eq!(
        app_update_manifest_url(),
        format!("https://github.com/evel2903/EvelProxyTool/releases/latest/download/portable-update-{platform}.json")
    );
}

#[cfg(windows)]
#[test]
fn portable_update_manifest_accepts_the_published_v0_2_28_windows_release() {
    // This release fixture is independent of updater constants and test URL builders.
    let manifest: PortableUpdateManifest = serde_json::from_str(include_str!(
        "fixtures/portable-update-windows-v0.2.28.json"
    ))
    .unwrap();
    validate_portable_update_manifest(&manifest).unwrap();
    let (info, pending) = resolve_portable_app_update(
        &manifest,
        "0.2.27",
        Some(("windows-amd64", "amd64")),
        true,
    )
    .unwrap();
    assert!(info.update_available);
    assert!(info.auto_update_supported);
    assert_eq!(info.download_size_bytes, Some(28891071));
    assert_eq!(
        pending.unwrap().asset.url,
        "https://github.com/evel2903/EvelProxyTool/releases/download/v0.2.28/EvelProxyTool-v0.2.28-Windows-amd64.zip"
    );
}

#[test]
fn portable_update_manifest_rejects_empty_unknown_and_mismatched_architectures() {
    let (platform, _, _) = portable_update_asset_platform().unwrap();
    let mut empty = portable_update_test_manifest("1.2.3");
    empty.assets.clear();
    assert!(validate_portable_update_manifest(&empty).is_err());

    let mut empty_full = portable_update_test_manifest("1.2.3");
    empty_full.full_assets = Some(Default::default());
    assert!(validate_portable_update_manifest(&empty_full).is_err());

    for key in [format!("{platform}-x86_64"), "other-amd64".to_string()] {
        let mut unknown = portable_update_test_manifest("1.2.3");
        unknown.assets = [(key, portable_update_test_asset("1.2.3", "amd64"))]
            .into_iter()
            .collect();
        assert!(validate_portable_update_manifest(&unknown).is_err());
    }

    let mut mismatched = portable_update_test_manifest("1.2.3");
    mismatched.assets.insert(
        format!("{platform}-amd64"),
        portable_update_test_asset("1.2.3", "aarch64"),
    );
    assert!(validate_portable_update_manifest(&mismatched).is_err());
}

#[test]
fn portable_update_manifest_rejects_untrusted_or_mismatched_release_urls() {
    for release_url in [
        "https://github.com/router-for-me/EvelProxyTool/releases/tag/v1.2.3",
        "https://github.com/evel2903/EvelProxyTool/releases/tag/v9.9.9",
        "https://github.com/evel2903/EvelProxyTool/releases/tag/v1.2.3/extra",
        "https://github.com/evel2903/EvelProxyTool/releases/tag/v1.2.3?source=test",
        "https://github.com/evel2903/EvelProxyTool/releases/tag/v1.2.3#fragment",
        "http://github.com/evel2903/EvelProxyTool/releases/tag/v1.2.3",
        "https://github.com.example.invalid/evel2903/EvelProxyTool/releases/tag/v1.2.3",
        "https://github.com:444/evel2903/EvelProxyTool/releases/tag/v1.2.3",
        "https://user@github.com/evel2903/EvelProxyTool/releases/tag/v1.2.3",
    ] {
        let mut manifest = portable_update_test_manifest("1.2.3");
        manifest.release_url = release_url.to_string();
        assert!(validate_portable_update_manifest(&manifest).is_err(), "{release_url}");
    }
}

#[test]
fn portable_update_manifest_retains_download_integrity_checks() {
    let (platform, display, suffix) = portable_update_asset_platform().unwrap();
    let key = format!("{platform}-amd64");
    let valid_url = portable_update_test_asset("1.2.3", "amd64").url;
    for url in [
        valid_url.replace("https://", "http://"),
        valid_url.replace("github.com/", "github.com.example.invalid/"),
        valid_url.replace("github.com/", "user@github.com/"),
        valid_url.replace("github.com/", "github.com:444/"),
        valid_url.replace("evel2903/", "router-for-me/"),
        valid_url.replace("EvelProxyTool/releases", "EvelProxyTool-copy/releases"),
        format!("{valid_url}?download=true"),
        format!("{valid_url}#fragment"),
        format!("{}v1.2.3/Other-v1.2.3-{display}-amd64.{suffix}", app_release_download_prefix()),
    ] {
        let mut manifest = portable_update_test_manifest("1.2.3");
        manifest.assets.get_mut(&key).unwrap().url = url.clone();
        assert!(validate_portable_update_manifest(&manifest).is_err(), "{url}");
    }
    for size in [0, 512 * 1024 * 1024 + 1] {
        let mut manifest = portable_update_test_manifest("1.2.3");
        manifest.assets.get_mut(&key).unwrap().size_bytes = size;
        assert!(validate_portable_update_manifest(&manifest).is_err());
    }
    for digest in ["ab".repeat(31), "zz".repeat(32)] {
        let mut manifest = portable_update_test_manifest("1.2.3");
        manifest.assets.get_mut(&key).unwrap().sha256 = digest;
        assert!(validate_portable_update_manifest(&manifest).is_err());
    }
}

#[test]
fn portable_update_missing_current_architecture_reports_unsupported_without_pending_update() {
    let (platform, _, _) = portable_update_asset_platform().unwrap();
    let (key, arch) = portable_update_target().unwrap();
    let mut manifest = portable_update_test_manifest("1.2.3");
    manifest.assets.remove(key);
    validate_portable_update_manifest(&manifest).unwrap();
    let (info, pending) =
        resolve_portable_app_update(&manifest, "1.2.2", Some((key, arch)), true).unwrap();
    assert!(info.update_available);
    assert!(!info.auto_update_supported);
    assert!(info.download_size_bytes.is_none());
    assert!(info.unsupported_reason.unwrap().contains("current platform or architecture"));
    assert!(pending.is_none());
    assert_eq!(manifest.assets.len(), 1, "{platform}");
}

#[test]
fn portable_update_resolution_requires_a_portable_install_and_newer_version() {
    let manifest = portable_update_test_manifest("1.2.3");
    let target = portable_update_target();
    let (unsupported, pending) =
        resolve_portable_app_update(&manifest, "1.2.2", target, false).unwrap();
    assert!(!unsupported.auto_update_supported);
    assert!(unsupported.unsupported_reason.unwrap().contains("not a portable version"));
    assert!(pending.is_none());
    let (current, pending) =
        resolve_portable_app_update(&manifest, "1.2.3", target, true).unwrap();
    assert!(!current.update_available);
    assert!(current.auto_update_supported);
    assert!(pending.is_none());
}

#[cfg(windows)]
#[test]
fn portable_update_selects_full_asset_per_target_with_legacy_fallback() {
    let mut manifest = portable_update_test_manifest("1.2.3");
    for arch in ["amd64", "aarch64"] {
        manifest.assets.insert(
            format!("windows-{arch}"),
            portable_update_test_legacy_asset("1.2.3", arch),
        );
    }
    manifest.full_assets = Some(
        [("windows-amd64".to_string(), portable_update_test_asset("1.2.3", "amd64"))]
            .into_iter()
            .collect(),
    );
    validate_portable_update_manifest(&manifest).unwrap();
    assert_eq!(
        select_portable_update_asset(&manifest, "windows-amd64").unwrap().url,
        portable_update_test_asset("1.2.3", "amd64").url
    );
    let (info, pending) = resolve_portable_app_update(
        &manifest,
        "1.2.2",
        Some(("windows-aarch64", "aarch64")),
        true,
    )
    .unwrap();
    assert!(info.auto_update_supported);
    assert_eq!(
        pending.unwrap().asset.url,
        portable_update_test_legacy_asset("1.2.3", "aarch64").url
    );
    manifest.full_assets = None;
    assert_eq!(
        select_portable_update_asset(&manifest, "windows-amd64").unwrap().url,
        portable_update_test_legacy_asset("1.2.3", "amd64").url
    );
}

#[cfg(windows)]
#[test]
fn portable_update_full_catalog_rejects_legacy_packages() {
    let mut manifest = portable_update_test_manifest("1.2.3");
    manifest.full_assets = Some(
        [("windows-amd64".to_string(), portable_update_test_legacy_asset("1.2.3", "amd64"))]
            .into_iter()
            .collect(),
    );
    assert!(validate_portable_update_manifest(&manifest).is_err());
}

#[test]
fn portable_update_asset_accepts_only_the_configured_gitcode_fallback() {
    let mut asset = portable_update_test_asset("1.2.3", "amd64");
    let (_, display, suffix) = portable_update_asset_platform().unwrap();
    let filename = format!("EvelProxyTool-v1.2.3-{display}-amd64.{suffix}");
    asset.fallback_urls = vec![gitcode_release_attachment_url(
        "mirror-owner/EvelProxyTool",
        "v1.2.3",
        &filename,
    )];
    assert!(validate_portable_update_asset_fallbacks_for_repository(
        &asset,
        "v1.2.3",
        &[&filename],
        Some("mirror-owner/EvelProxyTool"),
    )
    .is_ok());
    assert!(validate_portable_update_asset_fallbacks_for_repository(
        &asset,
        "v1.2.3",
        &[&filename],
        Some("another-owner/EvelProxyTool"),
    )
    .is_err());
}

#[test]
fn portable_update_state_supports_cancellation_and_snapshot_recovery() {
    let state = AppUpdateState::default();
    let pending = PendingAppUpdate {
        version: "1.2.3".to_string(),
        asset: portable_update_test_asset("1.2.3", "amd64"),
        arch: "amd64".to_string(),
    };
    state.set_pending(
        Some(pending),
        AppUpdateTask {
            phase: "available".to_string(),
            target_version: Some("1.2.3".to_string()),
            ..AppUpdateTask::default()
        },
    );

    let token = CancellationToken::new();
    let started = state.start(token.clone()).unwrap();
    assert_eq!(started.version, "1.2.3");
    let recovered = state.snapshot();
    assert!(recovered.running);
    assert!(recovered.cancellable);
    assert_eq!(recovered.phase, "downloading");

    state.cancel();
    assert!(token.is_cancelled());
    let finished = state.finish("cancelled", Some("cancelled".to_string()));
    assert!(!finished.running);
    assert!(!finished.cancellable);
    assert_eq!(state.snapshot().phase, "cancelled");
}

#[test]
fn sha256_file_hashes_exact_portable_asset_bytes() {
    let root = agent_test_home("portable-sha256");
    let asset = root.join("update.zip");
    fs::write(&asset, b"EvelProxyTool portable update").unwrap();

    assert_eq!(
        sha256_file(&asset).unwrap(),
        "5ef66a1a4e4078044e40413955788596a42c088551409e1ea9e26a60cbd8a9fd"
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
fn write_portable_update_zip(path: &Path, entries: &[(&str, &[u8], Option<u32>)]) {
    use zip::write::SimpleFileOptions;

    let file = File::create(path).unwrap();
    let mut archive = zip::ZipWriter::new(file);
    for (name, contents, unix_mode) in entries {
        let mut options = SimpleFileOptions::default();
        if let Some(mode) = unix_mode {
            options = options.unix_permissions(*mode);
        }
        archive.start_file(*name, options).unwrap();
        archive.write_all(contents).unwrap();
    }
    archive.finish().unwrap();
}

#[cfg(windows)]
#[test]
fn portable_update_zip_accepts_the_complete_release_package() {
    let root = agent_test_home("portable-zip");
    let valid_zip = root.join("valid.zip");
    let manifest = br#"{"schemaVersion":1,"application":"EvelProxyTool","version":"1.2.3","platform":"windows","arch":"amd64","autoUpdate":true}"#;
    write_portable_update_zip(
            &valid_zip,
            &[
                (
                    "EvelProxyTool-v1.2.3-Windows-amd64/EvelProxyTool.exe",
                    b"new executable",
                    None,
                ),
                (
                    "EvelProxyTool-v1.2.3-Windows-amd64/portable-app.json",
                    manifest,
                    None,
                ),
                (
                    "EvelProxyTool-v1.2.3-Windows-amd64/core-version.txt",
                    b"7.2.109\n",
                    None,
                ),
                (
                    "EvelProxyTool-v1.2.3-Windows-amd64/cpa-core/CLIProxyAPI_7.2.109_windows_amd64.zip",
                    b"core archive",
                    None,
                ),
            ],
        );
    let extracted = extract_portable_update_archive(&valid_zip, &root.join("valid")).unwrap();
    assert_eq!(extracted.manifest.version, "1.2.3");
    assert!(extracted.manifest.auto_update);
    assert_eq!(
        extracted.core_archive_name,
        Some("CLIProxyAPI_7.2.109_windows_amd64.zip".to_string())
    );

    let legacy_zip = root.join("legacy.zip");
    write_portable_update_zip(
        &legacy_zip,
        &[
            (PORTABLE_APP_BINARY, b"legacy executable", None),
            (PORTABLE_APP_MANIFEST_FILE, manifest, None),
        ],
    );
    let legacy = extract_portable_update_archive(&legacy_zip, &root.join("legacy")).unwrap();
    assert_eq!(legacy.manifest.version, "1.2.3");
    assert!(legacy.core_archive_name.is_none());

    let traversal_zip = root.join("traversal.zip");
    write_portable_update_zip(
        &traversal_zip,
        &[
            ("../EvelProxyTool.exe", b"malicious", None),
            (
                "EvelProxyTool-v1.2.3-Windows-amd64/portable-app.json",
                manifest,
                None,
            ),
        ],
    );
    assert!(extract_portable_update_archive(&traversal_zip, &root.join("traversal")).is_err());

    let symlink_zip = root.join("symlink.zip");
    {
        use zip::write::SimpleFileOptions;

        let file = File::create(&symlink_zip).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .add_symlink(
                "EvelProxyTool-v1.2.3-Windows-amd64/EvelProxyTool.exe",
                "target.exe",
                SimpleFileOptions::default(),
            )
            .unwrap();
        archive
            .start_file(
                "EvelProxyTool-v1.2.3-Windows-amd64/portable-app.json",
                SimpleFileOptions::default(),
            )
            .unwrap();
        archive.write_all(manifest).unwrap();
        archive.finish().unwrap();
    }
    assert!(extract_portable_update_archive(&symlink_zip, &root.join("symlink")).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn portable_update_replacement_preserves_user_data_and_can_roll_back() {
    let root = agent_test_home("portable-replace");
    let app_dir = root.join("app");
    let work_dir = root.join("work");
    let staging = work_dir.join("staging");
    fs::create_dir_all(&app_dir).unwrap();
    fs::create_dir_all(&staging).unwrap();
    fs::create_dir_all(app_dir.join("cpa-core")).unwrap();
    fs::create_dir_all(staging.join("cpa-core")).unwrap();
    fs::write(app_dir.join(PORTABLE_APP_BINARY), b"old exe").unwrap();
    fs::write(app_dir.join(PORTABLE_APP_MANIFEST_FILE), b"old manifest").unwrap();
    fs::write(app_dir.join(CORE_VERSION_FILE), b"7.2.100").unwrap();
    fs::write(
        app_dir
            .join("cpa-core")
            .join("CLIProxyAPI_7.2.100_windows_amd64.zip"),
        b"old core archive",
    )
    .unwrap();
    fs::write(app_dir.join(GUI_CONFIG_FILE), b"user config").unwrap();
    fs::create_dir_all(app_dir.join(OAUTH_DIR_NAME)).unwrap();
    fs::write(app_dir.join(OAUTH_DIR_NAME).join("account.json"), b"oauth").unwrap();
    fs::write(staging.join(PORTABLE_APP_BINARY), b"new exe").unwrap();
    fs::write(staging.join(PORTABLE_APP_MANIFEST_FILE), b"new manifest").unwrap();
    fs::write(staging.join(CORE_VERSION_FILE), b"7.2.109").unwrap();
    fs::write(
        staging
            .join("cpa-core")
            .join("CLIProxyAPI_7.2.109_windows_amd64.zip"),
        b"new core archive",
    )
    .unwrap();
    let descriptor = PortableUpdateDescriptor {
        parent_pid: 1,
        current_exe: app_dir.join(PORTABLE_APP_BINARY),
        staged_exe: staging.join(PORTABLE_APP_BINARY),
        current_manifest: app_dir.join(PORTABLE_APP_MANIFEST_FILE),
        staged_manifest: staging.join(PORTABLE_APP_MANIFEST_FILE),
        backup_exe: app_dir.join(".EvelProxyTool.exe.update-backup"),
        backup_manifest: app_dir.join(".portable-app.json.update-backup"),
        current_core_version: app_dir.join(CORE_VERSION_FILE),
        staged_core_version: staging.join(CORE_VERSION_FILE),
        backup_core_version: app_dir.join(".core-version.txt.update-backup"),
        staged_core_archive: staging
            .join("cpa-core")
            .join("CLIProxyAPI_7.2.109_windows_amd64.zip"),
        target_core_archive: app_dir
            .join("cpa-core")
            .join("CLIProxyAPI_7.2.109_windows_amd64.zip"),
        install_core_archive: true,
        ack_path: work_dir.join("update-started.ack"),
        work_dir,
        target_version: "1.2.3".to_string(),
    };

    replace_portable_update_files(&descriptor).unwrap();
    assert_eq!(fs::read(&descriptor.current_exe).unwrap(), b"new exe");
    assert_eq!(
        fs::read(&descriptor.current_manifest).unwrap(),
        b"new manifest"
    );
    assert_eq!(
        fs::read(&descriptor.current_core_version).unwrap(),
        b"7.2.109"
    );
    assert_eq!(
        fs::read(&descriptor.target_core_archive).unwrap(),
        b"new core archive"
    );
    assert_eq!(
        fs::read(app_dir.join(GUI_CONFIG_FILE)).unwrap(),
        b"user config"
    );
    assert_eq!(
        fs::read(app_dir.join(OAUTH_DIR_NAME).join("account.json")).unwrap(),
        b"oauth"
    );

    restore_portable_update_backup(&descriptor).unwrap();
    assert_eq!(fs::read(&descriptor.current_exe).unwrap(), b"old exe");
    assert_eq!(
        fs::read(&descriptor.current_manifest).unwrap(),
        b"old manifest"
    );
    assert_eq!(
        fs::read(&descriptor.current_core_version).unwrap(),
        b"7.2.100"
    );
    assert!(!descriptor.target_core_archive.exists());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn portable_update_tar_gz_accepts_the_complete_linux_release() {
    use flate2::{write::GzEncoder, Compression};
    use tar::{Builder, Header};

    let root = agent_test_home("portable-linux-tar");
    let archive_path = root.join("update.tar.gz");
    let file = File::create(&archive_path).unwrap();
    let encoder = GzEncoder::new(file, Compression::default());
    let mut archive = Builder::new(encoder);
    let package_root = "EvelProxyTool-v1.2.3-Linux-amd64";
    let manifest = br#"{"schemaVersion":1,"application":"EvelProxyTool","version":"1.2.3","platform":"linux","arch":"amd64","autoUpdate":true}"#;
    for (path, contents, mode) in [
        (
            format!("{package_root}/EvelProxyTool"),
            b"binary".as_slice(),
            0o755,
        ),
        (
            format!("{package_root}/portable-app.json"),
            manifest.as_slice(),
            0o644,
        ),
        (
            format!("{package_root}/core-version.txt"),
            b"7.2.109\n".as_slice(),
            0o644,
        ),
        (
            format!("{package_root}/cpa-core/CLIProxyAPI_7.2.109_linux_amd64.tar.gz"),
            b"core archive".as_slice(),
            0o644,
        ),
    ] {
        let mut header = Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(mode);
        header.set_cksum();
        archive.append_data(&mut header, path, contents).unwrap();
    }
    archive.into_inner().unwrap().finish().unwrap();

    let staging = root.join("staging");
    let package = extract_portable_update_tar_gz(&archive_path, &staging).unwrap();
    assert_eq!(package.manifest.platform, "linux");
    assert_eq!(package.manifest.arch, "amd64");
    assert_eq!(
        package.core_archive_name.as_deref(),
        Some("CLIProxyAPI_7.2.109_linux_amd64.tar.gz")
    );
    assert_eq!(
        fs::read(staging.join(PORTABLE_APP_BINARY)).unwrap(),
        b"binary"
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn macos_update_descriptor_is_confined_to_the_app_and_temp_directories() {
    let root = agent_test_home("portable-macos-descriptor");
    let work_dir = root.join("EvelProxyTool-update-1.2.3-1-1");
    let current_app = root.join("Applications").join("EvelProxyTool.app");
    let executable_relative_path = PathBuf::from("Contents/MacOS/cpa-gui");
    let current_exe = current_app.join(&executable_relative_path);
    let staged_app = work_dir.join("staging").join("EvelProxyTool.app");
    let staged_exe = staged_app.join(&executable_relative_path);
    fs::create_dir_all(current_exe.parent().unwrap()).unwrap();
    fs::create_dir_all(staged_exe.parent().unwrap()).unwrap();
    fs::write(&current_exe, b"old").unwrap();
    fs::write(&staged_exe, b"new").unwrap();
    let descriptor = MacosUpdateDescriptor {
        parent_pid: 1,
        current_app: current_app.clone(),
        staged_app,
        backup_app: current_app
            .parent()
            .unwrap()
            .join(".EvelProxyTool.app.update-backup"),
        executable_relative_path,
        ack_path: work_dir.join("update-started.ack"),
        work_dir: work_dir.clone(),
        target_version: "1.2.3".to_string(),
    };
    fs::create_dir_all(&work_dir).unwrap();
    let descriptor_path = work_dir.join("update-descriptor.json");
    fs::write(
        &descriptor_path,
        serde_json::to_vec_pretty(&descriptor).unwrap(),
    )
    .unwrap();
    assert!(validate_macos_update_descriptor(&descriptor_path, &descriptor).is_ok());
    assert_eq!(
        macos_application_bundle_from_executable(&current_exe).unwrap(),
        current_app
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn synthetic_release_uses_fork_asset_names_and_urls() {
    let release = release_from_tag("7.2.80");
    let platform = CorePlatform {
        os: "linux".to_string(),
        arch: "x86_64".to_string(),
        asset_os: "linux".to_string(),
        asset_arch: "amd64".to_string(),
        archive_kind: "tar.gz".to_string(),
    };
    let asset = select_release_asset(&release, &platform).unwrap();

    assert_eq!(release.tag_name, "v7.2.80");
    assert_eq!(asset.name, "CLIProxyAPI_7.2.80_linux_amd64.tar.gz");
    assert_eq!(
            asset.browser_download_url,
            "https://github.com/evel2903/CLIProxyAPI/releases/download/v7.2.80/CLIProxyAPI_7.2.80_linux_amd64.tar.gz"
        );
}

#[test]
fn synthetic_core_release_uses_gitcode_as_download_fallback() {
    let repository = "lzt404/CLIProxyAPI";
    let release = release_from_tag_for_repositories("7.2.80", Some(repository), false);
    let platform = CorePlatform {
        os: "windows".to_string(),
        arch: "x86_64".to_string(),
        asset_os: "windows".to_string(),
        asset_arch: "amd64".to_string(),
        archive_kind: "zip".to_string(),
    };
    let asset = select_release_asset(&release, &platform).unwrap();

    assert_eq!(
            asset.browser_download_url,
            "https://github.com/evel2903/CLIProxyAPI/releases/download/v7.2.80/CLIProxyAPI_7.2.80_windows_amd64.zip"
        );
    assert_eq!(
            asset.fallback_download_urls,
            ["https://api.gitcode.com/api/v5/repos/lzt404/CLIProxyAPI/releases/v7.2.80/attach_files/CLIProxyAPI_7.2.80_windows_amd64.zip/download"]
        );
}

#[test]
fn gitcode_discovered_core_release_downloads_from_gitcode_first() {
    let release = release_from_gitcode_tag("v7.2.80", "lzt404/CLIProxyAPI");
    let platform = CorePlatform {
        os: "linux".to_string(),
        arch: "aarch64".to_string(),
        asset_os: "linux".to_string(),
        asset_arch: "aarch64".to_string(),
        archive_kind: "tar.gz".to_string(),
    };
    let asset = select_release_asset(&release, &platform).unwrap();

    assert_eq!(
            asset.browser_download_url,
            "https://api.gitcode.com/api/v5/repos/lzt404/CLIProxyAPI/releases/v7.2.80/attach_files/CLIProxyAPI_7.2.80_linux_aarch64.tar.gz/download"
        );
    assert!(asset.fallback_download_urls.is_empty());
}

#[test]
fn release_asset_names_cover_the_six_supported_gui_targets() {
    let targets = [
        ("linux", "amd64", "tar.gz"),
        ("linux", "aarch64", "tar.gz"),
        ("darwin", "amd64", "tar.gz"),
        ("darwin", "aarch64", "tar.gz"),
        ("windows", "amd64", "zip"),
        ("windows", "aarch64", "zip"),
    ];
    for (os, arch, archive_kind) in targets {
        let platform = CorePlatform {
            os: os.to_string(),
            arch: arch.to_string(),
            asset_os: os.to_string(),
            asset_arch: arch.to_string(),
            archive_kind: archive_kind.to_string(),
        };
        assert_eq!(
            core_release_asset_name("v7.2.83", &platform),
            format!("CLIProxyAPI_7.2.83_{os}_{arch}.{archive_kind}")
        );
    }
}
