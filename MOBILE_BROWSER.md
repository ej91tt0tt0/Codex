# ASTER 1.6 | スマホのブラウザ版（iPhone / Android）

**まずはスマホブラウザで利用します。** ネイティブのiOS/Androidアプリ（App Store / Google Play 配布）ではありません。ホーム画面に追加するとアプリのように起動できます。

## 仕組み・注意点

- ASTER本体、APIキー、会話記録は **Windows PCに置いたまま**です。PCを起動している間だけスマホから利用できます。
- **Tailscale Serve（非公開HTTPS）**で、同じTailscaleのネットワークにいるスマホとPCを接続します。スマホのブラウザマイクはHTTPSが必要です。
- スマホから使用可能なのは **iOS Safari / Android Chromeなどの現行ブラウザ**です。実機ごとの再生や音声割り込みは追加確認が必要です。
- APIキーをスマホへコピーしたり、Web画面へ貼り付けたりする必要はありません。
- **Tailscale Funnelは使わないでください。** Funnelで一般公開すると、意図しないAPI利用や個人データへのアクセスにつながる可能性があります。
- 自分以外のユーザーや端末をTailscaleネットワークに招待しないでください。端末が失われたらTailscaleの管理画面でアクセスを無効化してください。

## Windowsでの初回設定

1. PCとスマホに [Tailscale](https://tailscale.com/download) を入れて、**同じ自分のアカウント**でログインしてください。
2. Tailscaleの管理画面でHTTPS証明書の利用を有効にします。必要ならTailscale Serve実行時に設定画面が開きます。
3. 以前のASTERを終了します（PowerShellでCtrl+C）。
4. ASTER 1.6の展開フォルダーでPowerShellを開き、以下のように起動します。

   ```powershell
   python launch.py --mobile
   ```

5. PowerShellに表示される「READY http://127.0.0.1:XXXX」を見て、**XXXXのポート番号**を確認します。同時に「MOBILE URL https://...ts.net」が表示されます。
6. **別のPowerShell**で、以下のコマンドを実行します。8000は必ず表示された実際のポート番号に置き換えてください。

   ```powershell
   tailscale serve --bg 8000
   ```

   **注意：** PCにTailscaleを入れても `tailscale` コマンドが見つからない場合は、ASTERの起動ターミナルに表示された **`& "C:\\Program Files\\Tailscale\\tailscale.exe" serve --bg 8000`** のようなコマンドを使ってください。ポートは実際の番号に合わせます。

   最初の起動でTailscaleの許可を求められたら承認し、必要ならもう一度実行してください。Tailscale Serveが表示したURLとASTERの「MOBILE URL」が一致していることを確認してください。
7. スマホのTailscaleを接続し、SafariまたはChromeで **MOBILE URL** を開きます。ASTERが表示されたら円形メーターの **TALK** をタップし、マイクへのアクセスを許可します。
8. 音声が再生されない場合は、画面の「設定・字幕・詳細情報」で再生コントロールを押してください。ブラウザによって最初の音声再生にタップが必要です。

## ホーム画面に追加する（任意）

- **iPhone**：SafariでHTTPSのASTER画面を開く → 共有 → 「ホーム画面に追加」。
- **Android**：ChromeでHTTPSのASTER画面を開く → メニュー → 「ホーム画面に追加」または「アプリをインストール」。
- ASTERホーム内の「設定・字幕・詳細情報」→「ホーム画面に追加する方法」からも案内を確認できます。

インストールされるのは**ブラウザアプリ（PWA）**で、ネイティブアプリではありません。オフラインやバックグラウンド通話はサポートせず、PCとTailscaleの接続が必要です。通話終了を押してからほかのアプリへ移動してください。

## 接続を止める・日常的な利用

- ASTERを止める：起動中のPowerShellで **Ctrl+C**
- スマホからのHTTPS共有を止める：別のPowerShellで以下を実行します。

   ```powershell
   tailscale serve --https=443 off
   ```

- 次回のスマホ利用時も **python launch.py --mobile** を使います。通常の **python launch.py** はPC専用です。
- 「Live音声自動接続」を有効にすると、スマホから開いたときも自動的に通話を試み、**無言でもAPI料金**が発生します。初期状態はOFFです。
- PC内の会話記録やAPIキーをスマホに送信するのではなく、HTTPS接続でPC上のASTERへアクセスします。ただし、ページで閲覧した会話内容はスマホのメモリにも表示されます。

## 接続できないとき

- **画面が開かない**：PCのASTERが動いているか、Tailscaleが両方で接続中か、Serveを起動したポートがREADYの番号と一致するか確認。
- **403エラー**：通常の `python launch.py` で起動した／Tailscale Serve以外で公開した／Tailscaleでログインしていない可能性があります。PCで再起動し、**--mobile** を指定してください。
- **マイクが表示されない**：URLが `https://` かを確認。普通の `http://192.168.x.x` は安全な接続とみなされず、スマホブラウザでマイクを使えません。
- **音が出ない**：マイク権限と端末音量、再生コントロールを確認。通話中はPC側で音声を二重起動しないでください。
- **ホーム画面に追加できない**：ブラウザの共有・メニューから追加します。PWAの追加方法はOSやブラウザで異なります。

Tailscaleの公式ドキュメント： https://tailscale.com/docs/features/tailscale-serve
