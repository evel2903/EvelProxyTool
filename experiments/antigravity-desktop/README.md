# Antigravity desktop: offline protocol probe

This is step 1 investigation code, **not a working desktop adapter**. It is not
imported by EvelProxyTool and cannot launch an app, listen on a port, load keys,
or send requests. All tests use synthetic fixtures.

Run from the repository root:

```powershell
python -B -m unittest discover -s experiments/antigravity-desktop -p 'test_*.py' -v
```

The standard-library-only probe experiments with the data portion of a possible
Cloud Code → CPA Gemini adapter: extracting the inference request, selecting the
configured model, restoring the response envelope, and translating SSE events
incrementally. It preserves nested tool calls, tool results, signatures and
usage fields. It never synthesizes successful completions or account status.

The experiment is based on CPA's actual translator at source revision
`a5ab69521f7b4e0f244836d0419da8fcd89408ea`:

- [Gemini request to Antigravity envelope](https://github.com/router-for-me/CLIProxyAPI/blob/a5ab69521f7b4e0f244836d0419da8fcd89408ea/internal/translator/antigravity/gemini/antigravity_gemini_request.go)
- [Antigravity response to Gemini](https://github.com/router-for-me/CLIProxyAPI/blob/a5ab69521f7b4e0f244836d0419da8fcd89408ea/internal/translator/antigravity/gemini/antigravity_gemini_response.go)

This source snapshot is not proof of the locally running CPA binary's version
or the native desktop's accepted response contract.

## Findings from the installed desktop

Desktop version: 2.15.1. Read-only inspection identified the following binaries:

| Artifact | SHA-256 |
| --- | --- |
| `resources/bin/language_server.exe` | `FD40688084A6B5A84CE0F0D6B44F142C88929F11BA47A823C4BDF055AC8864B7` |
| `resources/app.asar` | `0F81685E9836DDF5A382869BEA348385650CFE1BFEECBD2E2D902A571CE57261` |

Go function metadata, reflected field offsets, and disassembly were inspected
without modifying either artifact. Addresses below are RVAs relative to the
PE image base; they are evidence for this hash only, not patch locations.

- `CreateLanguageServerAndServe` calls `os.Getenv("CLOUD_CODE_URL")` at RVA
  `0x29a0a15`. A nonempty value replaces `LanguageServerConfig.CloudCodeServerURL`.
  This establishes an endpoint input in native code, not successful proxying.
- In that same function, the construction of `GeminiAPIKeyAuthProvider` is
  conditional on `LanguageServerConfig.CLI` (field offset `0x2f0`) being true,
  `AntigravityHub` (`0x380`) being false, and `ModelAPIClientType` (`0x1d8`)
  equaling the Gemini enum value. The branch starts at RVA `0x29a0d57`; the
  chosen interface's method table resolves to `GeminiAPIKeyAuthProvider` methods.
- `IsTerminalCLI` at RVA `0x2931900` independently checks those CLI/Hub booleans.
- `setUpClients` can take a supplied auth provider; absent that, its standalone
  branch calls `NewStandaloneAuthProvider` at RVA `0x2999b0c`.
- The extracted desktop launcher supplies `--standalone`, `--subclient_type hub`
  and Google endpoints. It does not supply an API-key auth provider. Setting a
  model client flag alone does not prove the API-key authentication branch runs.

These findings explain why the original isolated probe entered OAuth. They do
not justify changing internal flags or claiming that desktop supports the CLI's
API-key setup. The next candidate to investigate is its native Cloud Code
endpoint input and the required API compatibility, retaining normal desktop auth.

## What the 13 tests do and do not establish

Tests cover inference envelopes, explicit model selection, nested tool payloads,
blocked-prompt/usage responses, SSE split at every byte boundary (including UTF-8
and CRLF), multiline data, keepalives, error events, truncation, event limits and
stopping consumption. Passing them proves behavior of this offline code only.

The following remain unresolved before a runtime adapter can be selected:

- Desktop control-plane calls (login status, account entitlement, model catalog,
  quotas, onboarding and token counting); unknown methods are rejected here.
- The desktop's actual request queries, transport framing, HTTP status behavior
  and additional envelope metadata. This probe only accepts the two exact paths
  in its fixtures. Non-JSON data, including `[DONE]`, is deliberately unsupported.
- How a future local adapter authenticates callers, keeps native account tokens
  separate from CPA client credentials, and prevents accidental forwarding.
- Actual cancellation of upstream requests, reconnection, and app lifecycle.
- End-to-end desktop inference, streaming and rotation between real credentials.

The earlier runtime launch with a CPA endpoint/key was rejected by automatic
approval review. No alternate launch or application patch was used to perform
that blocked action. Static analysis and these offline tests do not remove that
runtime verification blocker.
