"""ASTER 1.9 reliability features: offline regression with isolated SQLite data."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from unittest import mock

import cost_guard
import data_guard
import long_memory
import live_archive
import restore_backup

ROOT=Path(__file__).resolve().parents[1]


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder=Path(self.temp.name)
        self.db=self.folder/'assistant.sqlite3'
        with self.connect() as c:
            c.executescript("""
                CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);
                CREATE TABLE messages(id INTEGER PRIMARY KEY,role TEXT,content TEXT);
                CREATE TABLE memories(id INTEGER PRIMARY KEY,content TEXT UNIQUE,
                    created TEXT DEFAULT CURRENT_TIMESTAMP);
                INSERT INTO settings VALUES ('remember','true');
                INSERT INTO settings VALUES ('auto_memory','true');
            """)
            live_archive.init_schema(c)
            long_memory.init_schema(c)
            cost_guard.init_schema(c)
        cost_guard.configure(self.db)
        self.addCleanup(cost_guard.configure,None)

    def connect(self):
        c=sqlite3.connect(self.db,timeout=10)
        c.row_factory=sqlite3.Row
        return c

    def test_backup_atomic_validation_and_rotation(self):
        with self.connect() as db:
            db.execute("INSERT INTO memories(content) VALUES ('LVORE発売予定')")
        for i in range(4):
            result=data_guard.create_backup(self.connect,self.folder,keep=2,
                now=datetime(2026,11,1,0,i,tzinfo=timezone.utc))
            self.assertTrue((self.folder/'backups'/result['name']).exists() or i < 2)
        backups=data_guard.list_backups(self.folder)
        self.assertEqual(len(backups),2)
        self.assertTrue(all(data_guard.validate_database(self.folder/'backups'/item['name'])
                            for item in backups))
        self.assertFalse(list((self.folder/'backups').glob('*.pending')))

    def test_corrupt_or_unrelated_database_cannot_be_restored(self):
        other=self.folder/'fake.sqlite3'
        other.write_bytes(b'not a valid database'*100)
        with self.assertRaises((ValueError,sqlite3.DatabaseError)):
            data_guard.validate_database(other)
        unrelated=self.folder/'other.sqlite3'
        with sqlite3.connect(unrelated) as c:
            c.execute('CREATE TABLE unrelated(x)')
        with self.assertRaises(ValueError):
            data_guard.validate_database(unrelated)

    def test_restore_offline_rechecks_archive_and_saves_previous_state(self):
        with self.connect() as db:
            db.execute("INSERT INTO memories(content) VALUES ('保存した最初の値')")
        original=data_guard.create_backup(self.connect,self.folder)
        with self.connect() as db:
            db.execute("INSERT INTO memories(content) VALUES ('復元前の新しい値')")
        restore_backup.restore(self.folder/'backups'/original['name'],self.db,self.folder,
                               confirm=True,active_check=lambda:None)
        with self.connect() as db:
            items=[r[0] for r in db.execute("SELECT content FROM memories ORDER BY id")]
        self.assertEqual(items,['保存した最初の値'])
        self.assertGreaterEqual(len(data_guard.list_backups(self.folder)),2)
        with self.assertRaises(RuntimeError):
            restore_backup.restore(self.folder/'backups'/original['name'],self.db,self.folder,
                                   confirm=True,active_check=lambda:'http://127.0.0.1:8000')

    def test_due_and_settings(self):
        cfg={'backup_enabled':'true','backup_interval_hours':'24','backup_last_attempt':''}
        self.assertTrue(data_guard.due(cfg))
        cfg['backup_enabled']='false'
        self.assertFalse(data_guard.due(cfg))
        cfg['backup_enabled']='true'
        cfg['backup_last_attempt']='2026-11-01T00:00:00+00:00'
        self.assertFalse(data_guard.due(cfg,datetime(2026,11,1,22,tzinfo=timezone.utc)))
        self.assertTrue(data_guard.due(cfg,datetime(2026,11,2,1,tzinfo=timezone.utc)))

    def test_monthly_budget_and_measured_token_cost(self):
        cost_guard.add_text_usage('responses',{'input_tokens':1000000,'output_tokens':500000})
        cost_guard.add_text_usage('tts_unmetered',None)
        st=cost_guard.status(self.connect)
        self.assertAlmostEqual(st['month_usd'],1.50,places=4)
        self.assertEqual(st['unmetered_requests'],1)
        cost_guard.change_settings(self.connect,{'usage_monthly_limit_usd':'1.51'})
        cost_guard.check_budget()
        with self.assertRaises(cost_guard.BudgetExceeded):
            cost_guard.check_budget('0.05')
        with self.assertRaises(ValueError):
            cost_guard.change_settings(self.connect,{'usage_monthly_limit_usd':'NaN'})
        with self.assertRaises(ValueError):
            cost_guard.change_settings(self.connect,{'usage_warn_percent':'120'})

    def test_live_meter_is_idempotent_cannot_create_arbitrary_rows(self):
        cost_guard.start_live('live_abc123')
        cost_guard.update_live('live_abc123',30)
        cost_guard.update_live('live_abc123',12)
        cost_guard.update_live('live_abc123',55,finished=True)
        cost_guard.update_live('live_abc123',200,finished=True)
        with self.connect() as db:
            row=db.execute("SELECT measured_seconds,finished FROM usage_live_sessions").fetchone()
        self.assertEqual(row['measured_seconds'],55)
        self.assertEqual(row['finished'],1)
        self.assertGreater(cost_guard.status(self.connect)['month_usd'],0)
        with self.assertRaises(ValueError):
            cost_guard.update_live('live_missing123',10)
        with self.assertRaises(ValueError):
            cost_guard.start_live('../../escape')

    def test_conflict_is_not_automatically_overwritten(self):
        with self.connect() as db:
            a=db.execute("INSERT INTO messages(role,content) VALUES ('user','LVOREの発売時期は4月です。')").lastrowid
            b=db.execute("INSERT INTO messages(role,content) VALUES ('user','LVOREの発売時期は5月です。')").lastrowid
            token=long_memory._enabled(db)[1]
        first={'fact':'LVOREの発売時期は4月','topic':'project:LVORE:発売時期',
               'category':'project','evidence':'LVOREの発売時期は4月です。','correction':False}
        second={**first,'fact':'LVOREの発売時期は5月',
                'evidence':'LVOREの発売時期は5月です。'}
        with self.connect() as db:
            self.assertEqual(long_memory._apply(db,'chat',str(a),[first],token),1)
            self.assertEqual(long_memory._apply(db,'chat',str(b),[second],token),0)
        conflicts=long_memory.list_conflicts(self.connect)
        self.assertEqual(len(conflicts),1)
        self.assertIn('4月',conflicts[0]['existing'])
        with self.connect() as db:
            self.assertTrue(long_memory.resolve_conflict(db,conflicts[0]['id'],'replace'))
        self.assertEqual(long_memory.list_conflicts(self.connect),[])
        selected=long_memory.select(self.connect,'LVORE',10,category='project')
        self.assertEqual(len(selected),1)
        self.assertIn('5月',selected[0]['content'])
        with self.connect() as db:
            rows=db.execute('SELECT previous_content FROM memory_revisions').fetchall()
        self.assertEqual(len(rows),1)

    def test_conflict_keep_does_not_reinsert_rejected_proposal(self):
        with self.connect() as db:
            a=db.execute("INSERT INTO messages(role,content) VALUES ('user','LVOREを4月に発売')").lastrowid
            b=db.execute("INSERT INTO messages(role,content) VALUES ('user','LVOREを5月に発売')").lastrowid
            token=long_memory._enabled(db)[1]
        one={'fact':'LVOREは4月に発売する','topic':'project:LVORE:発売',
             'category':'project','evidence':'LVOREを4月に発売','correction':False}
        two={**one,'fact':'LVOREは5月に発売する','evidence':'LVOREを5月に発売'}
        with self.connect() as db:
            long_memory._apply(db,'chat',str(a),[one],token)
            long_memory._apply(db,'chat',str(b),[two],token)
            conflict=long_memory.list_conflicts(self.connect)[0]
            long_memory.resolve_conflict(db,conflict['id'],'keep')
        self.assertEqual(long_memory.list_conflicts(self.connect),[])
        self.assertEqual(len(long_memory.select(self.connect,'LVORE',10)),1)

    def test_ui_and_backend_expose_four_features(self):
        server=(ROOT/'server.py').read_text(encoding='utf-8')
        html=(ROOT/'static'/'index.html').read_text(encoding='utf-8')
        live=(ROOT/'static'/'live.js').read_text(encoding='utf-8')
        proxy=(ROOT/'live_proxy.py').read_text(encoding='utf-8')
        for marker in ("APP_VERSION = '1.9.0'", "'/api/backups'", "'/api/usage'",
                       "'/api/usage/live'","'/api/memory/conflict'",
                       "data_guard.sweep(connect, DATA)"):
            with self.subTest(marker=marker): self.assertIn(marker,server)
        for marker in ('id="system-guard"','id="usage-settings-form"',
                       'id="backup-create-now"','id="memory-conflicts"',
                       'id="memory-search-category"','id="live-reconnect"',
                       'id="live-auto-reconnect"'):
            with self.subTest(marker=marker): self.assertIn(marker,html)
        for marker in ('function reconnectAfterDrop','recoveryContext.slice(-3500)',
                       "const AUTO_RECONNECT_KEY", "setInterval(() => { void reportUsage(); },10000)"):
            with self.subTest(marker=marker): self.assertIn(marker,live)
        self.assertIn('resume_context: str = ""',proxy)
        self.assertIn("restore_backup.py --apply",html)


if __name__=='__main__':
    unittest.main()
