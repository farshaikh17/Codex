"""engine/liveness.py: only 404/410 (twice) or a Greenhouse error redirect closes a job; blocked or failing sites prove
nothing; the SQL never closes a job with an application or a human decision. Offline: urlopen is replaced."""
import json
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
import urllib.error
from unittest import mock

from engine import liveness

CODES = {'/ok': 200, '/gone': 404, '/removed': 410, '/blocked': 403, '/busy': 429, '/err': 500}


def fake_urlopen(req, timeout=20):
    url = req.full_url
    path = '/' + url.split('/', 3)[-1] if url.count('/') >= 3 else '/'
    if path == '/timeout':
        raise TimeoutError('timed out')
    code = CODES.get(path, 200)
    if code >= 400:
        raise urllib.error.HTTPError(url, code, 'x', {}, None)
    r = mock.MagicMock()
    r.__enter__.return_value = r
    r.geturl.return_value = ('https://boards.greenhouse.io/acme?error=true' if path == '/gh'
                             else 'https://jobs.example/' if path == '/homepage' else url)
    r.status = code
    r.read.return_value = b''
    return r


class Liveness(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(liveness.urllib.request, 'urlopen', fake_urlopen)
        p.start(); self.addCleanup(p.stop)
        s = mock.patch.object(liveness.time, 'sleep', lambda *_: None)
        s.start(); self.addCleanup(s.stop)

    def test_probe_rules(self):
        st = lambda p: liveness.probe('https://jobs.example' + p)[0]
        self.assertEqual(st('/ok'), 'alive')
        self.assertEqual(st('/gone'), 'dead')
        self.assertEqual(st('/removed'), 'dead')
        self.assertEqual(st('/gh'), 'dead', 'a Greenhouse error redirect means the posting is gone')
        self.assertEqual(st('/homepage'), 'unknown', 'a homepage is not evidence of a live posting')
        for p in ('/blocked', '/busy', '/err', '/timeout'):
            self.assertEqual(st(p), 'unknown', p)

    def test_check_and_sql(self):
        b = 'https://jobs.example'
        t = [{'id': 'a', 'url': b + '/ok'}, {'id': 'b', 'url': b + '/gone'}, {'id': 'c', 'url': b + '/blocked'},
             {'id': 'd', 'url': b + '/gone'}, {'id': 'a', 'url': b + '/ok'}]
        res = liveness.check(t, pause=0)
        self.assertEqual(sorted(res['dead']), ['b', 'd']); self.assertEqual(res['alive'], ['a']); self.assertEqual(res['unknown'], 1)
        db = sqlite3.connect(':memory:')
        db.executescript("""CREATE TABLE jobs(id TEXT PRIMARY KEY, is_active INT, expired_at TEXT, last_verified_at TEXT);
          CREATE TABLE applications(job_id TEXT); CREATE TABLE candidate_qualifications(job_id TEXT, manual_override_status TEXT, qualification_status TEXT, qualification_reason TEXT);
          CREATE TABLE cache_state(id INT, generation INT); INSERT INTO cache_state VALUES (1, 5);
          INSERT INTO jobs(id, is_active) VALUES ('a',1),('b',1),('c',1),('d',1);
          INSERT INTO applications VALUES ('d');""")
        db.executescript(liveness.to_sql(res, now='2026-11-07T00:00:00Z'))
        rows = dict(db.execute('SELECT id, is_active FROM jobs').fetchall())
        self.assertEqual(rows, {'a': 1, 'b': 0, 'c': 1, 'd': 1}, 'a job with an application is never closed')
        self.assertEqual(db.execute("SELECT last_verified_at FROM jobs WHERE id='a'").fetchone()[0], '2026-11-07T00:00:00Z')
        self.assertEqual(db.execute('SELECT generation FROM cache_state').fetchone()[0], 6)
        self.assertEqual(liveness.to_sql({'dead': [], 'alive': [], 'unknown': 0}).strip(), '')

    def test_dead_job_with_other_candidates_ready_or_decided_status_is_preserved(self):
        db = sqlite3.connect(':memory:')
        db.executescript("""
          CREATE TABLE jobs(id TEXT PRIMARY KEY, is_active INT, expired_at TEXT, last_verified_at TEXT);
          CREATE TABLE applications(job_id TEXT);
          CREATE TABLE candidate_qualifications(job_id TEXT, manual_override_status TEXT, qualification_status TEXT, qualification_reason TEXT);
          CREATE TABLE cache_state(id INT, generation INT);
          INSERT INTO cache_state VALUES (1, 0);
          INSERT INTO jobs(id,is_active) VALUES ('ready',1),('stretch',1),('manual',1),('undecided',1),('auto',1),('auto_manual',1);
          INSERT INTO candidate_qualifications(job_id, manual_override_status, qualification_status, qualification_reason) VALUES
            ('ready',NULL,'NEEDS_REVIEW',NULL), ('ready',NULL,'READY','Strongest Fit verified match (61%)'),
            ('stretch',NULL,'STRETCH_READY',NULL), ('manual','HOLD','NEEDS_REVIEW',NULL),
            ('undecided',NULL,'NEEDS_REVIEW',NULL),
            ('auto',NULL,'READY','Shortlisted automatically. Cloud discovery match.'), ('auto',NULL,'STRETCH_READY','Shortlisted automatically. x'),
            ('auto_manual','READY','READY','Shortlisted automatically. x');
        """)
        db.executescript(liveness.to_sql({'dead':['ready','stretch','manual','undecided','auto','auto_manual'], 'alive':[], 'unknown':0}))
        # a row the screen shortlisted by itself is not a decision: its dead posting closes. One a person then confirmed stays.
        self.assertEqual(dict(db.execute('SELECT id,is_active FROM jobs')), {'ready':1,'stretch':1,'manual':1,'undecided':0,'auto':0,'auto_manual':1})

    def test_export_uses_source_when_application_url_is_placeholder(self):
        db = sqlite3.connect(':memory:')
        db.executescript("""
          CREATE TABLE jobs(id TEXT PRIMARY KEY, original_posting_url TEXT, source_url TEXT, is_active INT, discovered_at TEXT);
          CREATE TABLE candidate_job_scores(candidate_id TEXT, job_id TEXT, overall_score INT);
          CREATE TABLE candidate_qualifications(candidate_id TEXT, job_id TEXT, manual_override_status TEXT, qualification_status TEXT, qualification_reason TEXT);
          CREATE TABLE applications(job_id TEXT);
          INSERT INTO jobs VALUES ('j','nan','https://example.com/job',1,'2026-11-09');
          INSERT INTO candidate_job_scores VALUES ('farhan','j',80);
          INSERT INTO candidate_qualifications VALUES ('farhan','j',NULL,'NEEDS_REVIEW',NULL);
        """)
        self.assertEqual(db.execute(liveness.EXPORT_SQL).fetchall(), [('j','https://example.com/job')])

    def test_export_checks_automatic_shortlist_first_and_never_a_decided_row(self):
        db = sqlite3.connect(':memory:')
        db.executescript("""
          CREATE TABLE jobs(id TEXT PRIMARY KEY, original_posting_url TEXT, source_url TEXT, is_active INT, discovered_at TEXT);
          CREATE TABLE candidate_job_scores(candidate_id TEXT, job_id TEXT, overall_score INT);
          CREATE TABLE candidate_qualifications(candidate_id TEXT, job_id TEXT, manual_override_status TEXT, qualification_status TEXT, qualification_reason TEXT);
          CREATE TABLE applications(job_id TEXT);
          INSERT INTO jobs VALUES ('review',NULL,'https://example.com/1',1,'2026-11-09'),('auto',NULL,'https://example.com/2',1,'2026-11-09'),
            ('import',NULL,'https://example.com/3',1,'2026-11-09'),('person',NULL,'https://example.com/4',1,'2026-11-09');
          INSERT INTO candidate_job_scores VALUES ('farhan','review',95),('farhan','auto',70),('farhan','import',61),('farhan','person',80);
          INSERT INTO candidate_qualifications VALUES ('farhan','review',NULL,'NEEDS_REVIEW',NULL),
            ('farhan','auto',NULL,'READY','Shortlisted automatically. Cloud discovery match.'),
            ('farhan','import',NULL,'READY','Strongest Fit verified match (61%)'),
            ('farhan','person','READY','READY','Shortlisted automatically. x');
        """)
        self.assertEqual([r[0] for r in db.execute(liveness.EXPORT_SQL).fetchall()], ['auto', 'review'])


class SlowServer(unittest.TestCase):
    """A day when many employer sites hang: the check stops at its deadline and returns (and writes) what it has."""
    def setUp(self):
        self.release = threading.Event()
        self.addCleanup(self.release.set)

        def slow_urlopen(req, timeout=20):
            if '/slow' in req.full_url:
                self.release.wait(timeout)   # hangs until the per-request timeout (or the end of the test)
                raise TimeoutError('timed out')
            return fake_urlopen(req, timeout)
        p = mock.patch.object(liveness.urllib.request, 'urlopen', slow_urlopen)
        p.start(); self.addCleanup(p.stop)
        s = mock.patch.object(liveness.time, 'sleep', lambda *_: None)
        s.start(); self.addCleanup(s.stop)

    def targets(self):
        b = 'https://jobs.example'
        return ([{'id': f'ok{i}', 'url': b + '/ok'} for i in range(6)] + [{'id': 'g', 'url': b + '/gone'}]
                + [{'id': f's{i}', 'url': b + '/slow'} for i in range(12)])

    def test_deadline_returns_partial_results(self):
        t0 = time.monotonic()
        res = liveness.check(self.targets(), pause=0, workers=4, deadline=0.5)
        took = time.monotonic() - t0
        self.assertLess(took, 3, 'returns at the deadline, not after every slow site')
        self.assertEqual(sorted(res['alive']), [f'ok{i}' for i in range(6)])
        self.assertEqual(res['dead'], ['g'])
        self.assertEqual(res['unknown'] + res['unchecked'], 12, 'every slow site is unknown or not reached')
        self.assertGreater(res['unchecked'], 0)

    def test_defaults(self):
        self.assertEqual((liveness.WORKERS, liveness.TIMEOUT, liveness.DEADLINE), (8, 8, 480))

    def test_check_command_writes_partial_results(self):
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d) / 'targets.json', Path(d) / 'result.json'
            src.write_text(json.dumps(self.targets()))
            with mock.patch.object(liveness, 'DEADLINE', 0.5), mock.patch.object(liveness, 'WORKERS', 4), \
                    mock.patch.object(sys, 'argv', ['liveness.py', '--check', str(src), '--out', str(dst)]), \
                    mock.patch('builtins.print'):
                liveness.main()
            res = json.loads(dst.read_text())
            self.assertEqual(len(res['alive']), 6)
            self.assertEqual(res['dead'], ['g'])
            sql = liveness.to_sql(res, now='2026-11-13T00:00:00Z')
            self.assertIn('last_verified_at', sql, 'the verified rows are written even though the check stopped early')


if __name__ == '__main__':
    unittest.main()

