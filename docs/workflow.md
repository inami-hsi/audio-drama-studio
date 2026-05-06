# ボイス生成スタジオ 作業手順書

## 1. 初回セットアップ

### 1.1 前提

- Windows PowerShellを使用
- Pythonが利用可能
- ネットワーク接続がある
- 数GB以上の空き容量がある

### 1.2 OpenVoiceセットアップ

プロジェクトディレクトリへ移動する。

```powershell
cd D:\Antigravity用脳みそ\audio-drama-studio
```

セットアップスクリプトを実行する。

```powershell
scripts\Setup-OpenVoice.ps1
```

この処理では以下を行う。

- `vendor/OpenVoice` にOpenVoiceを取得
- `.venv` を作成
- MeloTTSと関連ライブラリを導入
- OpenVoice V2 checkpointを取得
- UniDic辞書を導入
- Windows/Python 3.11向けの互換依存を補正

## 2. 起動手順

PowerShellで以下を実行する。

```powershell
cd D:\Antigravity用脳みそ\audio-drama-studio
scripts\Start-VoiceStudio.ps1
```

ブラウザで以下を開く。

```text
http://127.0.0.1:5180/
```

## 3. 動作確認

### 3.1 サーバー状態確認

ブラウザまたはPowerShellで以下にアクセスする。

```text
http://127.0.0.1:5180/api/health
```

期待値:

```json
{
  "ok": true,
  "openvoice_ready": true,
  "profile_ready": false
}
```

`profile_ready` は声登録前は `false` で問題ない。

### 3.2 画面確認

- パスワードなしで画面が開く
- OpenVoiceステータスが表示される
- `1人用` / `複数人用` を選択できる
- サンプル台本を読み込める
- ブラウザ音声で再生できる

## 4. ボイスクローン作成手順

### 4.1 参照音声を用意する

- 本人の声、または利用許可を得た音声を用意する
- 10秒以上を推奨
- ノイズが少ない音声を使う
- 可能ならBGMなし、反響なし、単独話者の音声を使う

### 4.2 参照音声を登録する

1. `本人の声、または利用許可を得た音声だけを使用します` にチェックする
2. 音声ファイルを選択、または録音開始を押す
3. 参照音声をプレビュー再生して確認する
4. `声を登録` を押す
5. 完了toastが出ることを確認する

保存先:

```text
data/references
data/voice_profile/target_se.pth
```

## 5. クローン音声生成手順

1. 作成形式として `1人用` または `複数人用` を選ぶ
2. `生成テキスト` に文章を入力する
3. `言語` を選択する
4. `使用ボイス` で登録したクローン音声を選ぶ
5. `音声を生成` を押す
6. 生成完了後、audioプレイヤーで確認する
7. `音声を保存` からWAVを保存する

## 6. 無料登録ボイスでの生成手順

1. `生成テキスト` に文章を入力する
2. `使用ボイス` で無料登録ボイスを選ぶ
3. 日本語、英語、中国語、韓国語のいずれかを選択する
4. `音声を生成` を押す
5. 生成完了後、audioプレイヤーで確認する
6. `音声を保存` からWAVを保存する

生成ファイルの保存先:

```text
outputs
```

## 7. AI台本生成手順

必要な場合のみ使用する。

1. 右上の `APIキー` を押す
2. Gemini APIキーを入力する
3. 保存方式を選ぶ
   - ブラウザに保存
   - ローカルファイルに保存
   - 保存しない
4. ローカルファイル保存を選ぶ場合は保存先パスを指定する
5. `AI生成` を押す
6. 登場人物と内容を入力する
7. 生成結果を確認する

保存方式によってAPIキーの保存場所は変わる。ローカルファイル保存を選んだ場合は、指定したパスの権限と取り扱いに注意する。

## 8. トラブルシューティング

### 8.1 OpenVoiceサーバー未起動と表示される

`scripts\Start-VoiceStudio.ps1` を実行しているか確認する。

別のポートで起動した場合は、ブラウザでそのポートを開く。

### 8.2 OpenVoice本体は未設定と表示される

`scripts\Setup-OpenVoice.ps1` を実行する。

`vendor/OpenVoice/checkpoints_v2/converter/checkpoint.pth` が存在するか確認する。

### 8.3 声登録で失敗する

- 参照音声が短すぎないか確認する
- 無音やBGMだけの音声になっていないか確認する
- WebM録音で失敗する場合はWAVまたはMP3をアップロードする
- 初回はモデル読み込みに時間がかかるため待つ

### 8.4 生成が遅い

CPU実行では時間がかかる。短文で試す。

GPU環境がある場合はPyTorchのCUDA版導入を検討する。

### 8.5 Python依存関係で失敗する

Windowsでは依存関係の相性問題が起きやすい。以下を検討する。

- Python 3.9環境を使う
- WSL2上で実行する
- Docker化する

## 9. 開発時チェック

JavaScript構文チェック:

```powershell
node --check app.js
```

Python構文チェック:

```powershell
.venv\Scripts\python.exe -m py_compile openvoice_server.py
```

サーバーヘルスチェック:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5180/api/health
```

## 10. 運用ルール

- 第三者の声を無断で登録しない
- 公開前に利用規約と同意ログ保存を追加する
- 生成音声を公開する場合は、誤認を招く使い方を避ける
- 参照音声と生成音声の保存場所を定期的に確認する

## 11. 次回開発候補

- 複数ボイス登録
- 無料登録ボイスの試聴
- 録音秒数表示
- 参照音声のノイズチェック
- 長文分割生成
- 生成履歴一覧
- Dockerセットアップ
- Firebase公開版
