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


def _reader(db):
    db.row_factory = sqlite3.Row
    return lambda sql: [dict(r) for r in db.execute(sql).fetchall()]


# The single window query the export used before the per-person queries (kept here as the reference the new export must agree with).
OLD_EXPORT_SQL = f"""SELECT id, url FROM (
  SELECT j.id, CASE WHEN j.original_posting_url LIKE 'https://%' THEN j.original_posting_url ELSE j.source_url END AS url,
         ROW_NUMBER() OVER (PARTITION BY s.candidate_id ORDER BY q.qualification_status IN ('READY','STRETCH_READY') DESC, s.overall_score DESC, j.discovered_at DESC) AS rk
  FROM candidate_job_scores s JOIN jobs j ON j.id = s.job_id JOIN candidate_qualifications q ON q.candidate_id = s.candidate_id AND q.job_id = s.job_id
  WHERE j.is_active = 1 AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = j.id)
    AND NOT EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.job_id = j.id AND {liveness.DECIDED})
    AND (j.original_posting_url LIKE 'https://%' OR j.source_url LIKE 'https://%')
) WHERE rk <= {liveness.PER_CANDIDATE}"""


class ExportEquivalence(unittest.TestCase):
    def test_per_person_export_selects_the_same_jobs_as_the_old_window_query(self):
        import random
        rnd = random.Random(5)
        db = sqlite3.connect(':memory:')
        for f in sorted((Path(__file__).parent / 'dashboard' / 'migrations').glob('*.sql')):
            db.executescript(f.read_text())
        db.executescript("INSERT INTO candidates(id, full_name) VALUES ('a','A'),('b','B'),('c','C');")
        scores = rnd.sample(range(100000), 3000)
        for i in range(1000):
            db.execute('INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,discovered_at) VALUES (?,?,?,?,?,?,?)',
                       (f'j{i}', 't', 'c', 'x', f'https://e.com/{i}' if i % 13 else 'nan', 1 if i % 9 else 0, f'2026-11-{1 + i % 28:02d}'))
            for k, cid in enumerate('abc'):
                if (i + k) % 4 == 0:
                    continue
                st = rnd.choice(['NEEDS_REVIEW'] * 6 + ['HOLD', 'INELIGIBLE', 'READY', 'STRETCH_READY'])
                reason = 'Shortlisted automatically. x' if st in ('READY', 'STRETCH_READY') and rnd.random() < 0.7 else 'r'
                override = 'READY' if rnd.random() < 0.02 else None
                db.execute('INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?)', (cid, f'j{i}', st, reason, override))
                db.execute('INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score) VALUES (?,?,?)', (cid, f'j{i}', scores[i * 3 + k]))   # distinct, so both orders are total
        for i in range(0, 1000, 37):
            db.execute('INSERT INTO applications(id,candidate_id,job_id) VALUES (?,?,?)', (f'a{i}', 'a', f'j{i}'))
        old = sorted(r[0] for r in db.execute(OLD_EXPORT_SQL).fetchall())
        new = sorted(r['id'] for r in liveness.export_rows(_reader(db)))
        self.assertEqual(new, old)
        self.assertEqual(len(new), 3 * liveness.PER_CANDIDATE)


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
          CREATE TABLE candidates(id TEXT PRIMARY KEY); INSERT INTO candidates VALUES ('farhan');
          INSERT INTO jobs VALUES ('j','nan','https://example.com/job',1,'2026-11-09');
          INSERT INTO candidate_job_scores VALUES ('farhan','j',80);
          INSERT INTO candidate_qualifications VALUES ('farhan','j',NULL,'NEEDS_REVIEW',NULL);
        """)
        self.assertEqual([(r['id'], r['url']) for r in liveness.export_rows(_reader(db))], [('j','https://example.com/job')])

    def test_export_checks_automatic_shortlist_first_and_never_a_decided_row(self):
        db = sqlite3.connect(':memory:')
        db.executescript("""
          CREATE TABLE jobs(id TEXT PRIMARY KEY, original_posting_url TEXT, source_url TEXT, is_active INT, discovered_at TEXT);
          CREATE TABLE candidate_job_scores(candidate_id TEXT, job_id TEXT, overall_score INT);
          CREATE TABLE candidate_qualifications(candidate_id TEXT, job_id TEXT, manual_override_status TEXT, qualification_status TEXT, qualification_reason TEXT);
          CREATE TABLE applications(job_id TEXT);
          CREATE TABLE candidates(id TEXT PRIMARY KEY); INSERT INTO candidates VALUES ('farhan');
          INSERT INTO jobs VALUES ('review',NULL,'https://example.com/1',1,'2026-11-09'),('auto',NULL,'https://example.com/2',1,'2026-11-09'),
            ('import',NULL,'https://example.com/3',1,'2026-11-09'),('person',NULL,'https://example.com/4',1,'2026-11-09');
          INSERT INTO candidate_job_scores VALUES ('farhan','review',95),('farhan','auto',70),('farhan','import',61),('farhan','person',80);
          INSERT INTO candidate_qualifications VALUES ('farhan','review',NULL,'NEEDS_REVIEW',NULL),
            ('farhan','auto',NULL,'READY','Shortlisted automatically. Cloud discovery match.'),
            ('farhan','import',NULL,'READY','Strongest Fit verified match (61%)'),
            ('farhan','person','READY','READY','Shortlisted automatically. x');
        """)
        self.assertEqual([r['id'] for r in liveness.export_rows(_reader(db))], ['auto', 'review'])


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


# ---- Jobs QA 7: the employer's own record of a posting's place, and Workday postings taken down -------------------------------------------------
WD = 'https://acme.wd3.myworkdayjobs.com/Acme_Careers/job/India-Remote/Marketing-Ops-Lead_R123'
WD_RECORD = {'jobPostingInfo': {'location': 'IND-Hyderabad-Tech Park', 'remoteType': 'Hybrid: Work in Office Part-Time', 'country': {'descriptor': 'India'}}}
ASHBY_HTML = ('<script>window.__appData = {"posting":{"locationName":"Bengaluru Office","workplaceType":"Hybrid","isRemote":true}}</script>'
              '<script type="application/ld+json">{"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"@type":"Country","name":"India"}}</script>')


def ats_urlopen(routes):
    """routes: url -> (status, body). Anything else answers 200 with an empty page."""
    def opener(req, timeout=20):
        url = req.full_url
        status, body = routes.get(url, (200, b''))
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        if status >= 400:
            import io
            raise urllib.error.HTTPError(url, status, 'x', {}, io.BytesIO(body))
        r = mock.MagicMock()
        r.__enter__.return_value = r
        r.geturl.return_value = url
        r.status = status
        r.read.return_value = body
        return r
    return opener


class EmployerRecord(unittest.TestCase):
    def run_probe(self, url, routes):
        facts = {}
        with mock.patch.object(liveness.urllib.request, 'urlopen', ats_urlopen(routes)):
            state, _ = liveness.probe(url, facts=facts)
        return state, facts

    def test_workday_record_gives_the_remote_type_and_country_and_says_when_a_posting_was_taken_down(self):
        rec = liveness.workday_record_url(WD)
        self.assertEqual(rec, 'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/job/India-Remote/Marketing-Ops-Lead_R123')
        self.assertEqual(liveness.workday_record_url('https://acme.wd3.myworkdayjobs.com/en-US/Acme_Careers/job/X_R1'),
                         'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Acme_Careers/job/X_R1', 'a locale segment is not the site')
        self.assertEqual(self.run_probe(WD, {rec: (200, WD_RECORD)}), ('alive', {'workplace': 'HYBRID', 'location': 'IND-Hyderabad-Tech Park', 'countries': ['India']}))
        self.assertEqual(self.run_probe(WD, {rec: (404, {'errorCode': 'S21', 'httpStatus': 404})})[0], 'dead', 'not found')
        # review of PR #238: a 404 that is not Workday's own 'not found' answer (a record URL built wrongly, a proxy page) never closes the job
        self.assertEqual(self.run_probe(WD, {rec: (404, b'<html>Not Found</html>'), WD: (200, b'')})[0], 'alive')
        self.assertEqual(self.run_probe(WD, {rec: (404, b'<html>Not Found</html>'), WD: (403, b'')})[0], 'unknown')
        self.assertEqual(self.run_probe(WD, {rec: (403, {'errorCode': 'S22', 'httpStatus': 403, 'message': 'permission denied'})})[0], 'dead', 'no longer public')
        # near misses: a bare 403, a 5xx or a 429 from the record falls back to the page, which never closes on a guess
        self.assertEqual(self.run_probe(WD, {rec: (403, b'<html>blocked</html>'), WD: (200, b'')})[0], 'alive')
        self.assertEqual(self.run_probe(WD, {rec: (503, b''), WD: (404, b'')})[0], 'dead')
        self.assertEqual(self.run_probe(WD, {rec: (429, b''), WD: (200, b'')})[0], 'alive', 'any other error falls back to the page')
        self.assertEqual(self.run_probe(WD, {rec: (429, b''), WD: (429, b'')})[0], 'unknown')
        self.assertIsNone(liveness.workday_record_url('https://jobs.lever.co/acme/1'))

    def test_ashby_greenhouse_and_lever_records(self):
        url = 'https://jobs.ashbyhq.com/acme/3cbddc0b-20b7-4eb1-8eb7-989ebf62f2f7'
        self.assertEqual(self.run_probe(url, {url: (200, ASHBY_HTML.encode())}),
                         ('alive', {'workplace': 'HYBRID', 'location': 'Bengaluru Office', 'countries': ['India']}), "Ashby's workplace type wins over its TELECOMMUTE tag")
        gh = 'https://job-boards.greenhouse.io/acme/jobs/5295050007'
        st, f = self.run_probe(gh, {'https://boards-api.greenhouse.io/v1/boards/acme/jobs/5295050007': (200, {'location': {'name': 'Remote US'}})})
        self.assertEqual((st, f), ('alive', {'workplace': 'REMOTE', 'location': 'Remote US', 'countries': ['United States']}))
        self.assertTrue(liveness.not_remote_from_india(f))
        lv = 'https://jobs.lever.co/acme/ac0a4a5e-3139-4862-a554-3bba3f10dfe9/apply'
        st, f = self.run_probe(lv, {'https://api.lever.co/v0/postings/acme/ac0a4a5e-3139-4862-a554-3bba3f10dfe9':
                                    (200, {'workplaceType': 'remote', 'country': 'IN', 'categories': {'location': 'India'}})})
        self.assertEqual(f, {'workplace': 'REMOTE', 'location': 'India', 'countries': ['India']})
        self.assertFalse(liveness.not_remote_from_india(f))
        # a failing record adds nothing and never decides open or closed
        self.assertEqual(self.run_probe(lv, {'https://api.lever.co/v0/postings/acme/ac0a4a5e-3139-4862-a554-3bba3f10dfe9': (404, b'')}), ('alive', {}))

    def test_check_keeps_the_records_and_the_sql_writes_contradictions_once(self):
        rec = liveness.workday_record_url(WD)
        gh = 'https://job-boards.greenhouse.io/acme/jobs/1'
        routes = {rec: (200, WD_RECORD), 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/1': (200, {'location': {'name': 'Remote US'}})}
        with mock.patch.object(liveness.urllib.request, 'urlopen', ats_urlopen(routes)), mock.patch.object(liveness.time, 'sleep', lambda *_: None):
            res = liveness.check([{'id': 'wd', 'url': WD}, {'id': 'gh', 'url': gh}, {'id': 'plain', 'url': 'https://jobs.example/ok'}], pause=0)
        self.assertEqual(sorted(res['alive']), ['gh', 'plain', 'wd'])
        self.assertEqual(sorted(res['facts']), ['gh', 'wd'])
        res['facts']['it'] = {'workplace': 'ONSITE', 'location': 'Pessione', 'countries': ['Italy']}
        res['facts']['in'] = {'workplace': 'ONSITE', 'location': 'Pune', 'countries': ['India']}
        res['alive'] += ['it', 'in']
        db = sqlite3.connect(':memory:')
        db.executescript("""CREATE TABLE jobs(id TEXT PRIMARY KEY, is_active INT, expired_at TEXT, last_verified_at TEXT, workplace_type TEXT, location_restrictions TEXT);
          CREATE TABLE applications(job_id TEXT); CREATE TABLE candidate_qualifications(job_id TEXT, manual_override_status TEXT, qualification_status TEXT, qualification_reason TEXT);
          CREATE TABLE candidate_job_scores(candidate_id TEXT, job_id TEXT, score_breakdown TEXT);
          CREATE TABLE cache_state(id INT, generation INT); INSERT INTO cache_state VALUES (1, 0);
          INSERT INTO jobs(id, is_active, workplace_type, location_restrictions) VALUES ('wd',1,'REMOTE_RESTRICTED','IND - India Remote Office'),
            ('gh',1,'REMOTE_RESTRICTED','Remote, India'),('plain',1,'REMOTE','Remote'),('it',1,'UNKNOWN','Pessione'),('in',1,'UNKNOWN','Pune');""")
        m = liveness._marker()
        for j in ('wd', 'gh', 'plain', 'it', 'in'):
            db.execute('INSERT INTO candidate_job_scores VALUES (?,?,?)', ('farhan_shaikh', j, json.dumps({'preliminary': True, m: True}, separators=(',', ':'))))   # stored as JSON.stringify writes it
        sql = liveness.to_sql(res, now='2026-11-20T00:00:00Z')
        db.executescript(sql)
        rows = {r[0]: r[1:] for r in db.execute('SELECT id, workplace_type, location_restrictions FROM jobs')}
        self.assertEqual(rows['wd'], ('HYBRID', 'IND-Hyderabad-Tech Park (Hybrid)'))
        self.assertEqual(rows['gh'], ('REMOTE_RESTRICTED', 'Remote US (United States)'))
        self.assertEqual(rows['it'], ('UNKNOWN', 'Pessione, Italy'))
        self.assertEqual(rows['plain'], ('REMOTE', 'Remote'))
        self.assertEqual(rows['in'], ('UNKNOWN', 'Pune'), 'an Indian on-site record changes nothing')
        tagged = {r[0]: json.loads(r[1]).get(m) for r in db.execute('SELECT job_id, score_breakdown FROM candidate_job_scores')}
        self.assertEqual(tagged, {'wd': False, 'gh': False, 'it': False, 'plain': True, 'in': True}, 'only a changed job is re-scored')
        db.executescript("UPDATE candidate_job_scores SET score_breakdown = replace(score_breakdown, 'false', 'true');")
        db.executescript(sql)   # the next run: nothing contradicts any more
        self.assertEqual({r[0]: r[1:] for r in db.execute('SELECT id, workplace_type, location_restrictions FROM jobs')}, rows)
        self.assertTrue(all(json.loads(r[0]).get(m) for r in db.execute('SELECT score_breakdown FROM candidate_job_scores')), 'a second run marks nothing again')


class EmployerRecordReview(unittest.TestCase):
    """Review of PR #238."""
    def test_an_application_link_is_read_as_its_posting(self):
        base = 'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Careers/job/Pune/Engineer_R1'
        for u in ('https://acme.wd3.myworkdayjobs.com/Careers/job/Pune/Engineer_R1/apply', 'https://acme.wd3.myworkdayjobs.com/Careers/job/Pune/Engineer_R1/apply/applyManually',
                  'https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Pune/Engineer_R1/'):
            self.assertEqual(liveness.workday_record_url(u), base, u)

    def test_remote_and_home_office_are_read_before_office(self):
        self.assertEqual(liveness._workplace('Remote: Home Office'), 'REMOTE')
        self.assertEqual(liveness._workplace('Work from home'), 'REMOTE')
        self.assertEqual(liveness._workplace('Hybrid: Work in Office Part-Time'), 'HYBRID')
        self.assertEqual(liveness._workplace('On Site'), 'ONSITE')
        self.assertEqual(liveness._workplace('Office based'), 'ONSITE')
        self.assertIsNone(liveness._workplace('Flexible'))

    def test_page_size_and_record_requests_near_the_deadline(self):
        sizes, asked = [], []

        def opener(req, timeout=20):
            asked.append(req.full_url)
            r = mock.MagicMock()
            r.__enter__.return_value = r
            r.geturl.return_value = req.full_url
            r.status = 200
            r.read.side_effect = lambda n=-1: (sizes.append(n), json.dumps({'location': {'name': 'Remote US'}}).encode() if 'boards-api' in req.full_url else b'')[1]
            return r
        with mock.patch.object(liveness.urllib.request, 'urlopen', opener):
            liveness.probe('https://jobs.example/ok', facts={})
            liveness.probe('https://jobs.ashbyhq.com/acme/1', facts={})
            self.assertEqual(sizes[:2], [65536, liveness.ASHBY_PAGE_BYTES], 'only an Ashby page is read past 64 KB')
            f = {}
            liveness.probe('https://job-boards.greenhouse.io/acme/jobs/1', facts=f, records=False)
            self.assertEqual(f, {})
            self.assertFalse(any('boards-api' in u for u in asked), 'no record request near the deadline')
            state, f = liveness._one('https://job-boards.greenhouse.io/acme/jobs/1', 0, records_until=0)
            self.assertEqual((state, f), ('alive', {}))
            state, f = liveness._one('https://job-boards.greenhouse.io/acme/jobs/1', 0, records_until=time.monotonic() + 100)
            self.assertEqual(f.get('location'), 'Remote US')


if __name__ == '__main__':
    unittest.main()

