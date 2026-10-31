# リアルタイム音声会話（開発用プレビュー）

このブランチは**従来の音声会話を置き換えず**、OpenAI Realtime API / WebRTCを利用する音声画面を追加した試作版です。

## 確認手順

1. このブランチのファイルを別フォルダーへ取り出します（通常版の `.data` は上書きしないでください）。
2. Python 3.12以上を用意し、`python launch.py` でASTERを起動します。
3. APIキーを入力した後、通常画面から「リアルタイム音声会話（試験版）」を選ぶか、`http://127.0.0.1:<port>/realtime` にアクセスします。
4. Chrome/Edgeでマイクを許可し、「リアルタイム会話を開始」で音声会話を試します。
5. 「通話を終了」でマイクと接続が閉じられること、通常の会話が従来どおり動くことを確認してください。

**制限事項**

- 既存の会話履歴・長期記憶・天気・ニュース・予定の操作には接続しません。会話音声はOpenAIに送信されます。
- ローカルPCのループバック接続だけを提供します。スマホからの接続や一般公開は未実装です。
- 実APIキーと利用枠が必要です。リアルタイム音声APIは従量課金です。
- 通話の文字起こしは利用可能なイベントだけ表示します。正確な文字起こしを常時提供する機能ではありません。
- API接続やマイクの実機試験は、使用環境での確認が必要です。

## 技術構成

- `static/realtime.html`：独立した試験画面
- `static/realtime.js`：WebRTC接続、マイク取得、音声再生、終了処理
- `realtime_proxy.py`：サーバー側でのみAPIキーを使い、SDPとセッション構成をOpenAIへ中継
- `server.py`：`/realtime` と `/api/realtime/session` を追加
- `tests/test_realtime.py`：通信モックとSDP検証のユニットテスト

`python -m unittest discover -s tests -v` で既存テストと一緒に確認できます。従来の音声方式へは通常画面に戻れば切り替え可能です。

OpenAI公式資料： https://developers.openai.com/api/docs/guides/voice-webrtc
