#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${APP_VERSION:-$(node -p "require('$ROOT/package.json').version")}"
DIST="$ROOT/dist/win-x64"
ZIP="$ROOT/dist/meeting-float-sciter-v${VERSION}-win-x64.zip"

mkdir -p "$DIST/modules" "$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST/modules"

(
  cd "$ROOT/helper"
  GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
    go build -o "$DIST/meeting-helper.exe" .
)

curl -L https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/scapp.exe -o "$DIST/Meeting Float.exe"
curl -L https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/sciter.dll -o "$DIST/sciter.dll"
curl -L https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/inspector.exe -o "$DIST/inspector.exe"

cp "$ROOT/index.htm" "$DIST/"
cp "$ROOT/autotest.htm" "$DIST/"
cp "$ROOT/minutes-window.htm" "$DIST/"
cp "$ROOT/app.css" "$DIST/"
cp "$ROOT/app.js" "$DIST/"
cp "$ROOT/README.md" "$DIST/"
cp "$ROOT/TESTING.md" "$DIST/"
cp "$ROOT/package.json" "$DIST/"
cp "$ROOT/modules/"*.js "$DIST/modules/"

cat > "$DIST/start.vbs" <<'VBS'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run """" & dir & "\meeting-helper.exe""", 0, False
WScript.Sleep 1200
shell.Run """" & dir & "\Meeting Float.exe"" """ & dir & "\index.htm""", 0, False
VBS

cat > "$DIST/autotest.vbs" <<'VBS'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run """" & dir & "\meeting-helper.exe""", 0, False
WScript.Sleep 1200
shell.Run """" & dir & "\Meeting Float.exe"" """ & dir & "\autotest.htm""", 0, False
VBS

cat > "$DIST/start.bat" <<'BAT'
@echo off
start "" wscript.exe "%~dp0start.vbs"
BAT

cat > "$DIST/autotest.bat" <<'BAT'
@echo off
start "" wscript.exe "%~dp0autotest.vbs"
BAT

chmod 0644 "$DIST/start.bat" "$DIST/autotest.bat" "$DIST/start.vbs" "$DIST/autotest.vbs"

rm -f "$ZIP"
(
  cd "$ROOT/dist"
  zip -qr "$(basename "$ZIP")" "win-x64"
)

echo "Built $DIST"
echo "Built $ZIP"
