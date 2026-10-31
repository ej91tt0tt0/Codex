"""Tests for the optional Realtime WebRTC negotiation proxy."""
import io
import os
import unittest
from unittest import mock
from urllib.error import HTTPError

import realtime_proxy


OFFER = b"v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"
ANSWER = b"v=0\r\no=- 9 8 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n"


class MockResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _):
        return ANSWER


class RealtimeProxyTests(unittest.TestCase):
    def test_does_not_contact_network_for_invalid_sdp(self):
        with mock.patch("realtime_proxy.urllib.request.urlopen") as urlopen:
            with self.assertRaises(ValueError):
                realtime_proxy.create_realtime_call(b"not sdp")
            urlopen.assert_not_called()

    def test_missing_key_has_helpful_error(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(realtime_proxy.RealtimeCallError, "APIキー"):
                realtime_proxy.create_realtime_call(OFFER)

    def test_sends_key_only_to_fixed_openai_endpoint(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-unit-test", "OPENAI_REALTIME_MODEL": "gpt-realtime-2.1-mini"}, clear=True):
            with mock.patch("realtime_proxy.urllib.request.urlopen", return_value=MockResponse()) as urlopen:
                answer = realtime_proxy.create_realtime_call(OFFER)
            self.assertEqual(answer, ANSWER)
            request = urlopen.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.openai.com/v1/realtime/calls")
            self.assertEqual(request.get_header("Authorization"), "Bearer sk-unit-test")
            self.assertIn(OFFER, request.data)
            self.assertIn(b"gpt-realtime-2.1-mini", request.data)
            self.assertNotIn(b"sk-unit-test", request.data)
            self.assertNotIn(b"memory", request.data.lower())
            self.assertIn(b'"language": "ja"', request.data)
            self.assertIn(b'"noise_reduction"', request.data)
            self.assertIn(b'"interrupt_response": true', request.data)
            self.assertIn(b'"silence_duration_ms": 650', request.data)

    def test_unauthorized_uses_safe_message(self):
        error = HTTPError(realtime_proxy.ENDPOINT, 401, "Unauthorized", {}, io.BytesIO(b"secret"))
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-unit-test"}, clear=True):
            with mock.patch("realtime_proxy.urllib.request.urlopen", side_effect=error):
                with self.assertRaisesRegex(realtime_proxy.RealtimeCallError, "APIキー"):
                    realtime_proxy.create_realtime_call(OFFER)

    def test_does_not_allow_oversized_offers(self):
        with self.assertRaises(ValueError):
            realtime_proxy.create_realtime_call(b"v=0\r\n" + b"A" * realtime_proxy.MAX_OFFER_BYTES)


if __name__ == "__main__":
    unittest.main()
