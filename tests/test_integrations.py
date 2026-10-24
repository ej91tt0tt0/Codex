import unittest
from urllib.parse import urlsplit,parse_qs
from integrations import driving_url,parse_maps_command,validate_maps_url,parse_destination_reply

class MapsIntegration(unittest.TestCase):
    def test_car_route_and_current_location(self):
        p=parse_qs(urlsplit(driving_url('名古屋駅','現在地')).query)
        self.assertEqual(p['travelmode'],['driving']);self.assertEqual(p['dir_action'],['navigate'])
        self.assertEqual(p['destination'],['名古屋駅']);self.assertNotIn('origin',p)
    def test_explicit_origin_and_encoded_destination(self):
        url=driving_url('名古屋駅 & 正面口','碧南駅')
        p=parse_qs(urlsplit(url).query);self.assertEqual(p['origin'],['碧南駅']);self.assertEqual(p['destination'],['名古屋駅 & 正面口']);self.assertTrue(validate_maps_url(url))
    def test_voice_requests(self):
        self.assertEqual(parse_maps_command('車で碧南駅から名古屋駅までナビして。'),{'kind':'driving','origin':'碧南駅','destination':'名古屋駅'})
        self.assertEqual(parse_maps_command('Googleマップで名古屋駅までナビして')['destination'],'名古屋駅')
        self.assertEqual(parse_maps_command('車でからあげ店まで案内して')['destination'],'からあげ店')
        self.assertEqual(parse_maps_command('Googleマップを開いて'),{'kind':'home'})
    def test_no_launch_for_information_negation_or_unsupported_mode(self):
        for text in ('車で名古屋駅までナビしないで','Googleマップの開き方を教えて','「車で名古屋駅までナビして」と言った','電車で名古屋駅まで案内して'):
            self.assertIsNone(parse_maps_command(text),text)
        self.assertEqual(parse_maps_command('車のナビを開いて'),{'kind':'needs_destination'})
    def test_application_allowlist(self):
        for url in ('javascript:alert(1)','https://evil.example/maps/','https://www.google.com.evil.example/maps/','https://www.google.com@evil.example/maps/','file:///C:/Windows/notepad.exe','https://www.google.com/search?q=x'):
            self.assertFalse(validate_maps_url(url),url)
        self.assertTrue(validate_maps_url('https://www.google.com/maps/'))
        self.assertEqual(urlsplit(driving_url('https://evil.example/')).hostname,'www.google.com')
        with self.assertRaises(ValueError):driving_url('')
        with self.assertRaises(ValueError):driving_url('駅\nコマンド')
        with self.assertRaises(ValueError):driving_url('駅'*200,'市'*200)

    def test_destination_followup_is_explicit_or_a_place_not_an_unrelated_turn(self):
        self.assertEqual(parse_destination_reply('目的地は名古屋駅です。'),'名古屋駅')
        self.assertEqual(parse_destination_reply('名古屋駅'),'名古屋駅')
        self.assertIsNone(parse_destination_reply('ありがとう'))
        self.assertIsNone(parse_destination_reply('今日のニュースを教えて'))
