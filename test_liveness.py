"""engine/liveness.py: only 404/410 (twice) or a Greenhouse error redirect closes a job; blocked or failing sites prove
nothing; the SQL never closes a job with an application or a human decision. Uses a local HTTP server, no internet."""
import json
import sqlite3
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from engine import liveness


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        code = {'/ok': 200, '/gone': 404, '/removed': 410, '/blocked': 403, '/busy': 429, '/err': 500}.get(self.path.split('?')[0], 200)
        if self.path == '/gh':
            self.send_response(302); self.send_header('Location', '/boards.greenhouse.io/acme?error=true'); self.end_headers(); return
        self.send_response(code); self.end_headers(); self.wfile.write(b'x')

    def log_message(self, *a):
        pass


class Liveness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.srv.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def test_probe_rules(self):
        st = lambda p: liveness.probe(self.base + p)[0]
        self.assertEqual(st('/ok'), 'alive')
        self.assertEqual(st('/gone'), 'dead')
        self.assertEqual(st('/removed'), 'dead')
        for p in ('/blocked', '/busy', '/err'):
            self.assertEqual(st(p), 'unknown', p)
        self.assertEqual(liveness.probe('http://127.0.0.1:1/x', timeout=2)[0], 'unknown')

    def test_greenhouse_error_redirect(self):
        # the final URL carries greenhouse.io and error=true
        with unittest.mock.patch.object(liveness.urllib.request, 'urlopen') as m:
            r = unittest.mock.MagicMock(); r.__enter__.return_value = r
            r.geturl.return_value = 'https://boards.greenhouse.io/acme?error=true'; r.status = 200; r.read.return_value = b''
            m.return_value = r
            self.assertEqual(liveness.probe('https://boards.greenhouse.io/acme/jobs/1')[0], 'dead')

    def test_check_and_sql(self):
        t = [{'id': 'a', 'url': self.base + '/ok'}, {'id': 'b', 'url': self.base + '/gone'}, {'id': 'c', 'url': self.base + '/blocked'},
             {'id': 'd', 'url': self.base + '/gone'}, {'id': 'a', 'url': self.base + '/ok'}]
        res = liveness.check(t, pause=0)
        self.assertEqual(sorted(res['dead']), ['b', 'd']); self.assertEqual(res['alive'], ['a']); self.assertEqual(res['unknown'], 1)
        db = sqlite3.connect(':memory:')
        db.executescript("""CREATE TABLE jobs(id TEXT PRIMARY KEY, is_active INT, expired_at TEXT, last_verified_at TEXT);
          CREATE TABLE applications(job_id TEXT); CREATE TABLE candidate_qualifications(job_id TEXT, manual_override_status TEXT);
          CREATE TABLE cache_state(id INT, generation INT); INSERT INTO cache_state VALUES (1, 5);
          INSERT INTO jobs(id, is_active) VALUES ('a',1),('b',1),('c',1),('d',1);
          INSERT INTO applications VALUES ('d');""")
        db.executescript(liveness.to_sql(res, now='2026-11-07T00:00:00Z'))
        rows = dict(db.execute('SELECT id, is_active FROM jobs').fetchall())
        self.assertEqual(rows, {'a': 1, 'b': 0, 'c': 1, 'd': 1}, 'a job with an application is never closed')
        self.assertEqual(db.execute("SELECT last_verified_at FROM jobs WHERE id='a'").fetchone()[0], '2026-11-07T00:00:00Z')
        self.assertEqual(db.execute('SELECT generation FROM cache_state').fetchone()[0], 6)
        self.assertEqual(liveness.to_sql({'dead': [], 'alive': [], 'unknown': 0}).strip(), '')


import unittest.mock  # noqa: E402

if __name__ == '__main__':
    unittest.main()
