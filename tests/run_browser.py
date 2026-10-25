"""Run browser regressions against an isolated app with all provider traffic blocked."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch
import wave


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('suite', choices=('companion', 'usability', 'soak', 'endurance', 'accessibility'))
    parser.add_argument('--minutes', type=int)
    parser.add_argument('--app-root', type=Path, default=root)
    parser.add_argument('--result', type=Path)
    args = parser.parse_args()
    minutes = args.minutes if args.minutes is not None else (11 if args.suite == 'soak' else 5)
    if not 1 <= minutes <= 180 or args.suite == 'soak' and minutes < 11:
        parser.error('Use 1–180 minutes; the quiet-period soak requires at least 11 minutes.')
    sys.path.insert(0, str(args.app_root.resolve()))
    with tempfile.TemporaryDirectory(prefix='aster-browser-') as folder:
        os.environ['APP_DATA_DIR'] = str(Path(folder) / 'data')
        os.environ['ASSISTANT_API_KEY'] = 'aster-fixture-not-a-real-key'
        os.environ['OPENAI_API_KEY'] = ''
        os.environ['APP_DESKTOP_ACTIONS'] = '0'
        import server
        from research import Answer
        server.init()
        server.Handler.log_message = lambda *args: None
        duplex = args.suite in ('soak', 'endurance')
        with server.connect() as c:
            c.executemany('UPDATE settings SET value=? WHERE key=?', [
                ('false', 'automatic'), ('false', 'natural_voice'),
                ('true' if duplex else 'false', 'hands_free'),
                ('true' if duplex or args.suite == 'accessibility' else 'false', 'high_quality_input'),
                ('voice' if duplex or args.suite == 'accessibility' else 'text', 'interaction_mode'),
            ])

        def fixture(messages, **kwargs):
            if kwargs.get('require_search'):
                return Answer('調査方針：公式情報を確認。確認結果：試験用。前回との差分：初回。未確認事項：実情報。',
                              [{'url': 'https://example.com/source', 'title': '試験用の情報源', 'cited': False, 'method': 'public_news', 'published_at': server.datetime.now(server.timezone.utc).isoformat()}], 1)
            if '日記の下書き' in messages[0]['content']:
                return Answer('今日は読書や散歩のことを話した。')
            return Answer('話を聞いているよ。続けて大丈夫。')

        if args.suite == 'accessibility':
            now = server.datetime.now(server.timezone.utc).isoformat()
            weather = {'area':'愛知県西部の試験予報','reported_at':now,'fetched_at':now,'days':[{'time':now,'weather':'試験用の晴れ'}]}
            with server.connect() as c:
                import json
                c.execute('INSERT OR REPLACE INTO cache VALUES (?,?)',('weather',json.dumps(weather,ensure_ascii=False)))
                c.execute('INSERT INTO news(title,url,published) VALUES (?,?,?)',('試験用の公開ニュース','https://example.com/news',now))

        original_generate = server.generate_reply

        def generate(snapshot, initiative=None, **kwargs):
            if initiative:
                return Answer('話したくなったら、いつでも声をかけて。')
            return original_generate(snapshot, **kwargs)

        server.respond = fixture
        server.generate_reply = generate
        audio = Path(folder) / 'silence.wav'
        with wave.open(str(audio), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(bytes(24000 * 2 * 40))
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        env = os.environ.copy()
        env.update(TEST_BASE_URL='http://127.0.0.1:' + str(http.server_port),
                   TEST_SILENT_AUDIO=str(audio), ASTER_SOAK_MINUTES=str(minutes),
                   ASTER_ENDURANCE_MINUTES=str(minutes))
        if args.result:
            env['ASTER_TEST_RESULT'] = str(args.result.resolve())
        try:
            # This covers accidental calls from transcription, proactive speech or future features too.
            with patch.object(server.urllib.request, 'urlopen', side_effect=AssertionError('Provider network is blocked during fixture tests')):
                subprocess.run(['node', str(root / 'tests' / ('browser_' + args.suite + '.cjs'))],
                               env=env, check=True, timeout=max(180, minutes * 60 + 120))
        finally:
            http.shutdown()
            http.server_close()


if __name__ == '__main__':
    main()
