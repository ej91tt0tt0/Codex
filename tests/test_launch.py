import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class DesktopOriginTests(unittest.TestCase):
    def start_and_stop(self, data):
        env = {k: v for k, v in os.environ.items() if k not in ('ASSISTANT_API_KEY', 'OPENAI_API_KEY')}
        env['APP_DATA_DIR'] = str(data)
        proc = subprocess.Popen([sys.executable, 'launch.py', '--no-browser', '--no-key'], cwd=Path(__file__).resolve().parents[1], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        try:
            line = proc.stdout.readline().strip()
            self.assertTrue(line.startswith('READY '), line)
            return int(line.rsplit(':', 1)[1])
        finally:
            proc.terminate();proc.communicate(timeout=10)

    def seed(self, data, port):
        with sqlite3.connect(Path(data) / 'assistant.sqlite3') as c:
            c.execute('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)')
            c.executemany('INSERT INTO settings VALUES (?,?)', [('automatic', 'false'), ('desktop_port', str(port))])

    def test_browser_launch_opens_home_live_voice_entry(self):
        """The desktop opens voice first and never implicitly opens classic home."""
        from unittest import mock
        import launch
        with mock.patch('launch.webbrowser.open') as browser:
            launch.reuse_running('http://127.0.0.1:8000', False)
        browser.assert_called_once_with('http://127.0.0.1:8000')

    def test_listen_first_requires_explicit_opt_in(self):
        """Default boot must not automatically charge for a voice session."""
        root = Path(__file__).resolve().parents[1]
        script = (root / 'static' / 'live.js').read_text(encoding='utf-8')
        html = (root / 'static' / 'live.html').read_text(encoding='utf-8')
        prompt = (root / 'live_proxy.py').read_text(encoding='utf-8')
        self.assertIn("localStorage.getItem(AUTO_START_KEY) === 'true'", script)
        self.assertIn("if (autoStartEnabled) {", script)
        self.assertIn('id="live-auto-start"', html)
        self.assertIn('音声接続が成立しても', prompt)

    def test_desktop_reuses_origin_on_restart(self):
        with tempfile.TemporaryDirectory() as data, socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0));preferred=reserve.getsockname()[1];reserve.close()
            self.seed(data, preferred)
            first=self.start_and_stop(data);second=self.start_and_stop(data)
            self.assertEqual(first,preferred);self.assertEqual(first,second)

    def test_second_launch_reuses_the_running_instance_without_a_second_server(self):
        import json
        import urllib.request
        with tempfile.TemporaryDirectory() as data:
            env={k:v for k,v in os.environ.items() if k not in ('ASSISTANT_API_KEY','OPENAI_API_KEY')}
            env['APP_DATA_DIR']=data
            self.seed(data,8000)
            first=subprocess.Popen([sys.executable,'launch.py','--no-browser','--no-key'],cwd=Path(__file__).resolve().parents[1],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
            try:
                ready=first.stdout.readline().strip();self.assertTrue(ready.startswith('READY '),ready)
                second=subprocess.run([sys.executable,'launch.py','--no-browser','--no-key'],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True,timeout=10)
                self.assertEqual(second.returncode,0,second.stderr);self.assertEqual(second.stdout.splitlines()[0],ready)
                self.assertIn('already running',second.stdout);self.assertIsNone(first.poll())
                with urllib.request.urlopen(ready.split(' ',1)[1]+'/api/health') as response:health=json.load(response)
                self.assertEqual(health['app'],'ASTER');self.assertNotIn('messages',health);self.assertNotIn(data,str(health))
            finally:first.terminate();first.communicate(timeout=10)

    def test_different_data_directories_do_not_reuse_another_assistant(self):
        with tempfile.TemporaryDirectory() as first_data,tempfile.TemporaryDirectory() as second_data:
            env={k:v for k,v in os.environ.items() if k not in ('ASSISTANT_API_KEY','OPENAI_API_KEY')};env['APP_DATA_DIR']=first_data
            self.seed(first_data,8000)
            first=subprocess.Popen([sys.executable,'launch.py','--no-browser','--no-key'],cwd=Path(__file__).resolve().parents[1],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
            try:
                ready=first.stdout.readline().strip();port=int(ready.rsplit(':',1)[1]);self.seed(second_data,port)
                second_port=self.start_and_stop(second_data)
                self.assertNotEqual(second_port,port);self.assertIsNone(first.poll())
            finally:first.terminate();first.communicate(timeout=10)

    def test_occupied_port_gets_a_persisted_free_port(self):
        with tempfile.TemporaryDirectory() as data, socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0));occupied.listen();port=occupied.getsockname()[1]
            self.seed(data,port);fallback=self.start_and_stop(data)
            self.assertNotEqual(fallback,port)
            with sqlite3.connect(Path(data) / 'assistant.sqlite3') as c:
                self.assertEqual(c.execute("SELECT value FROM settings WHERE key='desktop_port'").fetchone()[0],str(fallback))


if __name__ == '__main__':unittest.main()
