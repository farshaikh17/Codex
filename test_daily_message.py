"""engine/daily_message.py (plan G1): the message text, the counts query, chat linking, and "does nothing without a secret".
Offline: no Telegram, email or database call is made."""
import io
import json
import sqlite3
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from engine import daily_message as dm

NOW = datetime(2026, 11, 14, 16, 0, tzinfo=timezone.utc)


class Message(unittest.TestCase):
    def test_new_jobs(self):
        text = dm.build_message('Sana', {'new_ready': 3, 'new_stretch': 1, 'ready': 25, 'stretch': 24}, 'https://x.dev/app#sana/today')
        self.assertEqual(text, 'Sana: 4 new jobs today · 25 best matches, 24 worth a try · https://x.dev/app#sana/today')

    def test_one_and_none(self):
        self.assertTrue(dm.build_message('Farhan', {'new_ready': 1, 'ready': 1}, 'L').startswith('Farhan: 1 new job today · 1 best match, 0 worth a try'))
        self.assertTrue(dm.build_message('Farhan', {}, 'L').startswith('Farhan: no new jobs today'))
        self.assertTrue(dm.build_message('Farhan', None, 'L').endswith(' · L'))

    def test_failed_run_says_so(self):
        for status in ('failure', 'cancelled', 'unhealthy'):
            text = dm.build_message('Sana', {'new_ready': 5, 'ready': 25}, 'L', status=status)
            self.assertIn("today's update did not finish properly", text)
            self.assertNotIn('5 new', text)
        self.assertIn('postponed', dm.build_message('Sana', {'new_ready': 5}, 'L', status='postponed'))

    def test_link_and_name(self):
        self.assertEqual(dm.site_link('sana_ansari', 'https://s.dev/'), 'https://s.dev/app#sana/today')
        self.assertEqual(dm.first_name('Sana Ansari', 'sana_ansari'), 'Sana')
        self.assertEqual(dm.first_name(None, 'farhan_shaikh'), 'Farhan')


