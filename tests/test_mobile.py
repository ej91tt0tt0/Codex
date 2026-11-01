"""Private mobile browser, Tailscale Serve and PWA regression checks."""
import json
import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import mobile_access

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / 'static'
HOST = 'my-laptop.example-tailnet.ts.net'
PUBLIC = 'https://' + HOST
PORT = 8000


def headers(**values):
    return {'Host': '127.0.0.1:8000', **values}


def tailnet_headers():
    return headers(**{
        'X-Forwarded-Host': HOST,
        'X-Forwarded-Proto': 'https',
        'Tailscale-User-Login': 'owner@example.com',
        'Origin': PUBLIC,
    })


class SecureMobileTests(unittest.TestCase):
    def test_local_works_without_mobile_opt_in(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(mobile_access.request_mode(headers(), PORT, '127.0.0.1'), 'local')
            self.assertIsNone(mobile_access.request_mode(tailnet_headers(), PORT, '127.0.0.1'))
            self.assertTrue(mobile_access.valid_post_origin(headers(Origin='http://127.0.0.1:8000'), 'local'))
            self.assertFalse(mobile_access.valid_post_origin(headers(Origin='https://not-us.example'), 'local'))

    def test_mobile_accepts_only_trusted_https_serve(self):
        with mock.patch.dict(os.environ, {'ASTER_MOBILE_ORIGIN': PUBLIC}):
            request = tailnet_headers()
            self.assertEqual(mobile_access.mobile_origin(), PUBLIC)
            self.assertEqual(mobile_access.request_mode(request, PORT, '127.0.0.1'), 'mobile')
            self.assertTrue(mobile_access.valid_post_origin(request, 'mobile'))
            self.assertFalse(mobile_access.valid_post_origin(headers(), 'mobile'))
            tests = [
                dict(request, **{'X-Forwarded-Proto': 'http'}),
                dict(request, **{'X-Forwarded-Host': 'attacker.ts.net'}),
                dict(request, **{'Tailscale-User-Login': ''}),
                dict(request, **{'Host': 'evil.example'}),
                dict(request, **{'Origin': 'https://evil.example'}),
            ]
            for data in tests[:4]:
                with self.subTest(data=data):
                    self.assertIsNone(mobile_access.request_mode(data, PORT, '127.0.0.1'))
            self.assertFalse(mobile_access.valid_post_origin(tests[-1], 'mobile'))
            self.assertIsNone(mobile_access.request_mode(request, PORT, '192.168.1.4'))

    def test_public_or_malformed_mobile_origins_are_rejected(self):
        for value in (
            '', 'http://' + HOST, 'https://example.com',
            'https://something.ts.net.attacker.net',
            'https://another.ts.net/path', 'https://' + HOST + ':8443',
            'https://user@' + HOST,
        ):
            with self.subTest(value=value), mock.patch.dict(os.environ, {'ASTER_MOBILE_ORIGIN': value}):
                self.assertIsNone(mobile_access.mobile_origin())

    def test_installed_tailscale_is_explicit_not_automatic(self):
        import launch
        fake = SimpleNamespace(stdout=json.dumps({
            'BackendState': 'Running',
            'Self': {'DNSName': HOST + '.'},
        }))
        with mock.patch('launch.shutil.which', return_value='/fake/tailscale'), \
             mock.patch('launch.subprocess.run', return_value=fake), \
             mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(launch.configure_mobile(), ('/fake/tailscale', PUBLIC))
            self.assertEqual(os.environ['ASTER_MOBILE_ORIGIN'], PUBLIC)
        fake_offline = SimpleNamespace(stdout=json.dumps({'BackendState': 'Stopped', 'Self': {}}))
        with mock.patch('launch.shutil.which', return_value='/fake/tailscale'), \
             mock.patch('launch.subprocess.run', return_value=fake_offline):
            with self.assertRaises(SystemExit):
                launch.configure_mobile()


class MobileWebTests(unittest.TestCase):
    def test_every_screen_loads_mobile_styles_and_manifest(self):
        for page in ('index.html','archive.html','live.html','realtime.html'):
            text = (STATIC / page).read_text(encoding='utf-8')
            with self.subTest(page=page):
                self.assertIn('href="/mobile.css"', text)
                self.assertIn('href="/manifest.webmanifest"', text)
                self.assertIn('src="/mobile.js"', text)
                self.assertIn('viewport-fit=cover', text)

    def test_app_manifest_and_worker_never_cache_conversations(self):
        manifest = json.loads((STATIC / 'manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['start_url'], '/')
        self.assertEqual(manifest['display'], 'standalone')
        self.assertEqual(manifest['short_name'], 'ASTER')
        worker = (STATIC / 'service-worker.js').read_text(encoding='utf-8')
        self.assertIn("event.respondWith(fetch(event.request))", worker)
        self.assertNotIn('cache.put', worker)
        self.assertNotIn('caches.open', worker)
        self.assertNotIn('localStorage', worker)

    def test_routes_and_packaging_include_mobile_resources(self):
        backend = (ROOT / 'server.py').read_text(encoding='utf-8')
        bundle = (ROOT / 'tools_package.py').read_text(encoding='utf-8')
        for asset in ('mobile.css','mobile.js','manifest.webmanifest','service-worker.js'):
            with self.subTest(asset=asset):
                self.assertIn("'/" + asset + "':", backend)
                self.assertIn("'static/" + asset + "'", bundle)
                self.assertTrue((STATIC / asset).is_file())
        self.assertIn("'mobile_access.py'", bundle)
        self.assertIn("'MOBILE_BROWSER.md'", bundle)
        self.assertIn('mobile_access.valid_post_origin', backend)
        self.assertIn("args.mobile else '1'", (ROOT / 'launch.py').read_text(encoding='utf-8'))

    def test_mobile_call_controls_and_safe_areas(self):
        css = (STATIC / 'mobile.css').read_text(encoding='utf-8')
        self.assertIn('safe-area-inset-bottom', css)
        self.assertIn('.home-live-mode .home-live-buttons', css)
        self.assertIn('position: fixed;', css)
        self.assertIn('.home-live-mode .home-live-captions', css)
        self.assertIn('min-height: 50px;', css)
        self.assertIn('prefers-reduced-motion', (STATIC / 'cosmos.css').read_text(encoding='utf-8'))
        installer = (STATIC / 'mobile.js').read_text(encoding='utf-8')
        self.assertIn('beforeinstallprompt', installer)
        self.assertIn('ホーム画面に追加', installer)
        self.assertIn("navigator.serviceWorker.register('/service-worker.js'", installer)


if __name__ == '__main__':
    unittest.main()
