"""engine/liveness.py: only 404/410 (twice) or a Greenhouse error redirect closes a job; blocked or failing sites prove
nothing; the SQL never closes a job with an application or a human decision. Offline: urlopen is replaced."""
import sqlite3
import unittest
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
    r.geturl.return_value = 'https://boards.greenhouse.io/acme?error=true' if path == '/gh' else url
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
          CREATE TABLE applications(job_id TEXT); CREATE TABLE candidate_qualifications(job_id TEXT, manual_override_status TEXT, qualification_status TEXT);
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
          CREATE TABLE candidate_qualifications(job_id TEXT, manual_override_status TEXT, qualification_status TEXT);
          CREATE TABLE cache_state(id INT, generation INT);
          INSERT INTO cache_state VALUES (1, 0);
          INSERT INTO jobs(id,is_active) VALUES ('ready',1),('stretch',1),('manual',1),('undecided',1);
          INSERT INTO candidate_qualifications VALUES
            ('ready',NULL,'NEEDS_REVIEW'), ('ready',NULL,'READY'),
            ('stretch',NULL,'STRETCH_READY'), ('manual','HOLD','NEEDS_REVIEW'),
            ('undecided',NULL,'NEEDS_REVIEW');
        """)
        db.executescript(liveness.to_sql({'dead':['ready','stretch','manual','undecided'], 'alive':[], 'unknown':0}))
        self.assertEqual(dict(db.execute('SELECT id,is_active FROM jobs')), {'ready':1,'stretch':1,'manual':1,'undecided':0})


if __name__ == '__main__':
    unittest.main()

