"""Start a private desktop session and open its browser window."""
import argparse
import errno
import getpass
import os
import sys
import threading
import warnings
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Start ASTER on this PC (Python 3.12+).')
    parser.add_argument('--no-browser', action='store_true', help='Do not open the browser automatically')
    parser.add_argument('--no-key', action='store_true', help='Skip the API key prompt; use existing environment settings or record-only mode')
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        raise SystemExit('Python 3.12 or later is required: https://www.python.org/downloads/')
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
        http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    with server.connect() as c:
        c.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', ('desktop_port', str(http.server_port)))
    url = 'http://127.0.0.1:' + str(http.server_port)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    threading.Thread(target=server.scheduler, daemon=True).start()
    print('READY ' + url, flush=True)
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
