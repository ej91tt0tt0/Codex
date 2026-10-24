import json
import os
import unittest
import urllib.error
from unittest.mock import patch
import research


def result(text='調査結果', searched=True):
    output = [{'type': 'message', 'content': [{'type': 'output_text', 'text': text + ('\ue200cite\ue202turn0search0\ue201' if searched else ''),
               'annotations': [{'type': 'url_citation', 'title': '公式発表', 'url': 'https://example.com/info'}] if searched else []}]}]
    if searched:
        output.insert(0, {'type': 'web_search_call', 'status': 'completed', 'action': {'sources': [
            {'type': 'url', 'title': '公式発表', 'url': 'https://example.com/info'},
            {'type': 'url', 'title': '悪いリンク', 'url': 'javascript:alert(1)'}]}})
    return {'status': 'completed', 'output': output}


class ResearchTests(unittest.TestCase):
    def test_sources_deduplicated_citations_preserved_and_markup_not_spoken(self):
        answer = research.parse_response(result())
        self.assertEqual(answer, '調査結果')
        self.assertEqual(answer.searches, 1)
        self.assertEqual(answer.sources, [{'url': 'https://example.com/info', 'title': '公式発表', 'cited': True}])
        self.assertTrue(answer.fetched_at)

    def test_partial_failed_and_uncited_searches_not_presented_as_verified(self):
        data = result()
        data['status'] = 'incomplete'
        with self.assertRaises(research.ResearchError): research.parse_response(data)
        data = result();data['output'][0]['status'] = 'failed'
        with self.assertRaises(research.ResearchError): research.parse_response(data)
        data = result();data['output'][0]['action']['sources'] = [];data['output'][1]['content'][0]['annotations'] = []
        with self.assertRaises(research.ResearchError): research.parse_response(data)
        with self.assertRaises(research.ResearchError): research.parse_response(result(searched=False), require_search=True)
        self.assertEqual(research.parse_response(result('こんにちは', False)), 'こんにちは')

    def test_source_protocols_and_credentials_rejected(self):
        for url in ('file:///etc/passwd', 'data:text/plain,x', 'javascript:alert(1)', 'https://user:secret@example.com/', None, 'https://[invalid'):
            self.assertIsNone(research.safe_source({'url': url}))

    def test_hosted_search_request_bounded_and_can_be_disabled(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return json.dumps(result()).encode()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test', 'ASSISTANT_API_KEY': ''}), patch.object(research.urllib.request, 'urlopen', return_value=Response()) as call:
            research.respond([{'role': 'user', 'content': '調べて'}], require_search=True)
            request = call.call_args.args[0];payload = json.loads(request.data)
            self.assertEqual(request.full_url, 'https://api.openai.com/v1/responses')
            self.assertEqual(payload['tools'][0]['type'], 'web_search')
            self.assertEqual(payload['max_tool_calls'], 2)
            self.assertEqual(payload['tool_choice'], 'required')
            self.assertFalse(payload['store'])
            self.assertIn('web_search_call.action.sources', payload['include'])
            research.respond([], search=False)
            self.assertNotIn('tools', json.loads(call.call_args.args[0].data))

    def test_api_errors_are_useful_and_never_echo_secrets(self):
        for code, expected in ((401, '認証'), (429, '利用枠'), (500, '接続')):
            with patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-secret', 'ASSISTANT_API_KEY': ''}), patch.object(research.urllib.request, 'urlopen', side_effect=urllib.error.HTTPError('https://api.openai.com', code, 'unit-secret', {}, None)):
                with self.assertRaises(research.ResearchError) as error: research.respond([])
                self.assertIn(expected, str(error.exception))
                self.assertNotIn('unit-secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()
