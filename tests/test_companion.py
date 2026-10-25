import base64
import sqlite3
import unittest
from datetime import datetime, timedelta
import companion

class CompanionDomainTests(unittest.TestCase):
    def setUp(self):
        self.c=sqlite3.connect(':memory:');self.c.row_factory=sqlite3.Row
        self.c.execute('CREATE TABLE messages(id INTEGER PRIMARY KEY,role TEXT,content TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP)')
        companion.init_schema(self.c)
    def tearDown(self):self.c.close()
    def test_modes_feedback_and_quoted_words_are_distinct(self):
        self.assertEqual(companion.instruction('ただ聞いてほしい')['changes'],{'conversation_mode':'listen'})
        self.assertIsNone(companion.instruction('ただ聞いてほしい。今日は大変だった')['answer'])
        self.assertEqual(companion.instruction('アスター、一緒に考えたい')['changes']['conversation_mode'],'think')
        self.assertEqual(companion.instruction('もっと短く')['changes']['reply_style'],'short')
        self.assertEqual(companion.instruction('今は助言はいらない')['changes']['conversation_mode'],'listen')
        self.assertEqual(companion.instruction('質問は少なめで')['changes']['question_frequency'],'low')
        self.assertIsNone(companion.instruction('友達に「もっと短く」と言われた'))
    def test_memory_requests_do_not_capture_questions_about_remembering(self):
        for question in ('覚えている？','覚えてる？','覚えていた映画のタイトルは？','記憶していない？','アスター、覚えてる？','「覚えて：猫が好き」と言う方法は？'):
            self.assertIsNone(companion.memory_request(question),question)
        self.assertEqual(companion.memory_request('ASTER: 覚えて：猫が好き'),'猫が好き')
        self.assertEqual(companion.memory_request('覚えておいて、朝は短い返答が好き'),'朝は短い返答が好き')
        self.assertEqual(companion.memory_request('覚えてね、たこ焼きが好き'),'たこ焼きが好き')
        self.assertFalse(companion.personal_action_requested('日記を書いた気分について話したい'))
        self.assertTrue(companion.personal_action_requested('ASTER、目標を追加、読書を10ページ'))

    def test_profile_preferences_are_bounded_and_explicit(self):
        self.assertEqual(companion.validate_preferences({'preferred_name':'ユウ','emoji_level':'few'}),{'preferred_name':'ユウ','emoji_level':'few'})
        for values in ({'display_name':'あ'*41},{'emoji_level':'unlimited'},{'question_frequency':'spam'},{'auto_memory':True}):
            with self.assertRaises(ValueError):companion.validate_preferences(values)
        prompt=companion.persona_prompt({**companion.DEFAULTS,'conversation_mode':'listen','blocked_topics':'政治','hobbies':'映画'})
        self.assertIn('求められない解決策',prompt);self.assertIn('政治',prompt);self.assertIn('一度の返答',companion.persona_prompt({**companion.DEFAULTS,'question_frequency':'high'}))
    def test_photos_are_inline_and_remote_urls_or_wrong_signatures_are_rejected(self):
        photo='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n'+bytes(30)).decode()
        self.assertEqual(companion.validate_image(photo),photo)
        for bad in ('https://example.com/photo.jpg','data:image/svg+xml;base64,AAAA','data:image/jpeg;base64,'+base64.b64encode(b'not a photo at all').decode(),123):
            with self.assertRaises(ValueError):companion.validate_image(bad)
    def test_japanese_day_boundaries_and_user_only_diary_material(self):
        self.c.executemany('INSERT INTO messages(role,content,created) VALUES (?,?,?)',[
            ('user','前日','2026-10-24 14:59:59'),('user','今日の朝','2026-10-24 15:00:00'),('assistant','提案','2026-10-25 01:00:00'),('user','今日の夜','2026-10-25 14:59:59'),('user','翌日','2026-10-25 15:00:00')])
        self.assertEqual([m['content'] for m in companion.day_messages(self.c,'2026-10-25')],['今日の朝','今日の夜'])
        companion.save_diary(self.c,'2026-10-25','下書きを直した日記');companion.save_diary(self.c,'2026-10-25','修正後')
        self.assertEqual(self.c.execute('SELECT COUNT(*) FROM diaries').fetchone()[0],1)
        self.assertEqual(self.c.execute('SELECT content FROM diaries').fetchone()[0],'修正後')
    def test_old_conversation_is_retrieved_only_when_relevant(self):
        self.c.execute("INSERT INTO messages(role,content) VALUES ('user','映画インターステラーが気になっている')")
        self.c.execute("INSERT INTO messages(role,content) VALUES ('assistant','どんなところが気になる？')")
        for i in range(30):self.c.execute('INSERT INTO messages(role,content) VALUES (?,?)',('user' if i%2==0 else 'assistant','別の近況'+str(i)))
        context=companion.recent_context(self.c,'この前のインターステラーの話を続けたい')
        self.assertIn('インターステラー',context[0]['content']);self.assertEqual(context[1]['role'],'assistant')
        self.assertEqual(companion.recent_context(self.c,'おはよう'),[])
    def test_goal_progress_has_no_automatic_reminders(self):
        companion.edit_goal(self.c,{'title':'読書','target':10,'unit':'ページ'})
        goal=self.c.execute('SELECT * FROM goals').fetchone();companion.edit_goal(self.c,{'id':goal['id'],'increment':2})
        self.assertEqual(self.c.execute('SELECT progress FROM goals').fetchone()[0],2)
        self.assertEqual(self.c.execute('SELECT COUNT(*) FROM reminders').fetchone()[0],0)
        with self.assertRaises(ValueError):companion.edit_goal(self.c,{'id':goal['id'],'progress':-1})
        companion.edit_goal(self.c,{'id':goal['id'],'delete':True});self.assertEqual(self.c.execute('SELECT COUNT(*) FROM goals').fetchone()[0],0)
    def test_goal_and_reminder_edits_keep_existing_progress_and_pause(self):
        companion.edit_goal(self.c,{'title':'読書','target':10,'unit':'ページ'});gid=self.c.execute('SELECT id FROM goals').fetchone()[0]
        companion.edit_goal(self.c,{'id':gid,'progress':2});companion.edit_goal(self.c,{'id':gid,'title':'読書を楽しむ','target':20})
        row=self.c.execute('SELECT * FROM goals').fetchone();self.assertEqual(row['progress'],2);self.assertEqual(row['target'],20)
        with self.assertRaises(ValueError):companion.edit_goal(self.c,{'id':gid,'progress':1.5})
        companion.edit_reminder(self.c,{'title':'振り返り','schedule':'2026-10-25T20:00','repeat':'daily'});rid=self.c.execute('SELECT id FROM reminders').fetchone()[0]
        companion.edit_reminder(self.c,{'id':rid,'enabled':False});companion.edit_reminder(self.c,{'id':rid,'title':'一日の振り返り','schedule':'2026-10-25T21:00','repeat':'weekly'})
        row=self.c.execute('SELECT * FROM reminders').fetchone();self.assertEqual(row['enabled'],0);self.assertEqual(row['repeat'],'weekly');self.assertIn('21:00',row['schedule'])
    def test_reminders_deduplicate_and_catch_up_only_the_latest_repetition(self):
        companion.edit_reminder(self.c,{'title':'振り返り','schedule':'2026-10-25T20:00','repeat':'daily'});self.c.commit()
        before=datetime(2026,10,25,19,59,tzinfo=companion.JST)
        self.assertEqual(companion.due_reminders(self.c,before),[]);self.c.commit()
        now=before+timedelta(days=3,minutes=2);delivery=companion.due_reminders(self.c,now);self.c.commit()
        self.assertEqual(len(delivery),1);self.assertEqual(delivery[0]['occurrence'],'2026-10-28T20:00+09:00')
        self.assertEqual(companion.due_reminders(self.c,now),[]);self.c.commit()
        companion.edit_reminder(self.c,{'ack':delivery[0]['id']});self.assertEqual(companion.extra_state(self.c)['reminder_deliveries'],[])
    def test_one_time_and_disabled_reminders_and_delete(self):
        companion.edit_reminder(self.c,{'title':'散歩','schedule':'2026-10-25T10:00','repeat':'once'});self.c.commit()
        now=datetime(2026,10,25,12,0,tzinfo=companion.JST);delivery=companion.due_reminders(self.c,now);self.c.commit()
        self.assertEqual(len(delivery),1);rid=delivery[0]['reminder_id'];self.assertEqual(self.c.execute('SELECT enabled FROM reminders').fetchone()[0],0)
        self.assertEqual(companion.due_reminders(self.c,now+timedelta(days=1)),[]);self.c.commit()
        companion.edit_reminder(self.c,{'id':rid,'delete':True});self.assertEqual(self.c.execute('SELECT COUNT(*) FROM reminder_deliveries').fetchone()[0],0)

if __name__=='__main__':unittest.main()
