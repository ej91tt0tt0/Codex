import json
import os
import tempfile
import threading
import unittest
import urllib.request
import base64
from unittest.mock import patch

TEMP = tempfile.TemporaryDirectory()
os.environ['APP_DATA_DIR'] = TEMP.name
os.environ.pop('ASSISTANT_API_KEY', None)
import server
from research import Answer

class AppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.init()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.base = 'http://127.0.0.1:' + str(cls.http.server_port)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def setUp(self):
        self.post('clear', {})

    def post(self, route, data):
        req = urllib.request.Request(self.base + '/api/' + route, data=json.dumps(data).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as res:
            return json.load(res)

    def test_memory_and_health_lifecycle(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY':''}):
            s = self.post('chat', {'content':'覚えて：短い回答が好き'})
        self.assertEqual(len(s['messages']), 2)
        self.assertEqual(s['memories'][0]['content'], '短い回答が好き')
        s = self.post('health', {'mood':2,'note':'少し頭が痛い'})
        self.assertEqual(s['health'][0]['mood'], 2)
        mid=s['memories'][0]['id']
        s=self.post('memory',{'id':mid,'content':'丁寧な回答が好き'})
        self.assertEqual(s['memories'][0]['content'],'丁寧な回答が好き')
        s=self.post('memory',{'id':mid,'delete':True})
        self.assertEqual(s['memories'],[])
        s=self.post('clear',{})
        self.assertTrue(all(not s[k] for k in ('messages','memories','health','news')))

    def test_disabling_long_term_memory_stops_using_saved_memories(self):
        self.post('memory', {'content':'MEMORY_DISABLED_SENTINEL'})
        self.post('settings', {'remember':'false'})
        try:
            with patch.dict(os.environ, {'OPENAI_API_KEY':'test'}), patch.object(server,'respond',return_value=Answer('返答')) as call:
                self.post('chat', {'content':'こんにちは'})
                self.assertNotIn('MEMORY_DISABLED_SENTINEL',json.dumps(call.call_args.args[0]))
            self.assertEqual(len(server.state()['memories']),1)
        finally:self.post('settings', {'remember':'true'})

    def test_concurrent_goal_increments_are_not_lost(self):
        from concurrent.futures import ThreadPoolExecutor
        s=self.post('goals',{'title':'同時操作の読書','target':100,'unit':'ページ'});gid=s['goals'][0]['id']
        def increment(_):
            with server.connect() as c:server.companion.edit_goal(c,{'id':gid,'increment':1})
        with ThreadPoolExecutor(max_workers=16) as pool:list(pool.map(increment,range(64)))
        goal=next(g for g in server.state()['goals'] if g['id']==gid)
        self.assertEqual(goal['progress'],64)

    def test_each_chat_response_contains_its_own_answer_under_concurrent_requests(self):
        import time
        from concurrent.futures import ThreadPoolExecutor
        original=server.state;entered,release=threading.Event(),threading.Event()
        def snapshot():
            result=original()
            if result['messages'] and result['messages'][-1]['content']=='Aの返答' and not entered.is_set():
                entered.set();release.wait(3)
            return result
        def generate(s):return Answer('Aの返答' if s['messages'][-1]['content']=='Aの発言' else 'Bの返答')
        with patch.object(server,'state',side_effect=snapshot),patch.object(server,'generate_reply',side_effect=generate),ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(self.post,'chat',{'content':'Aの発言'})
            try:
                self.assertTrue(entered.wait(2))
                b=pool.submit(self.post,'chat',{'content':'Bの発言'});time.sleep(.04)
                self.assertFalse(b.done())
            finally:release.set()
            first,second=a.result(timeout=3),b.result(timeout=3)
        self.assertEqual(first['messages'][-1]['content'],'Aの返答')
        self.assertEqual(second['messages'][-1]['content'],'Bの返答')
        self.assertLess(first['snapshot_revision'],second['snapshot_revision'])

    def test_state_snapshots_have_increasing_revisions_and_are_read_only(self):
        first,second=server.state(),server.state()
        self.assertLess(first['snapshot_revision'],second['snapshot_revision'])
        self.assertEqual(first['messages'],second['messages']);self.assertEqual(first['settings'],second['settings'])

    def test_clear_waits_for_an_earlier_response_from_another_tab(self):
        from concurrent.futures import ThreadPoolExecutor
        entered,release=threading.Event(),threading.Event()
        def delayed(*args,**kwargs):
            entered.set();release.wait(3);return '削除前に開始した返答'
        with patch.object(server,'generate_reply',side_effect=delayed),ThreadPoolExecutor(max_workers=2) as pool:
            chat=pool.submit(self.post,'chat',{'content':'削除前の発言'})
            self.assertTrue(entered.wait(2))
            clear=pool.submit(self.post,'clear',{})
            try:
                import time
                time.sleep(.04);self.assertFalse(clear.done())
            finally:release.set()
            chat.result(timeout=3);clear.result(timeout=3)
        self.assertEqual(server.state()['messages'],[])

    def test_backup_is_a_consistent_database_copy_without_environment_credentials(self):
        import sqlite3
        from pathlib import Path
        self.post('memory', {'content':'バックアップで守る記憶'})
        self.post('goals', {'title':'読む','target':3,'unit':'冊'})
        with patch.dict(os.environ, {'OPENAI_API_KEY':'BACKUP_MUST_NOT_INCLUDE_THIS_KEY'}):
            with urllib.request.urlopen(self.base+'/api/backup') as response:
                data=response.read();self.assertEqual(response.headers['Content-Type'],'application/vnd.sqlite3')
                self.assertIn('attachment;',response.headers['Content-Disposition'])
        self.assertNotIn(b'BACKUP_MUST_NOT_INCLUDE_THIS_KEY',data)
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'restored.sqlite3';target.write_bytes(data)
            with sqlite3.connect(target) as c:
                self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(c.execute('SELECT content FROM memories').fetchone()[0],'バックアップで守る記憶')
                self.assertEqual(c.execute('SELECT title FROM goals').fetchone()[0],'読む')
        self.assertEqual(len(server.state()['memories']),1)

    def test_persona_modes_and_feedback_apply_without_api(self):
        with patch.object(server,'generate_reply') as model:
            s=self.post('chat',{'content':'ただ聞いてほしい'});self.assertEqual(s['settings']['conversation_mode'],'listen')
            self.post('chat',{'content':'一緒に考えたい'});self.post('chat',{'content':'もっと短く'});self.post('chat',{'content':'質問は少なめで'});model.assert_not_called()
        self.assertEqual(server.settings()['conversation_mode'],'think');self.post('settings',{'reply_style':'normal'})

    def test_remembering_questions_are_conversation_and_private_actions_remain_local(self):
        with patch.object(server,'generate_reply',return_value=Answer('前の話を確認するね。')) as model:
            s=self.post('chat',{'content':'アスター、覚えている？'})
            self.assertEqual(s['memories'],[]);model.assert_called_once()
        with patch.object(server,'generate_reply') as model:
            for content in ('ASTER、覚えて：保存しない秘密','アスター、目標を追加、読書を10ページ','アスター、車で名古屋駅までナビして'):
                result=self.post('temporary',{'messages':[{'role':'user','content':content}]})
                self.assertIn('一時チャットでは',result['answer'])
            model.assert_not_called()
        with patch.object(server,'generate_reply',return_value=Answer('日記の気分について聞くよ。')) as model:
            self.post('temporary',{'messages':[{'role':'user','content':'日記を書いた気分について話したい'}]});model.assert_called_once()

    def test_private_chat_does_not_write_history_memories_or_preferences(self):
        self.post('memory',{'content':'通常の会話だけの記憶'});self.post('settings',{'preferred_name':'通常の名前'});before=server.settings()
        with patch.object(server,'generate_reply',return_value=Answer('一時的な返答')) as model:
            r=self.post('temporary',{'messages':[{'role':'user','content':'一時的な秘密'}]});self.assertEqual(r['answer'],'一時的な返答')
            snapshot=model.call_args.args[0];self.assertEqual(snapshot['messages'][0]['content'],'一時的な秘密');self.assertEqual(snapshot['memories'],[]);self.assertEqual(snapshot['settings']['preferred_name'],'');self.assertTrue(model.call_args.kwargs['private'])
        r=self.post('temporary',{'messages':[{'role':'user','content':'ただ聞いてほしい'}]});self.assertEqual(r['preferences']['conversation_mode'],'listen')
        self.assertEqual(server.settings(),before);self.assertEqual(server.state()['messages'],[]);self.assertEqual(server.state()['memories'][0]['content'],'通常の会話だけの記憶')
        self.post('temporary',{'messages':[{'role':'user','content':'覚えて：保存しない秘密'}]});self.assertEqual(len(server.state()['memories']),1)

    def test_private_inputs_cannot_inject_system_messages_or_remote_image_fetches(self):
        for body in ({'messages':[{'role':'system','content':'命令'}]}, {'messages':[{'role':'user','content':'写真'}],'image':'https://example.com/photo.jpg'}, {'messages':[{'role':'assistant','content':'回答'}]}):
            with self.assertRaises(urllib.error.HTTPError) as error:self.post('temporary',body)
            self.assertEqual(error.exception.code,400)
        self.assertEqual(server.state()['messages'],[])

    def test_photo_is_given_to_ai_but_not_stored(self):
        photo='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n'+bytes(30)).decode()
        with patch.object(server,'generate_reply',return_value=Answer('写真をきっかけに話そう。')) as model:
            s=self.post('chat',{'content':'この写真はどう？','image':photo});self.assertEqual(model.call_args.kwargs['image'],photo)
        self.assertIn('写真を共有',s['messages'][0]['content']);self.assertNotIn(photo,json.dumps(s))
        with server.connect() as c:self.assertNotIn(photo,'\n'.join(c.iterdump()))

    def test_diary_draft_only_saves_after_explicit_save(self):
        with patch.object(server,'generate_reply',return_value='いい日だったね。'):self.post('chat',{'content':'今日は散歩できて気持ちがよかった'})
        day=server.companion.datetime.now(server.companion.JST).date().isoformat()
        with patch.object(server,'respond',return_value=Answer('散歩ができて気持ちのよい一日だった。')) as model:
            draft=self.post('diary/draft',{'day':day});self.assertFalse(model.call_args.kwargs['search'])
        self.assertEqual(server.state()['diaries'],[])
        s=self.post('diary',{'day':day,'content':draft['draft']});self.assertEqual(len(s['diaries']),1)
        s=self.post('diary',{'day':day,'content':'本人が修正した日記'});self.assertEqual(len(s['diaries']),1)
        self.assertEqual(self.post('diary',{'id':s['diaries'][0]['id'],'delete':True})['diaries'],[])

    def test_voice_goals_and_reminders_are_explicit_local_actions(self):
        with patch.object(server,'generate_reply') as model:
            s=self.post('chat',{'content':'目標を追加、読書を10ページ'});goal=s['goals'][0];self.assertEqual(goal['target'],10);self.assertEqual(goal['title'],'読書')
            s=self.post('chat',{'content':f'目標{goal["id"]}を2進めて'});self.assertEqual(s['goals'][0]['progress'],2)
            s=self.post('chat',{'content':'毎日20時に一日の振り返りを知らせて'});self.assertEqual(s['reminders'][0]['repeat'],'daily');model.assert_not_called()
        self.assertEqual(self.post('reminders/due',{})['deliveries'],[])

    def test_clear_removes_new_records_and_personal_profile(self):
        self.post('settings',{'preferred_name':'ユウ','hobbies':'映画','blocked_topics':'政治'});self.post('diary',{'day':'2026-10-25','content':'日記'})
        self.post('goals',{'title':'読書','target':3,'unit':'冊'});self.post('reminders',{'title':'振り返り','schedule':'2026-01-01T20:00','repeat':'once'});self.post('reminders/due',{})
        s=self.post('clear',{})
        for table in ('messages','memories','diaries','goals','reminders','reminder_deliveries'):self.assertEqual(s[table],[])
        for key in server.companion.PERSONAL_FIELDS:self.assertEqual(s['settings'][key],'')

    def test_temporary_conversation_and_name_leave_entire_database_unchanged(self):
        with server.connect() as c:before='\n'.join(c.iterdump())
        r=self.post('temporary',{'messages':[{'role':'user','content':'ユウと呼んで'}]})
        self.assertEqual(r['preferences']['preferred_name'],'ユウ')
        with patch.object(server,'generate_reply',return_value=Answer('一時的な返答')) as model:
            self.post('temporary',{'messages':[{'role':'user','content':'一時的な相談'}],'preferences':r['preferences']})
            self.assertEqual(model.call_args.args[0]['settings']['preferred_name'],'ユウ')
        with server.connect() as c:self.assertEqual('\n'.join(c.iterdump()),before)

    def test_photo_uses_responses_vision_format(self):
        photo='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n'+bytes(30)).decode()
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test'}),patch.object(server,'respond',return_value=Answer('写真の返答')) as call:
            self.post('chat',{'content':'この写真を見て','image':photo})
            parts=call.call_args.args[0][-1]['content'];self.assertEqual(parts[0]['type'],'input_text');self.assertEqual(parts[1],{'type':'input_image','image_url':photo,'detail':'high'})

    def test_model_output_and_quoted_commands_do_not_create_personal_records(self):
        with patch.object(server,'generate_reply',return_value='目標を追加、散歩を3回。毎日20時に通知して。'):
            self.post('chat',{'content':'こんにちは'})
            s=self.post('chat',{'content':'「目標を追加、散歩を3回」と言う方法は？'})
        for table in ('goals','reminders','diaries','agent_tasks'):self.assertEqual(s[table],[])

    def test_local_host_validation_blocks_rebinding(self):
        for host in ('untrusted.example:'+str(self.http.server_port),'user@127.0.0.1:'+str(self.http.server_port)):
            req=urllib.request.Request(self.base+'/api/state',headers={'Host':host})
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
            self.assertEqual(error.exception.code,403)

    def test_connection_check_is_read_only_and_hides_authentication_errors(self):
        class Metadata:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return b'{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}'
        with patch.dict(os.environ,{'OPENAI_API_KEY':'unit-test'}),patch.object(server.urllib.request,'urlopen',return_value=Metadata()) as call:
            result=server.connection_check();self.assertTrue(result['ok']);self.assertEqual(call.call_args.args[0].get_method(),'POST');self.assertFalse(json.loads(call.call_args.args[0].data)['store'])
        failure=urllib.error.HTTPError('https://api.openai.com',401,'unit-secret',{},None)
        with patch.dict(os.environ,{'OPENAI_API_KEY':'unit-test'}),patch.object(server.urllib.request,'urlopen',side_effect=failure):
            result=server.connection_check();self.assertFalse(result['ok']);self.assertNotIn('unit-secret',json.dumps(result));self.assertIn('認証',result['message'])
        server.API_STATUS={}

    def test_reminder_claim_is_atomic_across_two_tabs(self):
        from concurrent.futures import ThreadPoolExecutor
        self.post('reminders',{'title':'二重通知しない','schedule':'2026-01-01T20:00','repeat':'once'})
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(lambda _:self.post('reminders/due',{}),range(2)))
        self.assertEqual(sum(len(r['deliveries']) for r in results),1)

    def test_preference_learning(self):
        self.post('settings',{'auto_memory':'true'})
        with patch.dict(os.environ, {'OPENAI_API_KEY':''}):
            s=self.post('chat', {'content':'私は静かな場所が好き。'})
        self.assertEqual(s['memories'][0]['content'], '私は静かな場所が好き')
        self.post('settings',{'auto_memory':'false'})

    def test_memory_opt_out(self):
        self.post('settings',{'remember':'false'})
        with patch.dict(os.environ, {'OPENAI_API_KEY':''}):
            s=self.post('chat',{'content':'覚えて：秘密'})
        self.assertEqual(s['memories'],[])
        self.post('settings',{'remember':'true'})

    def test_ai_receives_personal_context(self):
        self.post('memory',{'content':'短く回答'})
        self.post('health',{'mood':3,'note':'よく眠れた'})
        class Response:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self): return json.dumps({'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'こんにちは','annotations':[]}]}]}).encode()
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test'}), patch.object(server.urllib.request,'urlopen',return_value=Response()) as request:
            answer=server.chat('こんにちは')
            payload=json.loads(request.call_args.args[0].data)
            self.assertIn('短く回答',payload['input'][0]['content'])
            self.assertIn('よく眠れた',payload['input'][0]['content'])
            self.assertEqual(answer,'こんにちは')

    def test_conversation_research_is_bound_to_reply_and_never_launches_apps(self):
        answer=Answer('公式情報では更新があったよ。',[{'url':'https://example.com/info','title':'公式情報','cited':True}],1)
        with patch.object(server,'generate_reply',return_value=answer),patch.object(server.webbrowser,'open') as browser:
            s=self.post('chat',{'content':'今日のニュースを調べて'})
            r=s['research_runs'][0]
            self.assertEqual(r['message_id'],s['messages'][-1]['id'])
            self.assertEqual(r['sources'][0]['url'],'https://example.com/info')
            self.assertEqual(r['searches'],1)
            browser.assert_not_called()
        self.assertEqual(self.post('clear',{})['research_runs'],[])

    def test_scheduled_research_limits_inputs_preserves_data_and_does_not_speak(self):
        self.post('memory',{'content':'送らない記憶'})
        self.post('health',{'mood':3,'note':'送らない体調'})
        self.post('settings',{'web_search':'true','ai_collect':'true'})
        answer=Answer('確認できた分野と未確認の分野',[{'url':'https://example.com/','title':'発表','cited':True}],1)
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test'}),patch.object(server,'respond',return_value=answer) as call:
            s=self.post('research',{})
            text=json.dumps(call.call_args.args[0],ensure_ascii=False)
            for private in ('送らない記憶','送らない体調','浜田町'):self.assertNotIn(private,text)
            self.assertIn('碧南市',text)
            self.assertTrue(call.call_args.kwargs['require_search'])
            self.assertEqual(s['messages'],[])
            self.assertEqual(s['research_runs'][0]['kind'],'scheduled')
            self.assertEqual(s['memories'][0]['content'],'送らない記憶')
            self.assertFalse(server.research_due(server.settings()))

    def test_failed_research_records_failure_and_waits_an_hour_before_retry(self):
        self.post('settings',{'automatic':'true','ai_collect':'true','web_search':'true'})
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test'}),patch.object(server,'respond',side_effect=server.ResearchError('接続できません')):
            with self.assertRaises(urllib.error.HTTPError) as error:self.post('research',{})
            self.assertEqual(error.exception.code,502)
            config=server.settings();last=server.datetime.fromisoformat(config['last_research_attempt']).timestamp()
            self.assertFalse(server.research_due(config,last+3599))
            self.assertTrue(server.research_due(config,last+3600))
            self.assertEqual(server.state()['research_runs'][0]['error'],'接続できません')
            for key in ('automatic','ai_collect','web_search'):
                c=dict(config);c[key]='false';self.assertFalse(server.research_due(c,last+7200))

    def test_web_search_disabled_and_manual_query_does_not_fake_a_search(self):
        self.post('settings',{'web_search':'false'})
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test'}),patch.object(server,'respond',return_value=Answer('雑談')) as call:
            self.post('chat',{'content':'こんにちは'})
            self.assertFalse(call.call_args.kwargs['search'])
            call.reset_mock()
            s=self.post('chat',{'content':'Webで調べて：最新のニュース'})
            call.assert_not_called();self.assertIn('オフ',s['messages'][-1]['content'])
            with self.assertRaises(urllib.error.HTTPError):self.post('research',{})
        self.post('settings',{'web_search':'true'})

    def test_busy_and_unconfigured_research_do_not_send_requests(self):
        with patch.dict(os.environ,{'OPENAI_API_KEY':'','ASSISTANT_API_KEY':''}),patch.object(server,'respond') as call:
            with self.assertRaises(urllib.error.HTTPError):self.post('research',{})
            call.assert_not_called()
        server.RESEARCH_LOCK.acquire()
        try:
            with self.assertRaises(urllib.error.HTTPError):self.post('research',{})
        finally:server.RESEARCH_LOCK.release()

    def test_spoken_research_settings_need_no_ai_request(self):
        with patch.object(server,'respond') as call:
            s=self.post('chat',{'content':'設定変更、Web検索を止めて'})
            self.assertEqual(s['settings']['web_search'],'false')
            s=self.post('chat',{'content':'設定変更、AIの自動収集を止めて'})
            self.assertEqual(s['settings']['ai_collect'],'false')
            self.post('chat',{'content':'設定変更、Web検索を再開して'})
            self.post('chat',{'content':'設定変更、AIの自動収集を再開して'})
            call.assert_not_called()

    def test_hands_free_setting_is_explicit_and_survives_migration(self):
        with patch.object(server,'generate_reply') as call:
            s=self.post('chat',{'content':'設定変更、常時待ち受けを止めて'})
            self.assertEqual(s['settings']['hands_free'],'false');server.init()
            self.assertEqual(server.settings()['hands_free'],'false')
            self.post('chat',{'content':'設定変更、常時待ち受けを再開して'})
            self.assertEqual(server.settings()['hands_free'],'true');call.assert_not_called()
        with self.assertRaises(urllib.error.HTTPError):self.post('settings',{'hands_free':'invalid'})

    def test_hourly_collection_schedule(self):
        s={'automatic':'true','last_collected':'2026-10-24T00:00:00+00:00'}
        start=server.datetime.fromisoformat(s['last_collected']).timestamp()
        self.assertFalse(server.collection_due(s,start+3599))
        self.assertTrue(server.collection_due(s,start+3600))
        s['automatic']='false'
        self.assertFalse(server.collection_due(s,start+7200))
        s.update(automatic='true',last_collected='')
        self.assertTrue(server.collection_due(s,start))

    def test_initiative_rate_limit_cap_and_reset(self):
        self.post('settings', {'proactive_enabled':'true','proactive_interval':'60'})
        with patch.object(server,'generate_reply',return_value='少し休憩しましょう。') as generate:
            for n in range(1):
                with patch.object(server.time,'time',return_value=1000+n*60):
                    server.proactive('thought')
            self.assertEqual(generate.call_count,1)
            with patch.object(server.time,'time',return_value=2000):
                with self.assertRaises(server.InitiativeLimit): server.proactive('question')
            server.chat('話そう')
            with patch.object(server.time,'time',return_value=2100): server.proactive('question')
        self.assertEqual(len([m for m in server.state()['messages'] if m['role']=='user']),1)

    def test_conversation_upgrade_reduces_old_cadence_once_and_preserves_other_preferences(self):
        self.post('memory',{'content':'残す記憶'})
        self.post('settings',{'proactive_interval':'180','hands_free':'false','automatic':'false','proactive_topics':'true'})
        with server.connect() as c:c.execute("DELETE FROM settings WHERE key='conversation_flow_version'")
        server.init();cfg=server.settings()
        self.assertEqual(cfg['proactive_interval'],'600');self.assertEqual(cfg['proactive_topics'],'false')
        self.assertEqual(cfg['hands_free'],'false');self.assertEqual(cfg['automatic'],'false')
        self.assertEqual(server.state()['memories'][0]['content'],'残す記憶')
        self.post('settings',{'proactive_interval':'300','proactive_topics':'true'})
        server.init();self.assertEqual(server.settings()['proactive_interval'],'300');self.assertEqual(server.settings()['proactive_topics'],'true')
        self.post('settings',{'proactive_interval':'600','proactive_topics':'false','hands_free':'true'})

    def test_proactive_prompt_excludes_registered_topics_unless_user_opts_in(self):
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps({'choices':[{'message':{'content':'話したくなったら聞くよ。'}}]}).encode()
        s=server.state();s['settings']['topics']='勝手に持ち出さない登録テーマ';s['settings']['proactive_topics']='false'
        with patch.dict(os.environ,{'OPENAI_API_KEY':'test'}),patch.object(server.urllib.request,'urlopen',return_value=Response()) as request:
            server.generate_reply(s,initiative='thought');payload=json.loads(request.call_args.args[0].data)
            prompt=payload['messages'][0]['content']
            self.assertNotIn('勝手に持ち出さない登録テーマ',prompt)
            self.assertIn('意味が完結する段落',prompt);self.assertIn('質問や返事の催促をせず',prompt)
            s['settings']['proactive_topics']='true';server.generate_reply(s,initiative='thought')
            self.assertIn('勝手に持ち出さない登録テーマ',json.loads(request.call_args.args[0].data)['messages'][0]['content'])

    def test_voice_can_reduce_topic_suggestions_without_disabling_information_collection(self):
        self.post('settings',{'automatic':'true','proactive_topics':'true','proactive_interval':'180'})
        with patch.object(server,'generate_reply') as generate:
            s=self.post('chat',{'content':'設定変更、テーマの話題提案を減らして'})
            self.assertEqual(s['settings']['proactive_topics'],'false');self.assertEqual(s['settings']['automatic'],'true')
            s=self.post('chat',{'content':'設定変更、声かけを減らして'})
            self.assertEqual(s['settings']['proactive_interval'],'600');generate.assert_not_called()
        with self.assertRaises(urllib.error.HTTPError):self.post('settings',{'proactive_topics':'invalid'})

    def test_initiative_interval_and_opt_out(self):
        self.post('settings',{'proactive_enabled':'true','proactive_interval':'180'})
        with patch.object(server,'generate_reply',return_value='一言'):
            with patch.object(server.time,'time',return_value=1000):server.proactive('thought')
            server.chat('声かけへの返事')
            with patch.object(server.time,'time',return_value=1179):
                with self.assertRaises(server.InitiativeLimit):server.proactive('question')
            self.post('settings',{'proactive_enabled':'false'})
            with patch.object(server.time,'time',return_value=2000):
                with self.assertRaises(server.InitiativeLimit):server.proactive('thought')
        self.post('settings',{'proactive_enabled':'true'})

    def test_speech_endpoint_returns_audio_not_json(self):
        with patch.object(server,'speech_audio',return_value=b'ID3test'):
            req=urllib.request.Request(self.base+'/api/speech',data=json.dumps({'text':'こんにちは'}).encode(),headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req) as r:
                self.assertEqual(r.headers['Content-Type'],'audio/mpeg')
                self.assertEqual(r.read(),b'ID3test')
        with self.assertRaises(urllib.error.HTTPError): self.post('settings',{'proactive_interval':'1'})

    def test_transcription_endpoint_accepts_wav_and_rejects_other_formats(self):
        wav=b'RIFF'+bytes(4)+b'WAVE'+bytes(1500)
        with patch.object(server,'transcribe_audio',return_value='名鉄三河線の予定を変えたい') as transcribe:
            req=urllib.request.Request(self.base+'/api/transcribe',data=wav,headers={'Content-Type':'audio/wav'})
            with urllib.request.urlopen(req) as r:self.assertEqual(json.load(r)['text'],'名鉄三河線の予定を変えたい')
            transcribe.assert_called_once_with(wav,'audio/wav')
        req=urllib.request.Request(self.base+'/api/transcribe',data=wav,headers={'Content-Type':'audio/mp3'})
        with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
        self.assertEqual(error.exception.code,415)
        req=urllib.request.Request(self.base+'/api/transcribe',data=wav,headers={'Content-Type':'audio/wav','Origin':'https://untrusted.example'})
        with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
        self.assertEqual(error.exception.code,403)

    def test_quality_mode_setting_preserves_existing_memory(self):
        self.post('memory',{'content':'記憶を引き継ぐ'})
        s=self.post('settings',{'high_quality_input':'false'})
        self.assertEqual(s['settings']['high_quality_input'],'false')
        self.assertEqual(s['memories'][0]['content'],'記憶を引き継ぐ')
        self.post('settings',{'high_quality_input':'true'})

    def test_spoken_settings_apply_without_model_and_survive_initialization(self):
        with patch.object(server,'generate_reply') as generate:
            s=self.post('chat',{'content':'設定変更、返答を短くして'})
            self.assertEqual(s['settings']['reply_style'],'short')
            self.assertIn('短め',s['messages'][-1]['content'])
            self.post('chat',{'content':'設定変更、声かけを止めて'})
            self.assertEqual(server.settings()['proactive_enabled'],'false')
            generate.assert_not_called()
        server.init()
        self.assertEqual(server.settings()['reply_style'],'short')
        self.post('settings',{'reply_style':'normal','proactive_enabled':'true'})

    def test_spoken_improvements_are_requests_not_executed_changes(self):
        with patch.object(server,'generate_reply') as generate:
            s=self.post('chat',{'content':'改善リクエスト、画面の文字を大きくして'})
            generate.assert_not_called()
        self.assertEqual(s['improvement_requests'][0]['status'],'未実装')
        self.assertEqual(s['improvement_requests'][0]['content'],'画面の文字を大きくして')
        self.assertIn('コードはまだ変更していない',s['messages'][-1]['content'])
        self.assertEqual(self.post('clear',{})['improvement_requests'],[])

    def test_unknown_spoken_settings_cannot_clear_private_records(self):
        self.post('memory',{'content':'消さない記憶'})
        s=self.post('chat',{'content':'設定変更、すべて削除して'})
        self.assertEqual(s['memories'][0]['content'],'消さない記憶')
        self.assertIn('使える',s['messages'][-1]['content'])
        with self.assertRaises(urllib.error.HTTPError):self.post('settings',{'speech_speed':'99'})

    def test_navigation_is_prepared_without_headless_app_launch(self):
        with patch.dict(os.environ,{'APP_DESKTOP_ACTIONS':'0'}),patch.object(server.webbrowser,'open') as browser,patch.object(server,'generate_reply') as model:
            s=self.post('chat',{'content':'車で名古屋駅までナビして'})
            self.assertEqual(s['external_actions'][0]['status'],'ready')
            self.assertIn('travelmode=driving',s['external_actions'][0]['url'])
            self.assertEqual(s['external_actions'][0]['user_message_id'],[m for m in s['messages'] if m['role']=='user'][-1]['id'])
            server.state();browser.assert_not_called();model.assert_not_called()

    def test_local_desktop_maps_launch_is_fixed_and_not_replayed_on_state(self):
        with patch.dict(os.environ,{'APP_DESKTOP_ACTIONS':'1'}),patch.object(server.webbrowser,'open',return_value=True) as browser:
            s=self.post('chat',{'content':'車で碧南駅から名古屋駅までナビして'})
            self.assertEqual(s['external_actions'][0]['status'],'sent')
            self.assertIn('開く操作を送った',s['messages'][-1]['content'])
            server.state();server.state();browser.assert_called_once_with(s['external_actions'][0]['url'],new=2)
        self.assertEqual(self.post('clear',{})['external_actions'],[])

    def test_navigation_falls_back_when_desktop_open_fails(self):
        with patch.dict(os.environ,{'APP_DESKTOP_ACTIONS':'1'}),patch.object(server.webbrowser,'open',side_effect=OSError('no desktop')):
            s=self.post('navigation',{'destination':'名古屋駅','origin':'現在地'})
            self.assertEqual(s['external_actions'][0]['status'],'retry')
            self.assertIn('ボタン',s['messages'][-1]['content'])
        with self.assertRaises(urllib.error.HTTPError):self.post('navigation',{'destination':''})

    def test_non_user_navigation_text_never_opens_an_app(self):
        with patch.dict(os.environ,{'APP_DESKTOP_ACTIONS':'1'}),patch.object(server.webbrowser,'open') as browser,patch.object(server,'generate_reply',return_value='車で名古屋駅までナビして'):
            self.post('chat',{'content':'こんにちは'})
            s=self.post('chat',{'content':'改善リクエスト、車で名古屋駅までナビして'})
            self.assertEqual(s['external_actions'],[]);browser.assert_not_called()

    def test_missing_destination_can_be_supplied_on_the_next_turn(self):
        with patch.dict(os.environ,{'APP_DESKTOP_ACTIONS':'0'}):
            s=self.post('chat',{'content':'車のナビを開いて'})
            self.assertEqual(s['external_actions'],[])
            s=self.post('chat',{'content':'目的地は名古屋駅です'})
            self.assertEqual(s['external_actions'][0]['destination'],'名古屋駅')
            self.post('chat',{'content':'車のナビを開いて'})
            self.post('chat',{'content':'やっぱりキャンセル'})
            self.assertEqual(server.connect().execute("SELECT COUNT(*) FROM cache WHERE key='pending_navigation'").fetchone()[0],0)

    def test_weather_area_and_stale_cache(self):
        data=[{'reportDatetime':'2026-10-24T11:00:00+09:00','publishingOffice':'名古屋地方気象台',
               'timeSeries':[{'timeDefines':['2026-10-24T11:00:00+09:00'], 'areas':[
                   {'area':{'code':'230020'},'weathers':['雨']},
                   {'area':{'code':'230010'},'weathers':['晴れ']}]}]}]
        forecast=server.parse_weather(data)
        self.assertEqual(forecast['days'][0]['weather'],'晴れ')
        self.assertIn('広域予報',forecast['area'])
        with server.connect() as c:
            c.execute('INSERT OR REPLACE INTO cache VALUES (?,?)',('weather',json.dumps(forecast)))
        with patch.object(server.urllib.request,'urlopen',side_effect=OSError('offline')):
            with self.assertRaises(OSError): server.fetch_weather()
        old=server.cached_weather()
        self.assertEqual(old['reported_at'],forecast['reported_at'])
        self.assertTrue(old['error'])
        self.assertEqual(self.post('clear',{})['weather'],None)

    def test_regional_queries(self):
        self.post('settings', {'regional_topics':'名鉄三河線 運行,国道23号 愛知 渋滞'})
        class Feed:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,*args): return b'<rss><channel/></rss>'
        with patch.object(server.urllib.request,'urlopen',return_value=Feed()) as request:
            server.fetch_news()
        self.assertEqual(request.call_count,2)
        from urllib.parse import urlsplit,parse_qs
        query=parse_qs(urlsplit(request.call_args.args[0].full_url).query)['q'][0]
        self.assertIn('名鉄三河線 運行 OR 国道23号 愛知 渋滞',query)

    def test_rss_deduplication(self):
        class Feed:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,*args): return b'<rss><channel><item><title>News</title><link>https://example.com/news</link></item></channel></rss>'
        with patch.object(server.urllib.request,'urlopen',return_value=Feed()):
            server.fetch_news()
            server.fetch_news()
        self.assertEqual(len(server.state()['news']),1)
        self.assertTrue(server.settings()['last_collected'])

    def test_input_and_origin_validation(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.post('health',{'mood':9})
        self.assertEqual(error.exception.code,400)
        req=urllib.request.Request(self.base+'/api/clear',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://untrusted.example'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(req)
        self.assertEqual(error.exception.code,403)

if __name__=='__main__': unittest.main()
