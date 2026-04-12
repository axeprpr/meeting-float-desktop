$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$llvm = Join-Path $root ".tools\llvm-mingw-20240619-ucrt-x86_64\bin"
$src = Join-Path $PSScriptRoot "main.cpp"
$outDir = Join-Path $PSScriptRoot "build"
$outExe = Join-Path $outDir "Meeting Float Native.exe"
$distExe = Join-Path $root "dist\win-x64\Meeting Float Native.exe"
$runtimeDlls = @(
  "libc++.dll",
  "libunwind.dll",
  "libwinpthread-1.dll"
)

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$env:Path = "$llvm;$env:Path"

clang++.exe `
  -std=c++20 `
  -municode `
  -mwindows `
  -I (Join-Path $root ".tools\sciter-sdk\include") `
  $src `
  -o $outExe `
  -lole32 `
  -lshell32 `
  -lshlwapi `
  -lcomctl32 `
  -luser32 `
  -lgdi32

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "clang++ failed with exit code $exitCode"
}

Copy-Item $outExe $distExe -Force
foreach ($dll in $runtimeDlls) {
  $source = Join-Path $llvm $dll
  if (Test-Path $source) {
    Copy-Item $source (Join-Path $root "dist\win-x64\$dll") -Force
  }
}
Write-Host "Built $outExe"
