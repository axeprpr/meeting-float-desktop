#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${APP_VERSION:-$(node -p "require('$ROOT/package.json').version")}"
DIST="$ROOT/dist/win-x64"
ZIP="$ROOT/dist/meeting-float-sciter-v${VERSION}-win-x64.zip"

mkdir -p "$DIST/modules" "$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST/modules"

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

if [[ -f "$ROOT/native/windows/meeting_audio/target/release/meeting_audio.dll" ]]; then
  cp "$ROOT/native/windows/meeting_audio/target/release/meeting_audio.dll" "$DIST/"
fi

if [[ -f "$ROOT/native/windows/sciter_host/build/Meeting Float Native.exe" ]]; then
  cp "$ROOT/native/windows/sciter_host/build/Meeting Float Native.exe" "$DIST/"
fi

for dll in libc++.dll libunwind.dll libwinpthread-1.dll; do
  if [[ -f "$ROOT/.tools/llvm-mingw-20240619-ucrt-x86_64/bin/$dll" ]]; then
    cp "$ROOT/.tools/llvm-mingw-20240619-ucrt-x86_64/bin/$dll" "$DIST/"
  fi
done

cat > "$DIST/start.vbs" <<'VBS'
On Error Resume Next
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
target = dir & "\Meeting Float.exe"
If fso.FileExists(dir & "\Meeting Float Native.exe") Then
  target = dir & "\Meeting Float Native.exe"
End If
If InStr(target, "Native.exe") > 0 Then
  shell.Run """" & target & """", 0, False
Else
  shell.Run """" & target & """" & " """ & dir & "\index.htm""", 0, False
End If
VBS

cat > "$DIST/autotest.vbs" <<'VBS'
On Error Resume Next
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
target = dir & "\Meeting Float.exe"
If fso.FileExists(dir & "\Meeting Float Native.exe") Then
  target = dir & "\Meeting Float Native.exe"
End If
If InStr(target, "Native.exe") > 0 Then
  shell.Run """" & target & """", 0, False
Else
  shell.Run """" & target & """" & " """ & dir & "\autotest.htm""", 0, False
End If
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
