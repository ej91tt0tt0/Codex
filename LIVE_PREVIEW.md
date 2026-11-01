# ASTER GPT-Live 音声会話（ホーム標準機能）

ASTER 1.5の標準音声会話は、GPT-Live 1 によるフルデュプレックス方式です。従来の音声会話やRealtime比較用画面も残しています。フルデュプレックスとは、ユーザーが話している最中でも音声を聞きながら短く返答したり、割り込みを受け付けたりできる方式です。

## Windowsでの起動

1. [ASTER最新版](https://github.com/ej91tt0tt0/Codex/archive/refs/heads/main.zip) をダウンロードし、**既存ASTERとは別フォルダー**に展開してください。元のデータフォルダーを上書きしないでください。
2. Python 3.12以上と、**GPT-Liveを利用できる**OpenAI APIキー・利用枠を用意してください。ChatGPT Plusとは別料金です。
3. 展開フォルダーでPowerShellを開き、「python launch.py」を実行します。
4. ASTERホームの**円形音量メーター**にある「TALK」を押します。現在はホーム内で直接Live音声会話ができます。独立した比較用画面として /live も残っています。
5. Shida（日本語男性声）、Harema（日本語女性声）、Marinから音声を選び、円形メーター中央の「TALK」または「リアルタイム音声を開始」を押します。
6. マイクの許可を求められたら承認してください。「会話中」になったら話しかけられます。
7. 終了時は円形メーターの「END」または「**通話を終了**」を押します。session.closed が確認できるまで通信を保持し、完了後にマイクと回線を閉じます。終了確認に失敗すると15秒で切断し、未確認として表示します。

## 技術構成

- live_proxy.py：Python標準ライブラリでOpenAI POST /v1/live/sessionsへJSONでSDPと設定を送信。APIキーはローカルサーバーのみで保持します。
- server.py：GET /live, /live.js, /live.css と POST /api/live/session を追加。既存のローカルホスト・Origin検査を継続します。
- static/live.html、static/live.js、static/live.css：独立したUI、WebRTC、字幕、マイクミュート、切断・診断。
- tests/test_live.py：URL、セッションパラメータ、APIキー非露出、エラー、SDP検証のモックテスト。

音声トラックはWebRTCのままOpenAIに接続し、文字起こし完了を待って発話する方式ではありません。session.started を確認してから会話できます。session.input_transcript.delta と session.output_transcript.delta を別々に表示し、再生終了とは別扱いにしています。ブラウザから session.start を送りません。

音声モデルは gpt-live-1 です。調査や思考が必要な場合はResponses delegation（gpt-5.6-terraとWeb検索）を使用します。これらはOpenAI側の**追加従量課金**になります。外部サービスへの書き込みや予約の確定は連携していません。通常のASTERのローカル記憶・予定・ニュース保存処理にもまだ接続していません。

## テスト

既存テストと合わせて以下を実行できます。

    python -m unittest discover -s tests -v

**実機での必須確認項目**

- 1分程度の通常会話ができること。声の抑揚、返答までの体感、相づちの自然さを従来版と比較する。
- ASTERが話している途中に話しかけ、割り込みを確認する。
- 句点や丸といったテキスト表記ルールを、不必要に読み上げないこと。
- 途中でミュートにすると入力が止まり、解除して話を続けられること。
- 通話終了後にマイクが停止し、再び開始できること。
- 回線を切った際に不適切な自動リトライを繰り返さず、診断欄に原因が表示されること。
- 通常音声会話・Realtime試験版・保存データが問題なく動作すること。

**現状の検証範囲：** GitHub Actionsでの自動テストを実施。GPT-Liveに実際のAPIキーを使ったセッション作成、ブラウザの音声品質、割り込みは未検証です。ブラウザ、API利用枠、通信によって追加調整が必要な場合があります。

## APIと課金

- 音声API：OpenAI POST /v1/live/sessions
- モデル：gpt-live-1。2026年11月時点の公表価格は **0.05米ドル／分**（秒単位課金）。
- Responses delegation：別モデル・Web検索の使用分が追加請求されます。
- セッション作成時に15秒分が課金対象になる仕様がありますが、通話が始まればその料金に充当され、二重加算ではありません。
- store: false はOpenAI側セッションの保存制御です。ASTER 1.5では通話終了時に字幕の文字起こしをローカルSQLiteに保存し、AIで要約を生成します。音声録音ファイルは保存せず、会話記録は /archive で表示・削除できます。ホーム画面の一時チャットを有効にして開始したLive通話は保存しません。OpenAI側の処理・保持規定とAI要約の従量課金は別途適用されます。
- 通常版ASTERや現在のRealtime試験版に戻るリンクもあります。

公式ドキュメント：
- https://developers.openai.com/api/docs/guides/live
- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/docs/guides/live-conversations
- https://developers.openai.com/api/reference/resources/live/methods/create
