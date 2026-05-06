$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root "vendor"
$repo = Join-Path $vendor "OpenVoice"
$venv = Join-Path $root ".venv"
$python = Join-Path $venv "Scripts\python.exe"
$checkpointZip = Join-Path $vendor "checkpoints_v2_0417.zip"
$checkpointUrl = "https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"

New-Item -ItemType Directory -Force -Path $vendor | Out-Null

if (!(Test-Path $repo)) {
  git clone https://github.com/myshell-ai/OpenVoice.git $repo
}

if (!(Test-Path $python)) {
  python -m venv $venv
}

& $python -m pip install --upgrade pip
& $python -m pip install -e $repo
& $python -m pip install git+https://github.com/myshell-ai/MeloTTS.git
& $python -m pip install av==12.3.0 faster-whisper==1.0.3 whisper-timestamped==1.14.2 dtw-python==1.3.1 numpy==1.26.4 imageio-ffmpeg wavmark==0.0.3
& $python -m unidic download

if (!(Test-Path (Join-Path $repo "checkpoints_v2"))) {
  Invoke-WebRequest -Uri $checkpointUrl -OutFile $checkpointZip
  Expand-Archive -Force -Path $checkpointZip -DestinationPath $repo
}

Write-Host "OpenVoice setup completed."
Write-Host "Start with: scripts\Start-VoiceStudio.ps1"
