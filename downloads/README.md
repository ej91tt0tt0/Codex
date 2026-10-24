# よりそい — Windows仮起動版

[ZIPをダウンロード](https://github.com/ej91tt0tt0/Codex/raw/refs/heads/main/downloads/yorisoi-windows.zip)

1. [Python 3.12以上](https://www.python.org/downloads/windows/)をインストールします。インストール時に「Add python.exe to PATH」を有効にしてください。
2. ZIPを右クリックして「すべて展開」します。
3. 展開先の `yorisoi` フォルダーで `start_windows.bat` を開きます。
4. 黒い画面にOpenAI APIキーを入力してEnterを押すと、ブラウザが開きます。入力文字は表示されません。キーはファイルに保存しません。キーなしでEnterを押すと記録モードで起動します。

終了時は黒い画面でCtrl+Cを押してください。ブラウザが開かない場合は、黒い画面の `READY` の後にあるアドレスを同じPCのブラウザで開いてください。

APIキー・会話履歴・体調記録は同梱していません。対象地域の初期設定（愛知県碧南市浜田町、名鉄三河線など）は含みます。クラウドのネットワークシークレットはPCへ引き継がれません。AI利用はOpenAI APIの従量課金です。AI利用時は会話・記憶・最近の体調・地域・取得した天気とニュースをOpenAIに送信します。

PC内だけで動作する開発用の試作版で、インターネット公開は行いません。診断や緊急対応を目的とする医療アプリではありません。ZIP展開後の起動・画面配信・記録機能をLinux上のPythonで検証しています。Windows実機では未検証です。

ZIPのSHA-256は `SHA256SUMS` を参照してください。
