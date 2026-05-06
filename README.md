# ボイス生成スタジオ

OpenVoice を使ったボイスクローン生成に対応する、ローカルファースト版です。

## 現在できること

- 簡易パスワードゲート
- CSV形式の台本編集
- サンプル台本の読み込み
- Gemini APIキーを使ったAI台本生成
- ブラウザ標準の音声読み上げ
- 台本CSVの保存
- 参照音声の録音・アップロード
- OpenVoice V2 がセットアップ済みの場合の声特徴抽出とクローン音声生成

## 使い方

軽く試すだけなら `index.html` をブラウザで開けます。

OpenVoice 連携を使う場合は、ローカルサーバーで起動します。

```powershell
scripts\Start-VoiceStudio.ps1
```

ブラウザで開くURL:

```text
http://127.0.0.1:5180/
```

AI生成を使う場合は、画面右上の `APIキー` から Gemini APIキーを保存します。キーはブラウザの `localStorage` にのみ保存されます。

## OpenVoice のセットアップ

OpenVoice 本体、MeloTTS、V2 checkpoint はサイズが大きく、Python/PyTorch 環境も必要です。実行する前に十分な空き容量と時間を確保してください。

```powershell
scripts\Setup-OpenVoice.ps1
```

公式手順では Python 3.9 / Linux が主対象です。Windows では環境差が出やすいため、失敗する場合は WSL2 または Docker での運用が安定しやすいです。

声のクローンは、本人の声または明確に利用許可を得た音声だけを使用してください。

## 低コスト方針

最初は静的HTML/CSS/JSだけで運用できます。ホスティングする場合も Firebase Hosting、Cloudflare Pages、GitHub Pages などの無料枠で足ります。

本格的に追加するなら次の順番が費用を抑えやすいです。

1. Firebase Hosting で公開
2. Firebase Auth を追加してログイン制御
3. Firestore で利用回数を保存
4. Cloud Functions で共有APIキーを保護
5. Gemini TTS または別TTS APIで WAV/MP3 書き出し
