Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$target = Join-Path $root "target\\release\\meeting_audio.dll"
$repoRoot = (Resolve-Path (Join-Path $root "..\\..\\..")).Path
$llvmRoot = Join-Path $repoRoot ".tools\\llvm-mingw-20240619-ucrt-x86_64"
$llvmBin = Join-Path $llvmRoot "bin"
$llvmLib = Join-Path $llvmRoot "x86_64-w64-mingw32\\lib"
$clangBuiltins = Join-Path $llvmRoot "lib\\clang\\18\\lib\\windows\\libclang_rt.builtins-x86_64.a"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\\bin"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  if (-not (Test-Path (Join-Path $cargoBin "cargo.exe"))) {
    throw "cargo is not installed. Install Rust first, then rerun this script."
  }
  $env:Path = "$cargoBin;$env:Path"
}

if (-not (Test-Path $llvmBin)) {
  throw "llvm-mingw is missing. Build from the repo root first so .tools/llvm-mingw exists."
}

Push-Location $root
try {
  $env:Path = "$llvmBin;$cargoBin;$env:Path"
  Copy-Item $clangBuiltins (Join-Path $llvmLib "libgcc.a") -Force
  Copy-Item (Join-Path $llvmLib "libunwind.a") (Join-Path $llvmLib "libgcc_eh.a") -Force
  cargo build --release
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "cargo build failed with exit code $exitCode"
  }
}
finally {
  Pop-Location
}

Write-Host "Built $target"
