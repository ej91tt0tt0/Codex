"""Regression checks for ASTER's original ASTRAL immersive motion system."""
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'
PAGES = ('index.html','live.html','realtime.html','archive.html')


class Structure(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.scripts = []
        self.styles = []
    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if props.get('id'):
            self.ids.append(props['id'])
        if tag == 'script' and props.get('src'):
            self.scripts.append(props['src'])
        if tag == 'link' and props.get('rel') == 'stylesheet':
            self.styles.append(props.get('href'))


class AstralMotionTests(unittest.TestCase):
    def test_every_screen_loads_visuals_after_existing_app(self):
        for page in PAGES:
            html = (STATIC / page).read_text(encoding='utf-8')
            dom = Structure()
            dom.feed(html)
            with self.subTest(page=page):
                self.assertEqual(dom.ids.count('aster-intro'), int(page == 'index.html'))
                self.assertIn('/astral.css', dom.styles)
                self.assertIn('/astral.js', dom.scripts)
                self.assertLess(dom.styles.index('/mobile.css'),dom.styles.index('/astral.css'))
                self.assertLess(dom.scripts.index('/mobile.js'),dom.scripts.index('/astral.js'))
                self.assertIn('class="cosmos-background"',html)
                self.assertEqual(len(set(dom.ids)),len(dom.ids))

    def test_visuals_are_decorative_and_do_not_forge_microphone_activity(self):
        js = (STATIC / 'astral.js').read_text(encoding='utf-8')
        self.assertIn("const meterLevel = Number(orb?.querySelector('canvas')?.dataset.level || 0)",js)
        self.assertIn("document.body.classList.contains('home-live-active')",js)
        self.assertIn("requestAnimationFrame(paint)",js)
        self.assertIn("cancelAnimationFrame(frame)",js)
        self.assertIn('document.hidden',js)
        self.assertIn('event.target.closest?.',js)
        self.assertIn('aria-hidden',js)
        self.assertIn("control.matches('[data-tab]')",js)
        self.assertNotIn('getUserMedia',js)
        self.assertNotIn('fetch(',js)
        self.assertNotIn('innerHTML',js)
        self.assertNotIn('AudioContext',js)

    def test_strong_space_motion_and_accessibility_fallback(self):
        css = (STATIC / 'astral.css').read_text(encoding='utf-8')
        for token in (
            '.astral-starfield','.astral-nebula','.astral-orbit-grid',
            '.astral-atmosphere','.astral-telemetry','.astral-panel-enter',
            '.astral-reactor','.astral-arc','.astral-stage-banner',
            'astral-click-wave','astral-grid-flow',
            'prefers-reduced-motion: reduce','forced-colors: active',
            'pointer-events: none','safe-area',
        ):
            with self.subTest(token=token):
                self.assertTrue(token in css or token in (STATIC / 'mobile.css').read_text(encoding='utf-8'))
        self.assertIn('isReduced()', (STATIC / 'astral.js').read_text(encoding='utf-8'))
        self.assertIn('document.hidden', (STATIC / 'astral.js').read_text(encoding='utf-8'))

    def test_starfield_is_bounded_for_mobile(self):
        js = (STATIC / 'astral.js').read_text(encoding='utf-8')
        self.assertIn("mobile ? 95 : 155",js)
        self.assertIn("Math.min(window.devicePixelRatio || 1, 1.6)",js)
        self.assertIn("width < 768 ? 32 : 25",js)
        self.assertIn("context.clearRect(0,0,width,height)",js)
        self.assertIn("reduced?.addEventListener?.('change',onMotion)",js)
        self.assertIn('visibilitychange',js)

    def test_server_and_zip_include_assets(self):
        server = (ROOT / 'server.py').read_text(encoding='utf-8')
        bundle = (ROOT / 'tools_package.py').read_text(encoding='utf-8')
        for asset in ('astral.css','astral.js'):
            self.assertIn("'/" + asset + "':",server)
            self.assertIn("'static/" + asset + "'",bundle)
            self.assertTrue((STATIC / asset).is_file())
        self.assertIn("APP_VERSION = '1.8.0'",server)
        self.assertIn('ASTER 1.8',(STATIC / 'index.html').read_text(encoding='utf-8'))

    def test_all_existing_live_and_pwa_entry_points_remain(self):
        home = (STATIC / 'index.html').read_text(encoding='utf-8')
        for value in (
            'id="live-orb-action"', 'id="live-captions"', 'id="live-mute"',
            'id="live-stop"', 'id="home-advanced"', 'id="conversation-history"',
            'id="mobile-install"', 'id="chat-form"', 'id="voice-scope"',
        ):
            with self.subTest(value=value): self.assertIn(value,home)
        self.assertIn('href="/manifest.webmanifest"',home)
        self.assertIn('id="archive-transcript"',(STATIC / 'archive.html').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
