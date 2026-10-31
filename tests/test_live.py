"""Offline tests for ASTER's isolated GPT-Live WebRTC negotiation."""
import io
import json
import os
import unittest
from unittest import mock
from urllib.error import HTTPError

import live_proxy

OFFER = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n"
ANSWER = "v=0\r\no=- 9 8 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
RESPONSE = {"session": {"id": "live_test_123"}, "transport": {"type": "webrtc", "sdp": ANSWER}}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _):
        return self.payload


class LiveProxyTests(unittest.TestCase):
    def test_invalid_offer_never_hits_network(self):
        with mock.patch("live_proxy.urllib.request.urlopen") as request:
            with self.assertRaises(ValueError):
                live_proxy.create_live_session("not an SDP")
            request.assert_not_called()

    def test_unsupported_voice_never_hits_network(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret"}, clear=True):
            with mock.patch("live_proxy.urllib.request.urlopen") as request:
                with self.assertRaises(ValueError):
                    live_proxy.create_live_session(OFFER, "any-random-voice")
                request.assert_not_called()

    def test_missing_api_key_is_actionable(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(live_proxy.LiveCallError, "APIキー"):
                live_proxy.create_live_session(OFFER)

    def test_valid_session_uses_live_endpoint_and_server_only_secret(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret"}, clear=True):
            mock_reply = FakeResponse(json.dumps(RESPONSE).encode())
            with mock.patch("live_proxy.urllib.request.urlopen", return_value=mock_reply) as send:
                result = live_proxy.create_live_session(OFFER, "shida")
            self.assertEqual(result, RESPONSE)
            request = send.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.openai.com/v1/live/sessions")
            self.assertEqual(request.get_header("Authorization"), "Bearer test-secret")
            self.assertEqual(request.get_header("Content-type"), "application/json")
            sent = json.loads(request.data)
            self.assertNotIn(b"test-secret", request.data)
            self.assertEqual(sent["session"]["model"], "gpt-live-1")
            self.assertEqual(sent["session"]["audio"]["output"]["voice"], "shida")
            self.assertIs(sent["session"]["store"], False)
            self.assertEqual(sent["session"]["delegation"]["type"], "responses")
            self.assertEqual(sent["session"]["delegation"]["responses"]["tools"], [{"type": "web_search"}])
            self.assertEqual(sent["transport"], {"type": "webrtc", "sdp": OFFER})
            self.assertIn("Interruption policy:", sent["session"]["instructions"])

    def test_unauthorized_returns_nonsecret_error(self):
        error = HTTPError(live_proxy.ENDPOINT, 401, "Unauthorized", {}, io.BytesIO(b"secret"))
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret"}, clear=True):
            with mock.patch("live_proxy.urllib.request.urlopen", side_effect=error):
                with self.assertRaisesRegex(live_proxy.LiveCallError, "利用権限"):
                    live_proxy.create_live_session(OFFER)

    def test_rejects_malformed_api_response(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "test-secret"}, clear=True):
            with mock.patch("live_proxy.urllib.request.urlopen", return_value=FakeResponse(b'{"transport":{}}')):
                with self.assertRaisesRegex(live_proxy.LiveCallError, "接続情報"):
                    live_proxy.create_live_session(OFFER)

    def test_rejects_oversized_offer(self):
        with mock.patch("live_proxy.urllib.request.urlopen") as request:
            with self.assertRaises(ValueError):
                live_proxy.create_live_session("v=0\r\n" + "x" * live_proxy.MAX_OFFER_BYTES)
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
