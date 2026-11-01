"""Regression checks for ASTER 1.8.2 centred reactor, edge-docked log and dedicated menu screens."""
import unittest
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'static' / 'index.html'
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'}


class LayoutDOM(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack = []
        self.tags = {}
        self.counts = Counter()
        self.menu_tabs = []
        self.bad_closes = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        identifier = values.get('id')
        if identifier:
            self.counts[identifier] += 1
            self.tags[identifier] = {
                'tag': tag,
                'parent_ids': [p[1] for p in self.stack if p[1]],
                'parent_classes': [name for p in self.stack for name in p[2]],
                'attrs': values,
            }
        if values.get('data-tab'):
            self.menu_tabs.append((values['data-tab'], tuple(p[1] for p in self.stack if p[1])))
        if tag not in VOID:
            self.stack.append((tag, identifier, values.get('class', '').split()))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1][0] == tag:
            self.stack.pop()
        else:
            self.bad_closes.append((tag, self.stack[-1][0] if self.stack else None))
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    break


class CockpitLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HOME.read_text(encoding='utf-8')
        cls.dom = LayoutDOM()
        cls.dom.feed(cls.html)

    def test_home_and_menu_workspaces_have_single_owner(self):
        dom = self.dom
        for identifier, owner in (
            ('live-orb-action','chat'),
            ('live-captions','chat'),
            ('archive-save-status','chat'),
            ('live-start','chat'),
            ('live-mute','chat'),
            ('live-stop','chat'),
            ('home-advanced','voice-settings'),
            ('live-audio','voice-settings'),
            ('live-diagnostics','voice-settings'),
            ('interaction-mode','voice-settings'),
            ('temporary-chat','voice-settings'),
            ('home-extra-panel','text-workspace'),
            ('chat-form','text-workspace'),
            ('message','text-workspace'),
            ('photo-input','text-workspace'),
            ('conversation-history','text-workspace'),
            ('text-workspace-to-voice','text-workspace'),
        ):
            with self.subTest(identifier=identifier):
                self.assertEqual(dom.counts[identifier], 1)
                self.assertIn(owner, dom.tags[identifier]['parent_ids'])

    def test_transcript_is_a_sibling_sidebar_not_under_voice_orb(self):
        captions = self.dom.tags['live-captions']
        self.assertIn('home-conversation-sidebar', captions['parent_classes'])
        self.assertNotIn('voice-card', captions['parent_classes'])
        self.assertEqual(captions['attrs']['role'],'log')
        self.assertIn('home-cockpit', self.dom.tags['live-orb-action']['parent_classes'])
        self.assertEqual(self.dom.counts['home-advanced'],1)
        self.assertEqual(self.dom.counts['home-extra-panel'],1)
        self.assertEqual(self.dom.bad_closes, [])
        self.assertEqual(self.dom.stack, [])

    def test_both_new_menu_entries_target_existing_independent_screens(self):
        for tab in ('voice-settings','text-workspace'):
            with self.subTest(tab=tab):
                self.assertEqual(self.dom.counts[tab], 1)
                self.assertIn((tab,('tools',)),self.dom.menu_tabs)
                self.assertIn('hidden',self.dom.tags[tab]['attrs'])

    def test_vertical_log_and_mobile_stack_overrides_existing_short_log(self):
        css = (ROOT / 'static' / 'astral.css').read_text(encoding='utf-8')
        for rule in (
            '#chat .home-cockpit',
            'display: flex;',
            '#chat .home-conversation-sidebar',
            'display: flex;',
            'flex-direction: column;',
            '#chat .home-conversation-sidebar .home-live-captions',
            'max-height: none;',
            'overflow-y: auto;',
            '@media (max-width: 899px)',
            'flex-direction: column;',
            '@media (max-width: 767px)',
            '#voice-settings',
            '#text-workspace',
        ):
            with self.subTest(rule=rule):
                self.assertIn(rule,css)
        self.assertIn('home-live-buttons', (ROOT / 'static' / 'mobile.css').read_text(encoding='utf-8'))

    def test_reactor_centred_log_docked_to_true_viewport_edge(self):
        css = (ROOT / 'static' / 'astral.css').read_text(encoding='utf-8')
        desktop = css.split('@media (min-width: 1260px) {',1)[1].split('@media (min-width: 768px)',1)[0]
        self.assertIn('body.cosmos-page.home-live-mode > main',desktop)
        self.assertIn('max-width: none;',desktop)
        self.assertIn('width: 100%;',desktop)
        self.assertIn('body.cosmos-page.home-live-mode #chat .voice-orb',desktop)
        self.assertIn('width: clamp(460px, 31vw, 580px)',desktop)
        self.assertIn('#chat .home-conversation-sidebar',desktop)
        self.assertIn('position: fixed;',desktop)
        self.assertIn('right: 0;',desktop)
        self.assertIn('left: auto;',desktop)
        self.assertIn('top: 116px;',desktop)
        self.assertIn('height: auto;',desktop)
        self.assertIn('z-index: 7;',desktop)
        self.assertIn('body.cosmos-page.home-live-mode > main > section.panel:not(#chat)',desktop)
        self.assertIn('max-width: 1160px;',desktop)

    def test_mobile_does_not_pin_log_or_overflow_viewport(self):
        css = (ROOT / 'static' / 'astral.css').read_text(encoding='utf-8')
        self.assertIn('@media (max-width: 899px)',css)
        self.assertIn('height: clamp(315px, 45dvh, 490px);',css)
        self.assertIn('@media (max-width: 767px) and (min-height: 700px) and (orientation: portrait)',css)
        self.assertIn('width: clamp(235px, 74vw, 310px);',css)
        mobile = (ROOT / 'static' / 'mobile.css').read_text(encoding='utf-8')
        self.assertIn('position: fixed;',mobile)
        self.assertIn('.home-live-mode .home-live-buttons',mobile)

    def test_navigation_and_existing_voice_actions_remain_wired(self):
        app = (ROOT / 'static' / 'app.js').read_text(encoding='utf-8')
        effects = (ROOT / 'static' / 'cinematic.js').read_text(encoding='utf-8')
        live = (ROOT / 'static' / 'live.js').read_text(encoding='utf-8')
        self.assertIn("document.querySelectorAll('.panel')",app)
        self.assertIn("'text-workspace-to-voice'",app)
        self.assertIn("preferences({ interaction_mode: 'voice' })",app)
        self.assertIn('[data-tab="text-workspace"]',effects)
        self.assertIn('[data-tab="voice-settings"]',live)
        self.assertIn("const captions = $('live-captions')",live)
        self.assertIn("const target = $('archive-save-status')",live)
        self.assertIn("APP_VERSION = '1.9.0'",(ROOT / 'server.py').read_text(encoding='utf-8'))
        self.assertIn('ASTER 1.9',self.html)


if __name__ == '__main__':
    unittest.main()
