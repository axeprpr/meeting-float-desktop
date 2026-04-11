#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${APP_VERSION:-$(sed -n 's/.*\"version\": \"\\([^\"]*\\)\".*/\\1/p' "$ROOT/package.json" | head -n1)}"
DIST="$ROOT/dist/win-x64"
ZIP="$ROOT/dist/meeting-float-sciter-v${VERSION}-win-x64.zip"

mkdir -p "$DIST/runtime" "$DIST/modules" "$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST/runtime" "$DIST/modules"

curl -L https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/scapp.exe -o "$DIST/runtime/scapp.exe"
curl -L https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/sciter.dll -o "$DIST/runtime/sciter.dll"
curl -L https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/inspector.exe -o "$DIST/runtime/inspector.exe"

cp "$ROOT/index.htm" "$DIST/"
cp "$ROOT/autotest.htm" "$DIST/"
cp "$ROOT/app.css" "$DIST/"
cp "$ROOT/app.js" "$DIST/"
cp "$ROOT/README.md" "$DIST/"
cp "$ROOT/TESTING.md" "$DIST/"
cp "$ROOT/package.json" "$DIST/"
cp "$ROOT/modules/"*.js "$DIST/modules/"

cat > "$DIST/start.bat" <<'BAT'
@echo off
setlocal
set DIR=%~dp0
pushd "%DIR%"
"%DIR%runtime\scapp.exe" "%DIR%index.htm"
popd
endlocal
BAT

cat > "$DIST/autotest.bat" <<'BAT'
@echo off
setlocal
set DIR=%~dp0
pushd "%DIR%"
"%DIR%runtime\scapp.exe" "%DIR%autotest.htm"
popd
endlocal
BAT

chmod 0644 "$DIST/start.bat" "$DIST/autotest.bat"

rm -f "$ZIP"
(
  cd "$ROOT/dist"
  zip -qr "$(basename "$ZIP")" "win-x64"
)

echo "Built $DIST"
echo "Built $ZIP"
