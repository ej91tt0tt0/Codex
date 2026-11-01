"""Offline checks for ASTER's original dark sci-fi visual redesign."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"


class ThemeTests(unittest.TestCase):
    def test_pages_load_shared_theme(self):
        for filename in ("index.html", "live.html", "realtime.html"):
            with self.subTest(filename=filename):
                html = (STATIC / filename).read_text(encoding="utf-8")
                self.assertIn('href="/aster-theme.css"', html)
                self.assertIn("ASTER", html)
                self.assertIn('href="/style.css"', html)
        live = (STATIC / "live.html").read_text(encoding="utf-8")
        self.assertIn('href="/live-theme.css"', live)

    def test_server_serves_stylesheets(self):
        source = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn("'/aster-theme.css':", source)
        self.assertIn("'/live-theme.css':", source)
        self.assertIn("'/home-live.css':", source)

    def test_dark_design_and_brand_preservation(self):
        css = (STATIC / "aster-theme.css").read_text(encoding="utf-8")
        icon = (STATIC / "icon.svg").read_text(encoding="utf-8")
        scope = (STATIC / "scope.js").read_text(encoding="utf-8")
        self.assertIn("color-scheme: dark;", css)
        self.assertIn("--signal-ice:", css)
        self.assertIn("@media (max-width: 600px)", css)
        self.assertIn("@media (forced-colors: active)", css)
        self.assertIn('viewBox="0 0 64 64"', icon)
        self.assertIn("#9ee9ff", icon)
        self.assertIn("マイク入力音量", scope)
        self.assertNotIn("capcom-games.com", css)

    def test_live_controls_keep_accessibility(self):
        shared = (STATIC / "aster-theme.css").read_text(encoding="utf-8")
        live = (STATIC / "live-theme.css").read_text(encoding="utf-8")
        self.assertNotIn("clip-path: polygon", shared)
        self.assertIn(".live-controls .voice-buttons", live)
        self.assertIn("position: static;", live)
        self.assertIn("prefers-reduced-motion", shared)

    def test_package_includes_live_theme(self):
        import tools_package
        files = set(tools_package.FILES)
        for name in (
            "live_proxy.py", "realtime_proxy.py", "static/live.html",
            "static/live.js", "static/realtime.html", "static/realtime.js",
            "static/aster-theme.css", "static/live-theme.css", "static/home-live.css",
        ):
            with self.subTest(name=name):
                self.assertIn(name, files)
                self.assertTrue((ROOT / name).is_file())


if __name__ == "__main__":
    unittest.main()
