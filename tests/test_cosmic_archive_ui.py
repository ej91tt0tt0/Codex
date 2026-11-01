"""Offline checks for animated cosmos and the dedicated archive interface."""
import unittest
from html.parser import HTMLParser
from pathlib import Path

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
        ident = attrs.get('id')
        if ident:
            self.ids.append(ident)
            self.ancestors[ident] = list(self.stack)
        if tag not in {'input','meta','link','img','source','br','hr','area'}:
            self.stack.append((tag, ident))
    def handle_endtag(self, tag):
        for j in range(len(self.stack) - 1, -1, -1):
            if self.stack[j][0] == tag:
                del self.stack[j:]
                break


class CosmicArchiveUITests(unittest.TestCase):
    def test_home_caption_log_is_not_inside_a_hidden_details(self):
        home = (STATIC / 'index.html').read_text(encoding='utf-8')
        parser = Structure()
        parser.feed(home)
        self.assertIn('live-captions', parser.ids)
        self.assertNotIn(('details','home-advanced'), parser.ancestors['live-captions'])
        self.assertIn('archive-save-status', parser.ids)
        self.assertIn('href="/archive"', home)
        self.assertEqual(len(parser.ids), len(set(parser.ids)))
        self.assertIn('href="/cosmos.css"', home)

    def test_moving_stars_and_real_3d_orb_are_accessible(self):
        home = (STATIC / 'index.html').read_text(encoding='utf-8')
        cosmic = (STATIC / 'cosmos.css').read_text(encoding='utf-8')
        for star in ('stars-distant','stars-middle','stars-near'):
            self.assertIn(star, home)
            self.assertIn(star, cosmic)
        for ring in ('orb-gyro-a','orb-gyro-b','orb-gyro-c'):
            self.assertIn(ring, home)
            self.assertIn(ring, cosmic)
        self.assertIn('rotateX(69deg)', cosmic)
        self.assertIn('rotateY(72deg)', cosmic)
        self.assertIn('prefers-reduced-motion: reduce', cosmic)
        self.assertIn('aria-hidden="true"', home)
        self.assertIn('id="live-orb-action"', home)

    def test_archive_page_has_summary_topics_and_full_transcript(self):
        page = (STATIC / 'archive.html').read_text(encoding='utf-8')
        for value in (
            'id="archive-summary"', 'id="archive-topics"',
            'id="archive-transcript"', 'id="archive-copy"',
            'id="archive-delete"', 'id="archive-list"',
            'id="archive-detail-date"',
        ):
            self.assertIn(value, page)
        self.assertIn('href="/cosmos.css"', page)
        script = (STATIC / 'archive.js').read_text(encoding='utf-8')
        self.assertIn("textContent", script)
        self.assertNotIn("innerHTML", script)
        self.assertIn("encodeURIComponent(id)", script)
        self.assertIn("confirm(", script)

    def test_end_of_call_persists_and_retry_is_available(self):
        source = (STATIC / 'live.js').read_text(encoding='utf-8')
        self.assertIn("case 'session.closed':", source)
        self.assertIn("publishArchive(false)", source)
        self.assertIn("publishArchive(true)", source)
        self.assertIn("postArchive(payload)", source)
        self.assertIn("retryNotice(payload)", source)
        self.assertIn("caption('ASTER'", source)
        self.assertIn("caption('あなた'", source)
        self.assertNotIn("while (captions.children.length > 60)", source)

    def test_server_and_zip_include_new_resources(self):
        backend = (ROOT / 'server.py').read_text(encoding='utf-8')
        bundle = (ROOT / 'tools_package.py').read_text(encoding='utf-8')
        for asset in ('archive.html','archive.js','archive.css','cosmos.css'):
            self.assertIn('static/' + asset, bundle)
            self.assertTrue((STATIC / asset).is_file())
        self.assertIn("'live_archive.py'", bundle)
        for route in ("'/archive':","'/archive.js':","'/archive.css':","'/cosmos.css':"):
            self.assertIn(route, backend)
        self.assertIn("'/api/live/archives'", backend)
        self.assertIn("'/api/live/archive'", backend)
        self.assertIn('live_archive.init_schema(c)', backend)


if __name__ == '__main__':
    unittest.main()
