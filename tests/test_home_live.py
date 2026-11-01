"""Offline regression checks for Live microphone integration on the ASTER home."""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"


class ElementTree(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.stack = []
        self.children = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
            self.children.append((a["id"], tuple(self.stack)))
        if tag == "script" and a.get("src"):
            self.scripts.append(a["src"])
        if tag not in {"input", "link", "meta", "img", "br", "hr", "source"}:
            self.stack.append((tag, a.get("class", "")))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return


class HomeLiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = (STATIC / "index.html").read_text(encoding="utf-8")
        cls.js = (STATIC / "live.js").read_text(encoding="utf-8")
        cls.app = (STATIC / "app.js").read_text(encoding="utf-8")
        cls.dom = ElementTree()
        cls.dom.feed(cls.page)

    def test_home_has_one_of_each_live_control(self):
        for element_id in (
            "voice-scope", "live-orb-action", "live-start", "live-stop",
            "live-mute", "live-voice", "live-auto-start", "live-status",
            "live-captions", "live-audio", "live-usage", "live-elapsed",
            "live-diagnostics", "voice-start", "voice-stop", "voice-interrupt",
        ):
            with self.subTest(element_id=element_id):
                self.assertEqual(self.dom.ids.count(element_id), 1)
        self.assertEqual(len(self.dom.ids), len(set(self.dom.ids)))

    def test_orb_is_clickable_inside_original_meter(self):
        ancestors = dict(self.dom.children)["live-orb-action"]
        self.assertIn(("div", "voice-orb"), ancestors)
        self.assertIn('id="voice-scope"', self.page)
        self.assertIn('type="button" class="live-orb-action"', self.page)
        self.assertIn('aria-label="リアルタイム音声会話を開始"', self.page)

    def test_live_and_original_audio_are_loaded_in_safe_order(self):
        self.assertIn("/scope.js", self.dom.scripts)
        self.assertIn("/app.js", self.dom.scripts)
        self.assertIn("/live.js", self.dom.scripts)
        self.assertLess(self.dom.scripts.index("/scope.js"), self.dom.scripts.index("/live.js"))
        self.assertLess(self.dom.scripts.index("/app.js"), self.dom.scripts.index("/live.js"))
        self.assertIn("window.AsterClassic", self.app)
        self.assertIn("window.AsterLiveHome", self.js)
        self.assertIn("handsfree.configure(!HOME_LIVE_DEFAULT", self.app)
        self.assertIn("if (!HOME_LIVE_DEFAULT) {", self.app)

    def test_live_meter_uses_real_microphone_with_no_output_loop(self):
        self.assertIn("createMediaStreamSource(stream)", self.js)
        self.assertIn("getByteTimeDomainData(meterWave)", self.js)
        self.assertIn("getByteFrequencyData(meterBands)", self.js)
        self.assertIn("meter.draw(level", self.js)
        self.assertNotIn("input.connect(audioContext.destination)", self.js)
        self.assertIn("for (const track of microphone.getAudioTracks()) connection.addTrack", self.js)
        self.assertIn("clearMeter();", self.js)

    def test_auto_connect_is_opt_in_and_can_be_disabled(self):
        self.assertIn("localStorage.getItem(AUTO_START_KEY) === 'true'", self.js)
        self.assertIn("if (autoStartEnabled) start();", self.js)
        self.assertIn("autoStart.addEventListener('change'", self.js)
        self.assertIn("session.close", self.js)
        self.assertIn("window.AsterLiveHome.toggle()", self.js)

    def test_home_and_static_stylesheet_are_served(self):
        backend = (ROOT / "server.py").read_text(encoding="utf-8")
        launcher = (ROOT / "launch.py").read_text(encoding="utf-8")
        self.assertIn("'/home-live.css':", backend)
        self.assertIn('href="/home-live.css"', self.page)
        self.assertIn("webbrowser.open(url)", launcher)
        self.assertNotIn("webbrowser.open(url + '/live')", launcher)

    def test_classic_voice_is_available_as_opt_in_fallback(self):
        self.assertIn('id="voice-start"', self.page)
        self.assertIn('class="classic-voice-options"', self.page)
        self.assertIn("if (HOME_LIVE_DEFAULT && window.AsterLiveHome?.isActive?.())", self.app)


if __name__ == "__main__":
    unittest.main()
