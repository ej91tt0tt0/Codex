"""Offline tests for private Live transcript persistence and AI summarisation."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import live_archive

ID = 'a' * 32
START = '2026-11-01T10:00:00.000Z'
END = '2026-11-01T10:11:02.000Z'


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = Path(self.tmp.name) / 'archive.sqlite3'
        with self.connect() as db:
            live_archive.init_schema(db)
        self.record = {
            'id': ID, 'started': START, 'ended': END,
            'turns': [
                {'speaker': 'あなた', 'text': '次回の会議を整理したい。'},
                {'speaker': 'ASTER', 'text': '議題と担当者を決めましょう。'},
            ],
        }

    def connect(self):
        db = sqlite3.connect(self.db)
        db.row_factory = sqlite3.Row
        return db

    def test_save_idempotently_and_show_full_transcript(self):
        self.assertEqual(live_archive.save(self.connect, self.record), (ID, True))
        self.assertEqual(live_archive.save(self.connect, self.record), (ID, False))
        data = live_archive.detail(self.connect, ID)
        self.assertEqual(data['turns'], self.record['turns'])
        self.assertEqual(data['status'], 'pending')
        self.assertEqual(len(live_archive.listing(self.connect)), 1)
        self.assertEqual(data['started'], '2026-11-01T10:00:00+00:00')
        self.assertFalse('audio' in data)

    def test_summary_and_topics_are_generated_without_search(self):
        live_archive.save(self.connect, self.record)
        answer = json.dumps({
            'summary': '会議について議題と担当者の整理を相談した。',
            'topics': ['会議準備', '担当者'],
        }, ensure_ascii=False)
        with mock.patch('live_archive.respond', return_value=answer) as ai:
            live_archive.summarise(self.connect, ID)
        kwargs = ai.call_args.kwargs
        self.assertIs(kwargs['search'], False)
        self.assertEqual(live_archive.detail(self.connect, ID)['status'], 'ready')
        self.assertEqual(live_archive.detail(self.connect, ID)['topics'], ['会議準備', '担当者'])

    def test_summary_failure_never_erases_transcript(self):
        live_archive.save(self.connect, self.record)
        with mock.patch('live_archive.respond', side_effect=RuntimeError('API unavailable')):
            live_archive.summarise(self.connect, ID)
        data = live_archive.detail(self.connect, ID)
        self.assertEqual(data['status'], 'failed')
        self.assertEqual(data['turns'], self.record['turns'])
        self.assertTrue(live_archive.restart_summary(self.connect, ID))
        self.assertFalse(live_archive.restart_summary(self.connect, ID))

    def test_json_code_fences_are_accepted(self):
        live_archive.save(self.connect, self.record)
        answer = '```json\n' + json.dumps({'summary': '会議を相談した。', 'topics': []}) + '\n```'
        with mock.patch('live_archive.respond', return_value=answer):
            live_archive.summarise(self.connect, ID)
        self.assertEqual(live_archive.detail(self.connect, ID)['status'], 'ready')

    def test_rejects_invalid_ids_dates_and_transcripts(self):
        for bad in [
            dict(self.record, id='not-a-uuid'),
            dict(self.record, started='2026-11-01T10:00:00'),
            dict(self.record, ended='2025-11-01T10:00:00Z'),
            dict(self.record, turns=[]),
            dict(self.record, turns=[{'speaker': 'robot', 'text': 'bad'}]),
            dict(self.record, turns=[{'speaker': 'ASTER', 'text': 'x' * 6001}]),
        ]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    live_archive.save(self.connect, bad)
        self.assertEqual(live_archive.listing(self.connect), [])

    def test_delete_prevents_late_summaries(self):
        live_archive.save(self.connect, self.record)
        self.assertTrue(live_archive.delete(self.connect, ID))
        self.assertFalse(live_archive.delete(self.connect, ID))
        self.assertIsNone(live_archive.detail(self.connect, ID))
        live_archive.summarise(self.connect, ID)
        self.assertIsNone(live_archive.detail(self.connect, ID))


if __name__ == '__main__':
    unittest.main()
