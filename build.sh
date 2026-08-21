#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BUILD_JOBS="${CARGO_BUILD_JOBS:-20}"
GITCODE_GUI_REPOSITORY="${GITCODE_GUI_REPOSITORY:-lzt404/EvelProxyTool}"
GITCODE_CORE_REPOSITORY="${GITCODE_CORE_REPOSITORY:-lzt404/CLIProxyAPI}"
APP_BIN="$ROOT_DIR/src-tauri/target/release/cpa-gui"
BIN_DIR="$ROOT_DIR/bin-work"
BIN_OUT="$BIN_DIR/EvelProxyTool"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed or not in PATH."
  exit 1
fi

echo "Cargo build jobs: $BUILD_JOBS"
echo "GitCode GUI fallback repository: $GITCODE_GUI_REPOSITORY"
echo "GitCode core fallback repository: $GITCODE_CORE_REPOSITORY"
bun install
CARGO_BUILD_JOBS="$BUILD_JOBS" GITCODE_GUI_REPOSITORY="$GITCODE_GUI_REPOSITORY" GITCODE_CORE_REPOSITORY="$GITCODE_CORE_REPOSITORY" bun tauri build --no-bundle

if [ ! -x "$APP_BIN" ]; then
  echo "Build finished, but executable not found: $APP_BIN"
  exit 1
fi

mkdir -p "$BIN_DIR"
bun "$ROOT_DIR/scripts/portable.mjs" \
  --binary "$APP_BIN" \
  --output "$BIN_DIR" \
  --download true
chmod +x "$BIN_OUT"

echo "Built: $APP_BIN"
echo "Copied: $BIN_OUT"
