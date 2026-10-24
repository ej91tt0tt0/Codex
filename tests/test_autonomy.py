import json
import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import autonomy
from research import Answer, ResearchError

class AutonomyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.db=self.tmp.name+'/tasks.sqlite3'
        self.env=patch.dict(os.environ,{'ASSISTANT_API_KEY':'','OPENAI_API_KEY':'unit-test'});self.env.start()
        with self.connect() as c:
            c.execute('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)')
            c.executemany('INSERT INTO settings VALUES (?,?)',[('agent_enabled','true'),('web_search','true'),('agent_daily_limit','3'),('preferred_name','SHOULD_NOT_SEND')]);autonomy.init_schema(c)
    def tearDown(self):self.env.stop();self.tmp.cleanup()
    def connect(self):
        c=sqlite3.connect(self.db,timeout=5);c.row_factory=sqlite3.Row;return c
    def add(self,title='外出情報',enabled=True):
        with self.connect() as c:
            autonomy.edit_task(c,{'title':title,'instruction':'公式情報を確認して変化をまとめる','interval_hours':6,'enabled':enabled})
            return c.execute('SELECT MAX(id) FROM agent_tasks').fetchone()[0]
    def answer(self,*args,**kwargs):return Answer('確認した結果',[{'url':'https://example.com/','title':'出典','cited':True}],1)
    def test_task_uses_only_instruction_previous_result_and_bounded_hosted_search(self):
        tid=self.add();calls=[]
        def respond(messages,**kwargs):calls.append((messages,kwargs));return self.answer()
        autonomy.run_task(self.connect,respond,tid)
        autonomy.run_task(self.connect,respond,tid)
        self.assertNotIn('SHOULD_NOT_SEND',json.dumps(calls));self.assertTrue(calls[0][1]['require_search'])
        self.assertIn('前回の結果',calls[1][0][1]['content']);self.assertIn('確認した結果',calls[1][0][1]['content'])
        with self.connect() as c:
            state=autonomy.state(c);self.assertEqual(state['agent_runs'][0]['searches'],1);self.assertEqual(state['agent_tasks'][0]['status'],'完了・次回待機')
    def test_failure_is_recorded_and_waits_for_next_interval(self):
        tid=self.add();now=datetime.now(timezone.utc)+timedelta(seconds=1);calls=0
        def fail(*args,**kwargs):
            nonlocal calls;calls+=1;raise ResearchError('一時的な接続エラー')
        with self.assertRaises(ResearchError):autonomy.run_task(self.connect,fail,tid,automatic=True,now=now)
        self.assertIsNone(autonomy.run_task(self.connect,fail,tid,automatic=True,now=now+timedelta(seconds=30)));self.assertEqual(calls,1)
        with self.connect() as c:self.assertEqual(autonomy.state(c)['agent_runs'][0]['error'],'一時的な接続エラー')
    def test_daily_automatic_limit_and_explicit_manual_run_are_separate(self):
        a,b=self.add('A'),self.add('B');now=datetime.now(timezone.utc)+timedelta(seconds=1)
        with self.connect() as c:c.execute("UPDATE settings SET value='1' WHERE key='agent_daily_limit'")
        autonomy.run_task(self.connect,self.answer,a,automatic=True,now=now)
        self.assertIsNone(autonomy.run_task(self.connect,self.answer,b,automatic=True,now=now))
        autonomy.run_task(self.connect,self.answer,b,now=now)
        autonomy.run_task(self.connect,self.answer,a,automatic=True,now=now+timedelta(days=1))
        with self.connect() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM agent_runs').fetchone()[0],3)
    def test_duplicate_concurrent_run_is_rejected(self):
        tid=self.add();entered=threading.Event();release=threading.Event();errors=[]
        def respond(*args,**kwargs):entered.set();release.wait(3);return self.answer()
        def first():
            try:autonomy.run_task(self.connect,respond,tid)
            except Exception as exc:errors.append(exc)
        thread=threading.Thread(target=first);thread.start();self.assertTrue(entered.wait(3))
        try:
            with self.assertRaises(ResearchError):autonomy.run_task(self.connect,self.answer,tid)
        finally:release.set();thread.join(4)
        self.assertEqual(errors,[])
        with self.connect() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM agent_runs').fetchone()[0],1)
    def test_paused_task_and_global_stop_do_not_call_ai(self):
        tid=self.add(enabled=False);calls=[]
        with self.assertRaises(ResearchError):autonomy.run_task(self.connect,lambda *a,**k:calls.append(1),tid)
        with self.connect() as c:
            autonomy.edit_task(c,{'id':tid,'enabled':True});c.execute("UPDATE settings SET value='false' WHERE key='agent_enabled'")
        autonomy.sweep(self.connect,lambda *a,**k:calls.append(1));self.assertEqual(calls,[])
    def test_interrupted_run_can_recover_and_ids_do_not_reuse_deleted_task(self):
        tid=self.add();now=datetime.now(timezone.utc)
        with self.connect() as c:c.execute('INSERT INTO agent_runs(task_id,automatic,started) VALUES (?,?,?)',(tid,1,(now-timedelta(minutes=16)).isoformat()))
        autonomy.run_task(self.connect,self.answer,tid)
        with self.connect() as c:
            self.assertTrue(c.execute('SELECT error FROM agent_runs ORDER BY id LIMIT 1').fetchone()[0]);autonomy.edit_task(c,{'id':tid,'delete':True})
        self.assertGreater(self.add(),tid)

if __name__=='__main__':unittest.main()
