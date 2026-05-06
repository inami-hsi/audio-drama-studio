$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
$env:PORT = if ($env:PORT) { $env:PORT } else { "5180" }

if (Test-Path $python) {
  & $python (Join-Path $root "openvoice_server.py")
} else {
  python (Join-Path $root "openvoice_server.py")
}
