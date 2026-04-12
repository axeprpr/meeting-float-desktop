Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $root "dist"
$dist = Join-Path $distRoot "win-x64"
$toolsDir = Join-Path $root ".tools"
$llvmDir = Join-Path $toolsDir "llvm-mingw-20240619-ucrt-x86_64"
$llvmZip = Join-Path $toolsDir "llvm-mingw.zip"

function Get-AppVersion {
  if ($env:APP_VERSION) {
    return $env:APP_VERSION
  }

  $package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
  return $package.version
}

function Ensure-LlvmMingw {
  $clang = Join-Path $llvmDir "bin\\clang.exe"
  if (Test-Path $clang) {
    return $clang
  }

  New-Item -ItemType Directory -Force $toolsDir | Out-Null
  if (-not (Test-Path $llvmZip)) {
    Invoke-WebRequest `
      -Uri "https://github.com/mstorsjo/llvm-mingw/releases/download/20240619/llvm-mingw-20240619-ucrt-x86_64.zip" `
      -OutFile $llvmZip
  }

  tar -xf $llvmZip -C $toolsDir
  if (-not (Test-Path $clang)) {
    throw "llvm-mingw bootstrap failed: clang.exe not found"
  }

  return $clang
}

function Get-CCompiler {
  $candidates = @(@(
    (Get-Command gcc -ErrorAction SilentlyContinue),
    (Get-Command clang -ErrorAction SilentlyContinue)
  ) | Where-Object { $_ })

  if ($candidates.Count -gt 0) {
    return $candidates[0].Source
  }

  return Ensure-LlvmMingw
}

Get-Process -Name "Meeting-Float","Meeting Float Native" -ErrorAction SilentlyContinue | Stop-Process -Force

$version = Get-AppVersion
$zipPath = Join-Path $distRoot ("meeting-float-sciter-v{0}-win-x64.zip" -f $version)
New-Item -ItemType Directory -Force $distRoot | Out-Null
if (Test-Path $dist) {
  Remove-Item $dist -Recurse -Force
}
New-Item -ItemType Directory -Force (Join-Path $dist "modules") | Out-Null

powershell -ExecutionPolicy Bypass -File (Join-Path $root "native\\windows\\meeting_audio\\build.ps1")
powershell -ExecutionPolicy Bypass -File (Join-Path $root "native\\windows\\sciter_host\\build.ps1")

Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/scapp.exe" `
  -OutFile (Join-Path $dist "Meeting Float.exe")
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/sciter.dll" `
  -OutFile (Join-Path $dist "sciter.dll")
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/c-smile/sciter-js-sdk/main/bin/windows/x64/inspector.exe" `
  -OutFile (Join-Path $dist "inspector.exe")

Copy-Item (Join-Path $root "index.htm") $dist
Copy-Item (Join-Path $root "autotest.htm") $dist
Copy-Item (Join-Path $root "minutes-window.htm") $dist
Copy-Item (Join-Path $root "app.css") $dist
Copy-Item (Join-Path $root "app.js") $dist
Copy-Item (Join-Path $root "README.md") $dist
Copy-Item (Join-Path $root "TESTING.md") $dist
Copy-Item (Join-Path $root "package.json") $dist
Copy-Item (Join-Path $root "modules\\*.js") (Join-Path $dist "modules")

$nativeDll = Join-Path $root "native\\windows\\meeting_audio\\target\\release\\meeting_audio.dll"
if (Test-Path $nativeDll) {
  Copy-Item $nativeDll (Join-Path $dist "meeting_audio.dll")
}

$nativeHost = Join-Path $root "native\\windows\\sciter_host\\build\\Meeting Float Native.exe"
if (Test-Path $nativeHost) {
  Copy-Item $nativeHost (Join-Path $dist "Meeting Float Native.exe")
}

foreach ($dll in @("libc++.dll", "libunwind.dll", "libwinpthread-1.dll")) {
  $runtimeDll = Join-Path $toolsDir "llvm-mingw-20240619-ucrt-x86_64\\bin\\$dll"
  if (Test-Path $runtimeDll) {
    Copy-Item $runtimeDll (Join-Path $dist $dll) -Force
  }
}

@'
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
'@ | Set-Content (Join-Path $dist "start.vbs") -Encoding ASCII

@'
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
'@ | Set-Content (Join-Path $dist "autotest.vbs") -Encoding ASCII

@'
@echo off
start "" wscript.exe "%~dp0start.vbs"
'@ | Set-Content (Join-Path $dist "start.bat") -Encoding ASCII

@'
@echo off
start "" wscript.exe "%~dp0autotest.vbs"
'@ | Set-Content (Join-Path $dist "autotest.bat") -Encoding ASCII

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
tar -a -cf $zipPath -C $distRoot "win-x64"

Write-Host "Built $dist"
Write-Host "Built $zipPath"
