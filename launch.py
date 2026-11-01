"""Start a private desktop session and open its browser window."""
import argparse
import errno
import getpass
import hashlib
import json
import os
import sqlite3
import sys
import re
import shutil
import subprocess
import threading
import warnings
import urllib.request
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path


class LocalHealthOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def running_app_url():
    """Reuse only a local ASTER instance using the very same data directory."""
    data = Path(os.environ.get('APP_DATA_DIR', Path(__file__).parent / '.data')).resolve()
    db = data / 'assistant.sqlite3'
    if not db.is_file():
        return None
    try:
        with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=.2) as connection:
            row = connection.execute("SELECT value FROM settings WHERE key='desktop_port'").fetchone()
        port = int(row[0]) if row else 8000
        if not 1024 <= port <= 65535:
            return None
        url = 'http://127.0.0.1:' + str(port)
        # A loopback health check must remain on this PC, including behind a corporate proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), LocalHealthOnly())
        with opener.open(url + '/api/health', timeout=.4) as response:
            raw = response.read(4097)
        if len(raw) > 4096:
            return None
        health = json.loads(raw)
        identifier = hashlib.sha256(os.path.normcase(str(data)).encode()).hexdigest()
        if isinstance(health, dict) and health.get('app') == 'ASTER' and health.get('data_id') == identifier:
            return url
    except (OSError, ValueError, TypeError, sqlite3.Error):
        pass
    return None


def reuse_running(url, no_browser):
    print('READY ' + url, flush=True)
    print('ASTER is already running. Stop its original terminal before applying updates or changing the API key.', flush=True)
    if not no_browser:
        webbrowser.open(url)


def configure_mobile():
    """Recognize the logged-in device's private Tailscale HTTPS DNS name."""
    binary = shutil.which('tailscale')
    if not binary and sys.platform == 'win32':
        candidate = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Tailscale' / 'tailscale.exe'
        if candidate.is_file():
            binary = str(candidate)
    if not binary:
        raise SystemExit('Tailscale が見つかりません。PCとスマホにTailscaleを入れてから --mobile を実行してください。MOBILE_BROWSER.md を参照。')
    try:
        process = subprocess.run([binary, 'status', '--json'], capture_output=True,
                                 text=True, timeout=10, check=True)
        info = json.loads(process.stdout)
        name = str(info.get('Self', {}).get('DNSName', '')).rstrip('.').lower()
        if info.get('BackendState') != 'Running':
            raise ValueError('Tailscale is not connected')
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.ts\.net', name):
            raise ValueError('Tailscale DNS name missing')
    except (OSError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise SystemExit('Tailscale が接続されていないかHTTPSのホスト名を確認できません。Tailscaleでログインしてから再試行してください。') from None
    url = 'https://' + name
    os.environ['ASTER_MOBILE_ORIGIN'] = url
    return binary, url


def main():
    parser = argparse.ArgumentParser(description='Start ASTER on this PC (Python 3.12+).')
    parser.add_argument('--no-browser', action='store_true', help='Do not open the browser automatically')
    parser.add_argument('--no-key', action='store_true', help='Skip the API key prompt; use existing environment settings or record-only mode')
    parser.add_argument('--mobile', action='store_true', help='Allow private mobile HTTPS via Tailscale Serve; requires a signed-in Tailscale client')
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        raise SystemExit('Python 3.12 or later is required: https://www.python.org/downloads/')
    mobile = configure_mobile() if args.mobile else None
    existing = running_app_url()
    if existing and mobile:
        raise SystemExit('ASTERが既に起動しています。先に元のターミナルでCtrl+Cを押して終了し、その後 python launch.py --mobile で起動してください。')
    if existing:
        reuse_running(existing, args.no_browser)
        return
    if not args.no_key and not (os.environ.get('ASSISTANT_API_KEY') or os.environ.get('OPENAI_API_KEY')):
        print('OpenAI API key is optional. Input is hidden and is not saved to a file.')
        print('Press Enter without a key to start in record-only mode.')
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                key = getpass.getpass('API key: ').strip()
        except (getpass.GetPassWarning, EOFError):
            raise SystemExit('A private terminal is required for key entry. Use --no-key for record-only mode.')
        if key:
            if any(c.isspace() for c in key) or not key.isascii():
                raise SystemExit('The API key contains whitespace or non-ASCII characters. Please retry.')
            os.environ['ASSISTANT_API_KEY'] = key
    # Local files only. The cloud key and cloud database are never bundled.
    os.environ['APP_DESKTOP_ACTIONS']='0' if args.no_browser else '1'
    import server
    server.init()
    # Reusing the origin allows Chrome/Edge to retain microphone permission across launches.
    try:
        preferred = int(server.settings().get('desktop_port', '8000'))
        if not 1024 <= preferred <= 65535:preferred=8000
    except (ValueError, TypeError):preferred=8000
    try:
        http = ThreadingHTTPServer(('127.0.0.1', preferred), server.Handler)
    except OSError as error:
        if error.errno not in (errno.EADDRINUSE, errno.EACCES):raise
        existing = running_app_url()
        if existing:
            reuse_running(existing, args.no_browser)
            return
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    with server.connect() as c:
        c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('desktop_port', str(http.server_port)))
    url = 'http://127.0.0.1:' + str(http.server_port)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    threading.Thread(target=server.scheduler, daemon=True).start()
    print('READY ' + url, flush=True)
    if mobile:
        binary, private_url = mobile
        print('MOBILE URL ' + private_url, flush=True)
        print('別のPowerShellで実行してください: tailscale serve --bg ' + str(http.server_port), flush=True)
        print('共有を止める場合: tailscale serve --https=443 off', flush=True)
        print('Tailscale Serveのみ使用してください。Funnelで一般公開しないでください。', flush=True)
    print('Keep this terminal open. Press Ctrl+C to stop. Data: ' + str(server.DATA), flush=True)
    if not args.no_browser:
        if not webbrowser.open(url):
            print('Open the READY address above in your browser.', flush=True)
    try:
        while worker.is_alive():
            worker.join(timeout=1)
    except KeyboardInterrupt:
        print('\nStopping...', flush=True)
    finally:
        http.shutdown()
        http.server_close()


if __name__ == '__main__':
    main()
