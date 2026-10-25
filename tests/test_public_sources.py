import json
import unittest
from unittest.mock import patch
import public_sources
import research


class PublicSourceTests(unittest.TestCase):
    def test_news_uses_a_fixed_feed_and_preserves_scope_dates_and_safe_links(self):
        xml=b'''<rss><channel><item><title>Example</title><link>https://example.com/news</link><description>&lt;p&gt;Summary&lt;/p&gt;&lt;script&gt;ignored&lt;/script&gt;</description><pubDate>Sun, 25 Oct 2026 02:00:00 GMT</pubDate><source>Publisher</source></item><item><title>Invalid</title><link>javascript:alert(1)</link></item><item><title>Duplicate</title><link>https://example.com/news</link></item></channel></rss>'''
        with patch.object(public_sources,'get',return_value=xml) as fetch:
            result,sources=public_sources.news('名鉄三河線 運行','day')
        self.assertEqual(len(result['items']),1)
        self.assertEqual(result['items'][0]['summary'],'Summary')
        self.assertEqual(sources[0]['published_at'],'2026-10-25T02:00:00+00:00')
        self.assertEqual(sources[0]['method'],'public_news')
        self.assertIn('本文',result['coverage'])
        parsed=public_sources.urllib.parse.urlsplit(fetch.call_args.args[0])
        self.assertEqual(parsed.hostname,'news.google.com')
        self.assertIn('when:1d',public_sources.urllib.parse.parse_qs(parsed.query)['q'][0])

    def test_news_results_are_bounded_and_model_urls_are_not_fetch_targets(self):
        xml=('<rss><channel>'+''.join('<item><title>News</title><link>https://example.com/'+str(i)+'</link></item>' for i in range(20))+'</channel></rss>').encode()
        with patch.object(public_sources,'get',return_value=xml) as fetch:
            result,sources=public_sources.news('https://127.0.0.1/private','any')
        self.assertEqual(len(sources),6)
        self.assertTrue(fetch.call_args.args[0].startswith('https://news.google.com/rss/search?'))
        self.assertIsNone(result['items'][0]['published_at'])
        with patch.object(public_sources,'get') as fetch:
            for name,args in [('fetch_arbitrary_url',{'url':'http://127.0.0.1/'}),('lookup_aichi_forecast',{'url':'http://127.0.0.1/'}),('lookup_public_news',{'query':'news'})]:
                with self.assertRaises(ValueError):public_sources.execute(name,args)
            fetch.assert_not_called()

    def test_forecast_is_the_published_broad_area_forecast_not_current_weather(self):
        data=[{'reportDatetime':'2026-10-25T11:00:00+09:00','timeSeries':[{'timeDefines':['2026-10-25T11:00:00+09:00'],'areas':[{'area':{'code':'230010'},'weathers':['晴れ']}]}]}]
        with patch.object(public_sources,'get',return_value=json.dumps(data).encode()) as fetch:
            result,sources=public_sources.execute('lookup_aichi_forecast',{})
        self.assertEqual(fetch.call_args.args[0],public_sources.WEATHER_URL)
        self.assertEqual(result['area'],'愛知県西部');self.assertIn('実況ではない',result['coverage'])
        self.assertEqual(sources[0]['method'],'jma_forecast')
        self.assertEqual(result['days'][0]['weather'],'晴れ')

    def test_compatibility_research_requires_real_tool_results_and_links(self):
        tool={'id':'call_test','type':'function','function':{'name':'lookup_aichi_forecast','arguments':'{}'}}
        source={'url':'https://www.jma.go.jp/bosai/forecast/','title':'気象庁','method':'jma_forecast','cited':False}
        messages=[{'role':'user','content':'天気を調べて'}]
        with patch.object(research,'chat_completion',side_effect=[{'content':None,'tool_calls':[tool]},{'content':'愛知県西部の予報では晴れ。実況は未確認。'}]) as model,patch.object(public_sources,'execute',return_value=({'days':['晴れ']},[source])) as fetch:
            answer=research.legacy_reply(messages,'not-a-key',500,search=True,require_search=True)
        self.assertEqual(answer.searches,1);self.assertEqual(answer.sources,[source])
        self.assertEqual(answer.provider,'chat_completions_public_sources')
        self.assertEqual(model.call_count,2);fetch.assert_called_once_with('lookup_aichi_forecast',{})
        self.assertIs(model.call_args_list[0].kwargs['required'],True)
        self.assertTrue(any(m['role']=='tool' for m in model.call_args.args[0]))
        self.assertIn('未確認',str(answer))

    def test_text_only_models_keep_conversation_available_without_fake_research(self):
        error=research.urllib.error.HTTPError('https://api.openai.com',400,'unsupported',{},None)
        with patch.object(research,'chat_completion',side_effect=[error,{'content':'最新の状況は未確認だよ。'}]) as model,patch.object(public_sources,'execute') as fetch:
            answer=research.legacy_reply([{'role':'user','content':'こんにちは'}],'key',500,search=True)
        self.assertEqual(answer.searches,0);self.assertEqual(answer.sources,[]);self.assertEqual(model.call_count,2)
        self.assertIn('検索していない',model.call_args.args[0][1]['content']);fetch.assert_not_called()
        with patch.object(research,'chat_completion',side_effect=error) as model:
            with self.assertRaises(research.urllib.error.HTTPError):research.legacy_reply([{'role':'user','content':'必須の調査'}],'key',500,search=True,require_search=True)
            self.assertEqual(model.call_count,1)

    def test_no_search_or_failed_lookup_is_never_successful_research(self):
        with patch.object(research,'chat_completion',return_value={'content':'調べたふりの返答'}):
            with self.assertRaises(research.ResearchError):research.legacy_reply([{'role':'user','content':'検索'}],'key',500,search=True,require_search=True)
        call={'id':'call_fail','type':'function','function':{'name':'lookup_public_news','arguments':'{"query":"news","freshness":"day"}'}}
        with patch.object(research,'chat_completion',return_value={'content':None,'tool_calls':[call]}) as model,patch.object(public_sources,'execute',side_effect=OSError('not disclosed secret')):
            with self.assertRaises(research.ResearchError) as error:research.legacy_reply([{'role':'user','content':'検索'}],'key',500,search=True,require_search=True)
            self.assertNotIn('secret',str(error.exception));self.assertEqual(model.call_count,1)

    def test_public_retrieval_budget_is_two_even_if_model_requests_more(self):
        calls=[{'id':'call_'+str(i),'type':'function','function':{'name':'lookup_aichi_forecast','arguments':'{}'}} for i in range(4)]
        with patch.object(research,'chat_completion',side_effect=[{'content':None,'tool_calls':calls},{'content':'取得できた予報だけを答える。'}]) as model,patch.object(public_sources,'execute',return_value=({'forecast':'晴れ'},[{'url':'https://example.com','title':'source','method':'jma_forecast'}])) as fetch:
            answer=research.legacy_reply([{'role':'user','content':'検索'}],'key',500,search=True,require_search=True)
        self.assertEqual(fetch.call_count,2);self.assertEqual(answer.searches,2);self.assertEqual(len(answer.sources),1)
        self.assertEqual(model.call_count,2)


if __name__=='__main__':unittest.main()
