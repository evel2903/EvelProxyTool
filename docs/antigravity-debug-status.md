# Antigravity desktop verification — 2026-09-21

The app now launches Antigravity 2.15.1 on Windows through an in-process CPA
bridge. A real desktop conversation returned `CPA_DESKTOP_OK`. No standalone
CLI, installed archive changes, global environment changes, or replacement of
the desktop Google login are required.

## Runtime evidence

- User confirmed successful native Google login.
- Native desktop launched from EvelProxyTool using the managed bridge session.
- At 19:30:43 (+07:00), the language-server log recorded two successful
  `v1internal:streamGenerateContent?alt=sse` calls through the loopback bridge.
- Native conversation “Desktop Verification Request” displayed `CPA_DESKTOP_OK`.
- CPA usage database recorded two successful requests at 19:30:40 (+07:00),
  both `gemini-3.8-flash-high`, using two distinct credential indices. These
  correspond to desktop inference and its background request, not two manual
  conversation turns. Public evidence labels the credentials account A and B;
  no account emails, keys, tokens, or private session URL are recorded here.
- Management API reported 11 active Antigravity credentials. Existing routing
  is round-robin, session affinity disabled; routing configuration was unchanged.
- Final embedded build was relaunched and tested through the product UI:
  Restore → Apply → Launch → native file-reading tool → final response
  `CPA_TOOL_ROUNDTRIP_OK`. Unrelated preference fingerprints remained identical
  before restore and after re-apply. The desktop retained its existing login.
- The final-build bridge showed **3 completed responses** with no UI error.
  Across both native tests, CPA recorded **5 successful requests using 5
  distinct credentials**, including background title generation and the
  tool-result continuation. See [redacted usage evidence](antigravity-runtime-evidence.json).
- Initial native test exposed plugin-catalog GET routes and analytics/trajectory
  POST routes missing from the bridge allowlist. They now retain native Google
  auth, with regression coverage ensuring CPA never receives those OAuth tokens.

## Implementation

- `agents/antigravity_desktop.rs`: version-checked managed launcher, current
  model/key validation, existing-process detection, session updates and status.
- `agents/antigravity_bridge.rs`: loopback random-session endpoint, browser-origin
  rejection, fixed upstream destinations, bounded request/response bodies,
  Gemini/Cloud Code envelopes, incremental SSE, disconnect cancellation and
  runtime completion counters. Account requests remain Google-authenticated;
  inference uses only the CPA client key and selected CPA model.
- Desktop launch is independent of CLI discovery. Unknown desktop versions are
  rejected until compatibility is tested. Closing configuration stops the bridge
  and restores managed config while preserving unrelated preferences.
- UI shows the last completed-response count separately from subsequent errors,
  so a non-inference warning cannot hide already verified routing.
- Keep EvelProxyTool running while using this desktop connection. Launch through
  the tool again after restarting Antigravity. Applied model changes take effect
  after pressing Launch to update the active session.

## Validation

- 21 focused Antigravity Rust tests passed after the native compatibility fixes.
- Earlier broader Rust run: 269 passed, 1 ignored, 1 known baseline test excluded
  (before three additional passing bridge tests were added).
- Baseline exclusion: `codex_model_list_is_empty_when_cpa_has_no_writable_models`
  expects an empty catalog, whereas existing code returns an error. Unchanged.
- TypeScript check and production frontend build passed.
- Final embedded desktop build and native regression checks passed. Build:
  `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --features tauri/custom-protocol`.
  Executable: `D:/EvelProxyTool/src-tauri/target/debug/cpa-gui.exe`.
- Synthetic HTTP tests cover HTTP 429, wrong routes, model changes, Google/CPA
  auth separation, malformed/truncated SSE, tool-signature preservation, native
  disconnect, restore, and listener teardown. They do not establish real quota
  exhaustion failover.

## Remaining limits

Only Antigravity 2.15.1 on Windows is supported by the version guard. This CPA
currently exposes one model, so changing to a second real model cannot be tested
on this installation. Cancellation is verified at the HTTP bridge level, not
through the native Cancel button. Real quota exhaustion is not induced; forced
quota failover is not claimed. The native account shown in Antigravity stays
unchanged while CPA selects upstream credentials for inference. An optional
native onboarding collection (`cascadeNuxes`) is outside the current allowlist
and logs HTTP 404; the verified conversation, plugin catalogs and tool-call
flows work. Unknown future Cloud Code routes are rejected explicitly.

## User test procedure

1. Open `D:/EvelProxyTool/src-tauri/target/debug/cpa-gui.exe` and ensure Core is running.
2. Select Cấu hình Agent → Google Antigravity → model → Áp dụng thay đổi cấu hình.
3. Save and close any Antigravity instance opened outside the tool, then press
   Khởi động Antigravity Desktop. Keep EvelProxyTool open.
4. Chat normally. Return to the Agent page to see completed CPA responses;
   use Lịch sử sử dụng to inspect model, results and selected accounts.
5. Đóng thay đổi cấu hình restores the previously backed-up managed field;
   it does not close the desktop or discard unrelated preferences. Restart
   Antigravity normally to resume its default connection after restoring.
