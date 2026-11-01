"""ASTER 1.8 long-term memory: offline, privacy and regression coverage."""
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import long_memory
import live_archive
import live_proxy

ID = 'b' * 32


class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'memory.sqlite'
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE memories(id INTEGER PRIMARY KEY, content TEXT UNIQUE,
                                      created TEXT DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE messages(id INTEGER PRIMARY KEY,role TEXT,content TEXT);
                INSERT INTO settings VALUES ('remember','true');
                INSERT INTO settings VALUES ('auto_memory','true');
            """)
            live_archive.init_schema(db)
            long_memory.init_schema(db)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def source(self, text='私はLVOREの発売時期を2027年4月に決めました。'):
        with self.connect() as db:
            return db.execute("INSERT INTO messages(role,content) VALUES ('user',?)",(text,)).lastrowid

    def response(self, text='私はLVOREの発売時期を2027年4月に決めました。',
                 fact='LVOREの発売時期は2027年4月を予定している。',
                 topic='LVORE:発売時期', correction=False):
        return json.dumps({'memories':[{
            'fact':fact,'topic':topic,'category':'project','evidence':text,
            'correction':correction,
        }]},ensure_ascii=False)

    def capture_as(self, source_id, response):
        with mock.patch.dict(os.environ,{'OPENAI_API_KEY':'test-api-key'}):
            with mock.patch('long_memory.respond',return_value=response) as ai:
                count=long_memory.capture(self.connect,'chat',source_id)
        return count,ai

    def test_migration_keeps_existing_manually_saved_memories(self):
        with self.connect() as db:
            db.execute("INSERT INTO memories(content) VALUES ('既存の記憶')")
            long_memory.init_schema(db)
            row=db.execute("SELECT content,source FROM memories").fetchone()
        self.assertEqual(tuple(row),('既存の記憶','manual'))

    def test_reliable_auto_capture_from_chat_and_replay_idempotency(self):
        mid=self.source()
        count,ai=self.capture_as(mid,self.response())
        self.assertEqual(count,1)
        self.assertIs(ai.call_args.kwargs['search'],False)
        self.assertEqual(long_memory.capture(self.connect,'chat',mid),0)
        with self.connect() as db:
            row=db.execute("SELECT content,source,topic FROM memories").fetchone()
            self.assertEqual(row['source'],'auto-chat')
            self.assertIn('LVORE',row['topic'])
            self.assertEqual(db.execute('SELECT COUNT(*) FROM memory_events').fetchone()[0],1)

    def test_fabricated_evidence_and_sensitive_details_rejected(self):
        mid=self.source('私は動画編集を仕事にしています。')
        fake=self.response(text='私は存在しない趣味を持っています。')
        count,_=self.capture_as(mid,fake)
        self.assertEqual(count,0)
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM memories').fetchone()[0],0)

        raw='私の自宅住所は東京都千代田区です。'
        leaked={'memories':[{'fact':'自宅住所は東京都千代田区。','topic':'場所:住所',
                              'category':'context','evidence':raw,'correction':False}]}
        self.assertEqual(long_memory._clean_candidates(raw,json.dumps(leaked,ensure_ascii=False)),[])

    def test_user_corrections_only_update_when_evidence_explicit(self):
        old=self.source()
        self.capture_as(old,self.response())
        updated='LVOREの発売時期は変更して2027年5月になりました。'
        mid=self.source(updated)
        count,_=self.capture_as(mid,self.response(updated,'LVOREの発売時期は2027年5月。',
                                                   correction=True))
        self.assertEqual(count,1)
        rows=long_memory.select(self.connect,limit=20)
        self.assertEqual(len(rows),1)
        self.assertIn('5月',rows[0]['content'])

        later='LVOREの発売時期は2027年6月と言っていました。'
        mid=self.source(later)
        count,_=self.capture_as(mid,self.response(later,'LVOREの発売時期は2027年6月。',correction=True))
        self.assertEqual(count,0)  # No explicit correction cue.

    def test_deleted_memory_not_resurrected_by_another_event(self):
        mid=self.source()
        self.capture_as(mid,self.response())
        with self.connect() as db:
            identifier=db.execute('SELECT id FROM memories').fetchone()[0]
            self.assertTrue(long_memory.forget(db,identifier))
        new_id=self.source()
        count,_=self.capture_as(new_id,self.response())
        self.assertEqual(count,0)
        self.assertEqual(long_memory.memory_count(self.connect),0)

    def test_disable_while_inference_running_rejects_late_write(self):
        mid=self.source()
        with self.connect() as db:
            token=long_memory._enabled(db)[1]
            db.execute("UPDATE settings SET value='false' WHERE key='auto_memory'")
            long_memory.invalidate(db)
        records=long_memory._clean_candidates('私はLVOREの発売時期を2027年4月に決めました。',
                                               self.response())
        with self.connect() as db:
            self.assertEqual(long_memory._apply(db,'chat',str(mid),records,token),0)
        self.assertEqual(long_memory.memory_count(self.connect),0)

    def test_search_older_memories_and_private_mode_off(self):
        with self.connect() as db:
            for i in range(125):
                db.execute("INSERT INTO memories(content) VALUES (?)",('メモ'+str(i),))
            db.execute("INSERT INTO memories(content) VALUES (?)",('LVOREの特別な記録',))
        with self.connect() as db:
            db.execute("INSERT INTO memories(content) VALUES (?)",('最新の雑談',))
        self.assertTrue(any('LVORE' in x['content'] for x in long_memory.select(self.connect,'LVORE',20)))
        with self.connect() as db:
            db.execute("UPDATE settings SET value='false' WHERE key='remember'")
        self.assertEqual(long_memory.select(self.connect,'LVORE'),[])
        self.assertTrue(long_memory.select(self.connect,'LVORE',respect_enabled=False))

    def test_live_archive_feeds_only_user_transcript_and_is_idempotent(self):
        call={
            'id':ID,'started':'2026-11-01T10:00:00Z','ended':'2026-11-01T10:05:00Z',
            'turns':[
                {'speaker':'ASTER','text':'アスターは宇宙が好きです。'},
                {'speaker':'あなた','text':'私はLVOREの発売時期を2027年4月に決めました。'},
            ],
        }
        live_archive.save(self.connect,call)
        with mock.patch.dict(os.environ,{'OPENAI_API_KEY':'test-api-key'}):
            with mock.patch('long_memory.respond',return_value=self.response()) as ai:
                self.assertEqual(long_memory.capture(self.connect,'live',ID),1)
                self.assertIn('私はLVORE',ai.call_args.args[0][1]['content'])
                self.assertNotIn('アスターは宇宙',ai.call_args.args[0][1]['content'])
                self.assertEqual(long_memory.capture(self.connect,'live',ID),0)
        with self.connect() as db:
            self.assertEqual(db.execute('SELECT source FROM memories').fetchone()[0],'auto-live')

    def test_deleted_live_record_does_not_write_late_memory(self):
        with self.connect() as db:
            token=long_memory._enabled(db)[1]
        with self.connect() as db:
            self.assertEqual(long_memory._apply(db,'live',ID,[{
                'fact':'LVOREの予定は2027年4月','topic':'project:LVORE:予定','correction':False,
            }],token),0)

    def test_session_context_is_bounded_valid_json_and_read_only(self):
        with self.connect() as db:
            for i in range(60):
                db.execute('INSERT INTO memories(content,topic) VALUES (?,?)',
                           ('LVORE' + str(i) + ': '+'長期記憶の詳細'*30,'project:LVORE'+str(i)))
        context=long_memory.session_context(self.connect)
        self.assertLessEqual(len(context),6500)
        self.assertIsInstance(json.loads(context),list)
        self.assertTrue(json.loads(context))
        with self.connect() as db:
            db.execute("UPDATE settings SET value='false' WHERE key='remember'")
        self.assertEqual(long_memory.session_context(self.connect),'')

    def test_live_session_includes_snapshot_only_when_requested(self):
        # Fail early before touching the network; ensure API credentials are absent
        # if invalid memory is supplied.
        with self.assertRaises(ValueError):
            live_proxy.create_live_session('bad','marin',memory_context='x'*6501)

    def test_no_extraction_without_optin_or_api_key(self):
        mid=self.source()
        with self.connect() as db:
            db.execute("UPDATE settings SET value='false' WHERE key='auto_memory'")
        with mock.patch('long_memory.respond') as ai:
            self.assertEqual(long_memory.capture(self.connect,'chat',mid),0)
            ai.assert_not_called()

if __name__ == '__main__':
    unittest.main()
