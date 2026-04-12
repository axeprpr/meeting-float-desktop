# Windows Build

## Files

- `windows/build-win-dist.ps1`: build Windows distribution on Windows
- `windows/build-win-dist.sh`: build Windows distribution from Linux
- `windows/installer.nsi`: NSIS installer script
- `dist/win-x64/`: portable distribution directory

## Build On Windows

From the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\build-win-dist.ps1
```

This script will:

- download `llvm-mingw` to `.tools/` if no C compiler is available
- build `meeting_audio.dll` and `Meeting Float Native.exe`
- download Sciter Windows runtime files
- assemble `dist/win-x64/`
- produce `dist/meeting-float-sciter-v<version>-win-x64.zip`
- copy `native/windows/meeting_audio/target/release/meeting_audio.dll` if it exists

To override the app version:

```powershell
$env:APP_VERSION = "0.1.4"
powershell -ExecutionPolicy Bypass -File .\windows\build-win-dist.ps1
```

## Build Installer

If `makensis` is installed:

```powershell
cd .\windows
makensis installer.nsi
```

Output:

- `dist/Meeting-Float-<version>-Setup.exe`

## Runtime Entry

- `start.bat`
- `autotest.bat`

The Windows package now uses the native host plus `meeting_audio.dll`; the old Go helper is no longer part of the startup path.

## Native DLL Work

The Windows-native audio scaffold lives in:

- `native/windows/meeting_audio/`

Current repository status:

- JS runtime already supports a native recorder backend when a bridge injects `meetingAudioNative`
- the Rust DLL scaffold exists
- the Sciter plugin/host shim that injects that object is still not implemented