class CountsQuery(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          CREATE TABLE candidates (id TEXT PRIMARY KEY, full_name TEXT NOT NULL);
          CREATE TABLE jobs (id TEXT PRIMARY KEY, is_active INTEGER, discovered_at TEXT);
          CREATE TABLE candidate_qualifications (candidate_id TEXT, job_id TEXT, qualification_status TEXT, qualified_at TEXT, manual_override_status TEXT);
          CREATE TABLE applications (id TEXT PRIMARY KEY, candidate_id TEXT, job_id TEXT, status TEXT);
          INSERT INTO candidates VALUES ('sana_ansari', 'Sana Ansari'), ('farhan_shaikh', 'Farhan Shaikh');
        """)
        rows = [  # job, active, discovered, status, qualified
            ('n1', 1, '2026-11-14T10:00:00Z', 'READY', '2026-11-14 10:00:00'),          # new, Ready
            ('n2', 1, '2026-11-01T10:00:00Z', 'STRETCH_READY', '2026-11-14 09:00:00'),  # put on the list today
            ('o1', 1, '2026-11-01T10:00:00Z', 'READY_HIGH', '2026-11-02 10:00:00'),     # old
            ('x1', 0, '2026-11-14T10:00:00Z', 'READY', '2026-11-14 10:00:00'),          # closed
            ('h1', 1, '2026-11-14T10:00:00Z', 'NEEDS_REVIEW', '2026-11-14 10:00:00'),   # not on a list
            ('a1', 1, '2026-11-14T10:00:00Z', 'READY', '2026-11-14 10:00:00'),          # applied
            ('s1', 1, '2026-11-14T10:00:00Z', 'READY', '2026-11-14 10:00:00'),          # saved only: still counts
            ('v1', 1, '2026-11-14T10:00:00Z', 'READY', '2026-11-14 10:00:00'),          # a person's override (Hold): not counted, as on the page
        ]
        for jid, active, disc, st, qa in rows:
            self.db.execute('INSERT INTO jobs VALUES (?, ?, ?)', (jid, active, disc))
            self.db.execute('INSERT INTO candidate_qualifications VALUES (?, ?, ?, ?, ?)', ('sana_ansari', jid, st, qa, 'HOLD' if jid == 'v1' else None))
        self.db.execute("INSERT INTO applications VALUES ('p1', 'sana_ansari', 'a1', 'SAVED'), ('p2', 'sana_ansari', 'a1', 'SUBMITTED'), ('p3', 'sana_ansari', 's1', 'SAVED')")

    def test_counts(self):
        rows = [dict(r) for r in self.db.execute(dm.counts_sql(['sana_ansari', 'farhan_shaikh', "x'); DROP TABLE jobs;--"], NOW))]
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r['id'], r['ready'], r['stretch'], r['new_ready'], r['new_stretch']), ('sana_ansari', 3, 1, 2, 1))
        self.assertEqual(r['full_name'], 'Sana Ansari')


class Linking(unittest.TestCase):
    KNOWN = {'sana_ansari', 'farhan_shaikh'}

    @staticmethod
    def upd(uid, chat, text, kind='private'):
        return {'update_id': uid, 'message': {'chat': {'id': chat, 'type': kind}, 'text': text}}

    def test_start_links(self):
        ups = [self.upd(1, 11, '/start sana_ansari'), self.upd(2, 22, '/start farhan'), self.upd(3, 33, 'hello'),
               self.upd(4, 44, '/start nobody'), self.upd(5, 55, '/start sana_ansari', kind='group'), self.upd(6, 11, '/start sana_ansari')]
        self.assertEqual(dm.link_updates(ups, self.KNOWN, {}), {'sana_ansari': [11], 'farhan_shaikh': [22]})

    def test_adds_never_replaces_and_caps(self):
        existing = {'sana_ansari': [1, 2]}
        ups = [self.upd(1, 3, '/start sana'), self.upd(2, 4, '/start sana')]
        self.assertEqual(dm.link_updates(ups, self.KNOWN, existing), {'sana_ansari': [1, 2, 3]})
        self.assertEqual(dm.link_updates([self.upd(1, 2, '/start sana')], self.KNOWN, existing), {})

    def test_stop_unlinks(self):
        self.assertEqual(dm.link_updates([self.upd(1, 2, '/stop')], self.KNOWN, {'sana_ansari': [1, 2]}), {'sana_ansari': [1]})
        self.assertEqual(dm.link_updates([self.upd(1, 2, '/stop')], self.KNOWN, {'sana_ansari': [2]}), {'sana_ansari': []})

    def test_state_rows(self):
        rows = [{'key': 'telegram:sana_ansari', 'value': '[11, "22", "x"]'}, {'key': 'telegram:bad id', 'value': '[1]'},
                {'key': 'telegram:farhan_shaikh', 'value': 'not json'}, {'key': 'message:last_sent', 'value': 'x'}]
        self.assertEqual(dm.chats_from_state(rows), {'sana_ansari': [11, 22]})

    def test_email_recipients(self):
        got = dm.email_recipients('sana_ansari=a@x.com, bad; farhan_shaikh = b@y.org ; stranger=c@z.com; junk', self.KNOWN)
        self.assertEqual(got, {'sana_ansari': ['a@x.com'], 'farhan_shaikh': ['b@y.org']})

    def test_recently_sent(self):
        self.assertTrue(dm.recently_sent('2026-11-14T08:00:00Z', NOW))
        self.assertFalse(dm.recently_sent('2026-11-13T15:00:00Z', NOW))
        self.assertFalse(dm.recently_sent('garbage', NOW))
        self.assertTrue(dm.recently_sent('2026-11-14T08:00:00Z ok', NOW))
        # after a recent "did not finish" message, the retried good run's message still goes out; a second failure does not repeat it
        self.assertFalse(dm.recently_sent('2026-11-14T08:00:00Z failed', NOW, run_ok=True))
        self.assertTrue(dm.recently_sent('2026-11-14T08:00:00Z failed', NOW, run_ok=False))
        self.assertTrue(dm.recently_sent('2026-11-14T08:00:00Z ok', NOW, run_ok=False))

    def test_sql_quotes(self):
        self.assertIn("'[1, 2]'", dm.state_sql('telegram:sana_ansari', json.dumps([1, 2]), NOW))
        self.assertIn("'it''s'", dm.state_sql('k', "it's", NOW))


class Channels(unittest.TestCase):
    def run_send(self, env, **kw):
        out = io.StringIO()
        with redirect_stdout(out):
            code = dm.run_send(SimpleNamespace(status='success', force=False, **kw), env, NOW)
        return code, out.getvalue()

    def test_no_secret_does_nothing(self):
        with mock.patch.object(dm, 'd1_read', side_effect=AssertionError('no read without a channel')), \
             mock.patch.object(dm, 'telegram', side_effect=AssertionError('no call')):
            code, out = self.run_send({})
        self.assertEqual(code, 0)
        self.assertIn('skipped - no channel is set up', out)
        with mock.patch.object(dm, 'd1_read', side_effect=AssertionError('no read')):
            code, out = self.run_send({'DIGEST_PROVIDER': 'smtp', 'DIGEST_SMTP_USER': 'u'})   # no password: email off too
        self.assertIn('skipped', out)
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(dm.run_link({}), 0)
        self.assertIn('TELEGRAM_BOT_TOKEN is not set', out.getvalue())

    def test_sends_and_never_prints_secrets(self):
        state = [{'key': 'telegram:sana_ansari', 'value': '[987654321]'}]
        counts = [{'id': 'sana_ansari', 'full_name': 'Sana Ansari', 'ready': 25, 'stretch': 25, 'new_ready': 4, 'new_stretch': 0}]
        reads = iter([state, [{'id': 'sana_ansari'}, {'id': 'farhan_shaikh'}], counts])
        sent, writes = [], []
        with mock.patch.object(dm, 'd1_read', side_effect=lambda sql: next(reads)), \
             mock.patch.object(dm, 'd1_write', side_effect=lambda sql: writes.append(sql) or True), \
             mock.patch.object(dm, 'telegram', side_effect=lambda tok, m, p: sent.append(p) or ({}, None)):
            code, out = self.run_send({'TELEGRAM_BOT_TOKEN': 'SECRET123'})
        self.assertEqual(code, 0)
        self.assertEqual(sent[0]['chat_id'], 987654321)
        self.assertTrue(sent[0]['text'].startswith('Sana: 4 new jobs today · 25 best matches, 25 worth a try · https://'))
        self.assertNotIn('SECRET123', out)
        self.assertNotIn('987654321', out)
        self.assertIn('message:last_sent', writes[0])

    def test_already_sent_today(self):
        with mock.patch.object(dm, 'd1_read', return_value=[{'key': 'message:last_sent', 'value': '2026-11-14T10:00:00Z'}]), \
             mock.patch.object(dm, 'telegram', side_effect=AssertionError('no send')):
            code, out = self.run_send({'TELEGRAM_BOT_TOKEN': 't'})
        self.assertEqual(code, 0)
        self.assertIn('already sent', out)

    def test_telegram_error_hides_token(self):
        import urllib.error
        err = urllib.error.URLError('https://api.telegram.org/botSECRET/sendMessage unreachable')
        with mock.patch('urllib.request.urlopen', side_effect=err):
            res, why = dm.telegram('SECRET', 'sendMessage', {})
        self.assertIsNone(res)
        self.assertNotIn('SECRET', why)


if __name__ == '__main__':
    unittest.main()
