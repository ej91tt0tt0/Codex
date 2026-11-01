"""Offline regression coverage for ASTER cinematic launch and minimal interface."""
import unittest
from pathlib import Path
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"


class Structure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.ancestors = {}
        self.ids = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        ident = attrs.get("id")
        if ident:
            self.ids.append(ident)
            self.ancestors[ident] = list(self.stack) + [(tag, ident)]
        if tag not in {"input","meta","link","img","source","hr","br","wbr","area"}:
            self.stack.append((tag, ident))
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                return


class CinematicUITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.home = (STATIC / "index.html").read_text(encoding="utf-8")
        cls.cinema = (STATIC / "cinematic.js").read_text(encoding="utf-8")
        cls.style = (STATIC / "cinematic.css").read_text(encoding="utf-8")
        cls.live = (STATIC / "live.js").read_text(encoding="utf-8")
        cls.dom = Structure()
        cls.dom.feed(cls.home)

    def test_minimal_home_preserves_features(self):
        for control in (
            "aster-intro","intro-skip","voice-scope","live-orb-action",
            "home-advanced","home-extra-panel","interface-sounds",
            "live-start","live-mute","live-stop","voice-start",
            "live-captions","live-audio","conversation-mode",
            "interaction-mode","text-input","conversation-history",
        ):
            with self.subTest(control=control):
                self.assertEqual(self.dom.ids.count(control),1)
        self.assertEqual(len(set(self.dom.ids)),len(self.dom.ids))
        self.assertIn('id="home-advanced"', self.home)
        self.assertIn("設定・字幕・詳細情報", self.home)
        self.assertIn("文字入力・会話履歴", self.home)
        self.assertIn("home-live-mode .home-live-buttons", self.style)
        # Hidden details must contain settings, but stop/mute must remain reachable.
        self.assertNotIn(("details", "home-advanced"), self.dom.ancestors["live-captions"])
        self.assertIn(("details", "home-advanced"), self.dom.ancestors["conversation-mode"])
        self.assertIn(("details", "home-extra-panel"), self.dom.ancestors["text-input"])
        self.assertNotIn(("details", "home-advanced"), self.dom.ancestors["live-stop"])
        self.assertNotIn(("details", "home-advanced"), self.dom.ancestors["live-mute"])

    def test_cinematic_is_skippable_reduced_motion_and_plays_once_per_tab(self):
        self.assertIn('id="aster-intro"', self.home)
        self.assertIn("aria-modal=\"true\"", self.home)
        self.assertIn("sessionStorage.getItem(INTRO_KEY)", self.cinema)
        self.assertIn("sessionStorage.setItem(INTRO_KEY, 'true')", self.cinema)
        self.assertIn("timer = setTimeout(finish, 2400)", self.cinema)
        self.assertIn("event.key === 'Escape'", self.cinema)
        self.assertIn("prefers-reduced-motion: reduce", self.style)
        self.assertIn("prefers-reduced-motion: reduce", self.cinema)

    def test_generated_sfx_is_mutable_and_no_external_files(self):
        self.assertIn("context.createOscillator()",self.cinema)
        self.assertIn("context.createGain()",self.cinema)
        self.assertIn("localStorage.setItem(SOUND_KEY",self.cinema)
        self.assertIn("soundToggle.checked",self.cinema)
        self.assertIn("document.addEventListener('click'",self.cinema)
        self.assertNotIn("fetch(",self.cinema)
        self.assertNotIn("new Audio(",self.cinema)
        self.assertIn("home-live-active",self.cinema)

    def test_boot_auto_connect_waits_for_intro_completion(self):
        self.assertIn("aster:boot-complete",self.cinema)
        self.assertIn("aster:boot-complete",self.live)
        self.assertIn("if (autoStartEnabled)",self.live)
        self.assertIn("void start();",self.live)
        self.assertIn("if (isHome && $('home-advanced'))",self.live)

    def test_routes_and_windows_package_include_new_assets(self):
        backend = (ROOT / "server.py").read_text(encoding="utf-8")
        package = (ROOT / "tools_package.py").read_text(encoding="utf-8")
        for asset in ("cinematic.js","cinematic.css"):
            with self.subTest(asset=asset):
                self.assertIn(f"'/{asset}':", backend)
                self.assertIn(f"static/{asset}", package)
                self.assertTrue((STATIC / asset).is_file())
        self.assertIn('href="/cinematic.css"',self.home)
        self.assertIn('src="/cinematic.js"',self.home)
        for page in ("live.html","realtime.html"):
            self.assertIn(
                'src="/cinematic.js"',
                (STATIC / page).read_text(encoding="utf-8"),
            )

if __name__ == "__main__":
    unittest.main()
