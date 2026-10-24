import unittest
from preferences import parse_command

class Commands(unittest.TestCase):
    def test_no_changes_without_explicit_prefix(self):
        self.assertIsNone(parse_command('返答を短くする設定変更って何？'))
        self.assertIsNone(parse_command('声を速くするのは好きじゃない'))
    def test_supported_voice_preferences(self):
        self.assertEqual(parse_command('設定変更、声をゆっくりにして')['changes'],{'speech_speed':'1.0'})
        self.assertEqual(parse_command('設定変更、敬語は使わないで')['changes'],{'speech_register':'casual'})
        self.assertEqual(parse_command('システム設定、敬語にして')['changes'],{'speech_register':'polite'})
    def test_interval_is_bounded_and_normalized(self):
        self.assertEqual(parse_command('設定変更、声かけを３分にして')['changes']['proactive_interval'],'180')
        self.assertEqual(parse_command('設定変更、声かけを15分にして')['kind'],'help')
    def test_freeform_rule_is_data_and_can_be_cleared(self):
        self.assertEqual(parse_command('設定変更、会話ルール、質問を毎回付けないで')['changes'],{'custom_preferences':'質問を毎回付けないで'})
        self.assertEqual(parse_command('設定変更、会話ルールを消して')['changes'],{'custom_preferences':''})
    def test_unknown_command_never_creates_executable_actions(self):
        self.assertEqual(parse_command('設定変更、端末でコマンドを実行して')['kind'],'help')
        r=parse_command('改善リクエスト、音声認識をさらに改善して')
        self.assertEqual(r,{'kind':'request','content':'音声認識をさらに改善して'})
