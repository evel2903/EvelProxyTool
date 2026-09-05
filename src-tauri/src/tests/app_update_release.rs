use super::support::*;
use super::*;

// Opt-in release verification against GitHub, using the same source, validator,
// asset selection, ZIP parser, replacement, and rollback as the application.
// cargo test --manifest-path src-tauri/Cargo.toml published_portable_update -- --ignored --nocapture
#[tokio::test]
#[ignore = "downloads the latest published Windows release from GitHub"]
async fn published_portable_update_downloads_installs_and_rolls_back() {
    let client = reqwest::Client::builder()
        .redirect(release_https_redirect_policy())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .unwrap();
    let manifest = fetch_portable_update_manifest(&client).await.unwrap();
    assert_eq!(
        manifest.release_url,
        format!("https://github.com/evel2903/EvelProxyTool/releases/tag/v{}", manifest.version)
    );
    let (info, pending) = resolve_portable_app_update(
        &manifest,
        "0.0.0",
        Some(("windows-amd64", "amd64")),
        true,
    )
    .unwrap();
    assert!(info.update_available && info.auto_update_supported);
    let pending = pending.unwrap();
    let root = agent_test_home("published-portable-update");
    let archive = root.join("update.zip");
    let mut response = client
        .get(&pending.asset.url)
        .header(reqwest::header::USER_AGENT, APP_USER_AGENT)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let mut file = File::create(&archive).unwrap();
    let mut downloaded = 0;
    while let Some(chunk) = response.chunk().await.unwrap() {
        downloaded += chunk.len() as u64;
        assert!(downloaded <= pending.asset.size_bytes);
        file.write_all(&chunk).unwrap();
    }
    drop(file);
    assert_eq!(downloaded, pending.asset.size_bytes);
    assert_eq!(sha256_file(&archive).unwrap(), pending.asset.sha256);

    let staging = root.join("staging");
    let payload = extract_portable_update_archive(&archive, &staging).unwrap();
    assert_eq!(payload.manifest.version, manifest.version);
    assert_eq!(payload.manifest.platform, "windows");
    assert_eq!(payload.manifest.arch, "amd64");
    let core_archive_name = payload.core_archive_name.expect("full release selected");
    let app_dir = root.join("app");
    fs::create_dir_all(app_dir.join("cpa-core")).unwrap();
    fs::create_dir_all(app_dir.join(OAUTH_DIR_NAME)).unwrap();
    fs::write(app_dir.join(PORTABLE_APP_BINARY), b"old application").unwrap();
    fs::write(app_dir.join(PORTABLE_APP_MANIFEST_FILE), b"old metadata").unwrap();
    fs::write(app_dir.join(CORE_VERSION_FILE), b"7.2.0").unwrap();
    let preserved = [
        (app_dir.join(GUI_CONFIG_FILE), b"synthetic GUI config".as_slice()),
        (app_dir.join(OAUTH_DIR_NAME).join("fixture.json"), b"synthetic account".as_slice()),
        (app_dir.join("cpa-core/config.yaml"), b"synthetic core config".as_slice()),
        (app_dir.join("cpa-core/CLIProxyAPI_7.2.0_windows_amd64.zip"), b"previous core".as_slice()),
    ];
    for (path, contents) in &preserved {
        fs::write(path, contents).unwrap();
    }
    preflight_portable_update_directory(&app_dir).unwrap();
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
        staged_core_archive: staging.join("cpa-core").join(&core_archive_name),
        target_core_archive: app_dir.join("cpa-core").join(&core_archive_name),
        install_core_archive: true,
        ack_path: root.join("update-started.ack"),
        work_dir: root.clone(),
        target_version: manifest.version.clone(),
    };
    replace_portable_update_files(&descriptor).unwrap();
    for (current, staged) in [
        (&descriptor.current_exe, &descriptor.staged_exe),
        (&descriptor.current_manifest, &descriptor.staged_manifest),
        (&descriptor.current_core_version, &descriptor.staged_core_version),
        (&descriptor.target_core_archive, &descriptor.staged_core_archive),
    ] {
        assert_eq!(sha256_file(current).unwrap(), sha256_file(staged).unwrap());
    }
    for (path, contents) in &preserved {
        assert_eq!(&fs::read(path).unwrap(), contents);
    }
    restore_portable_update_backup(&descriptor).unwrap();
    assert_eq!(fs::read(&descriptor.current_exe).unwrap(), b"old application");
    assert_eq!(fs::read(&descriptor.current_manifest).unwrap(), b"old metadata");
    assert_eq!(fs::read(&descriptor.current_core_version).unwrap(), b"7.2.0");
    assert!(!descriptor.target_core_archive.exists());
    for (path, contents) in &preserved {
        assert_eq!(&fs::read(path).unwrap(), contents);
    }
    println!("Verified published v{}: HTTP source, {} bytes, SHA-256, full ZIP, replacement, user data preservation, rollback", manifest.version, downloaded);
    fs::remove_dir_all(root).unwrap();
}
