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

    def test_desktop_reuses_origin_on_restart(self):
        with tempfile.TemporaryDirectory() as data, socket.socket() as reserve:
            reserve.bind(('127.0.0.1', 0));preferred=reserve.getsockname()[1];reserve.close()
            self.seed(data, preferred)
            first=self.start_and_stop(data);second=self.start_and_stop(data)
            self.assertEqual(first,preferred);self.assertEqual(first,second)

    def test_occupied_port_gets_a_persisted_free_port(self):
        with tempfile.TemporaryDirectory() as data, socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0));occupied.listen();port=occupied.getsockname()[1]
            self.seed(data,port);fallback=self.start_and_stop(data)
            self.assertNotEqual(fallback,port)
            with sqlite3.connect(Path(data) / 'assistant.sqlite3') as c:
                self.assertEqual(c.execute("SELECT value FROM settings WHERE key='desktop_port'").fetchone()[0],str(fallback))


if __name__ == '__main__':unittest.main()
