cd "D:\Antigravity用脳みそ\audio-drama-studio"
# 最小化状態で新しいPowerShellウィンドウを立ち上げ、そこでサーバーを動かします
Start-Process powershell -ArgumentList "-NoExit", "-Command", ".venv\Scripts\Activate.ps1; python openvoice_server.py" -WindowStyle Minimized
