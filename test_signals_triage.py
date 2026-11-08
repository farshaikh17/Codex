"""engine/signals.py and engine/ai_triage.py: UK register parsing, the taste model, the AI review parser and its SQL. Offline."""
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import ai_triage, signals, more_sources as ms


class Signals(unittest.TestCase):
    def test_uk_register(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'r.csv').write_text('﻿Organisation Name,Town/City,County,Type & Rating,Route\n Drax Group plc ,Selby,,Worker (A rating),Skilled Worker\n'
                                        'Fish Shop Ltd,Hull,,Temporary Worker (A rating),Seasonal Worker\nSSE PLC,Perth,,Worker (A rating),Global Business Mobility: Senior or Specialist Worker\n')
            keys = signals.uk_sponsors(Path(d, 'r.csv'))
            self.assertEqual(keys, {signals.company_key('Drax Group'), signals.company_key('SSE')})

    def test_taste_needs_enough_labels_and_learns(self):
        rows = [{'candidate_id': 'f', 'title': 'RevOps Manager', 'company': 'A', 'label': 'SAVED'}] * 7 + \
               [{'candidate_id': 'f', 'title': 'Zoho CRM Developer', 'company': 'B', 'label': 'INELIGIBLE'}] * 6 + \
               [{'candidate_id': 's', 'title': 'x', 'company': 'y', 'label': 'SAVED'}] * 3
        m = signals.train(rows)
        self.assertTrue(m['f']['active']); self.assertGreater(m['f']['weights']['revops'], 0); self.assertLess(m['f']['weights']['zoho'], 0)
        self.assertFalse(m['s']['active'], 'too few decisions')
        self.assertGreater(signals.taste_score(m['f'], 'RevOps Lead', 'Z'), 0); self.assertLess(signals.taste_score(m['f'], 'Zoho Developer', 'Z'), 0)
        self.assertEqual(signals.taste_score(m['s'], 'x', 'y'), 0.0)


class Triage(unittest.TestCase):
    def test_parse_and_sql(self):
        out = ai_triage.parse('Sure: [{"i":0,"fit":82,"eligible":"yes","why":"Good match."},{"i":1,"fit":20,"eligible":"no","why":"US only."},{"i":9,"fit":50}]', 2)
        self.assertEqual(set(out), {0, 1}); self.assertEqual(out[1]['eligible'], 'no')
        self.assertEqual(ai_triage.parse('no json here', 2), {})
        job = {'candidate_id': 'f', 'job_id': 'j1'}
        db = sqlite3.connect(':memory:')
        db.executescript("""CREATE TABLE candidate_job_scores(candidate_id, job_id, overall_score, score_breakdown, calculated_at);
          CREATE TABLE candidate_qualifications(candidate_id, job_id, qualification_status, manual_override_status, qualification_reason);
          CREATE TABLE applications(candidate_id, job_id); CREATE TABLE cache_state(id, generation);
          INSERT INTO candidate_job_scores VALUES ('f','j1',70,'{"preliminary":true}',NULL),('f','j2',70,'{"preliminary":true}',NULL);
          INSERT INTO candidate_qualifications VALUES ('f','j1','NEEDS_REVIEW',NULL,'Cloud match.'),('f','j2','NEEDS_REVIEW','READY','Cloud match.');""")
        sql = '\n'.join(ai_triage.to_sql(job, out[0], 'now') + ai_triage.to_sql({'candidate_id': 'f', 'job_id': 'j2'}, out[1], 'now'))
        db.executescript(sql); db.executescript(sql)   # idempotent
        self.assertEqual(db.execute("SELECT overall_score FROM candidate_job_scores WHERE job_id='j1'").fetchone()[0], 76)
        self.assertTrue(db.execute("SELECT qualification_reason FROM candidate_qualifications WHERE job_id='j1'").fetchone()[0].startswith('AI review (fit 82, eligibility yes): Good match. Cloud'))
        self.assertIn('ai_review', db.execute("SELECT score_breakdown FROM candidate_job_scores WHERE job_id='j1'").fetchone()[0])
        self.assertEqual(db.execute("SELECT overall_score FROM candidate_job_scores WHERE job_id='j2'").fetchone()[0], 70, 'a decided row is never touched')

    def test_batches_never_mix_candidates(self):
        """7 jobs for one person then 3 for another, batch size 5: the old slicing made [f,f,f,f,f] [f,f,s,s,s]; the second request
        then described the wrong person for three of its five postings."""
        jobs = [{'candidate_id': 'farhan', 'job_id': f'f{i}', 'profile': 'builder'} for i in range(7)] + \
               [{'candidate_id': 'sana', 'job_id': f's{i}', 'profile': 'plant'} for i in range(3)]
        out = list(ai_triage.batches(jobs, 5))
        self.assertEqual([len(b) for b in out], [5, 2, 3])
        for b in out:
            self.assertEqual(len({j['candidate_id'] for j in b}), 1)
            self.assertEqual(len({j['profile'] for j in b}), 1)
        self.assertEqual(sorted(j['job_id'] for b in out for j in b), sorted(j['job_id'] for j in jobs), 'every job is reviewed exactly once')
        self.assertEqual(list(ai_triage.batches([], 5)), [])

    def test_each_request_carries_its_own_candidate_profile(self):
        jobs = [{'candidate_id': 'f', 'job_id': f'f{i}', 'title': 't', 'company': 'c', 'location': 'l', 'description': 'd', 'profile': 'PROFILE_F'} for i in range(7)] + \
               [{'candidate_id': 's', 'job_id': f's{i}', 'title': 't', 'company': 'c', 'location': 'l', 'description': 'd', 'profile': 'PROFILE_S'} for i in range(3)]
        seen = []
        def fake_call(messages, token, timeout=60):
            seen.append(messages[1]['content']); return '[]'
        with tempfile.TemporaryDirectory() as d, mock.patch.object(ai_triage, 'call', fake_call), mock.patch.object(ai_triage.time, 'sleep'), \
                mock.patch.dict('os.environ', {'GITHUB_TOKEN': 'x'}):
            Path(d, 'top.json').write_text(json.dumps(jobs))
            with mock.patch('sys.argv', ['x', '--in', str(Path(d, 'top.json')), '--out', str(Path(d, 't.sql'))]):
                ai_triage.main()
        self.assertEqual(len(seen), 3)
        for text in seen:
            self.assertEqual(('PROFILE_F' in text) + ('PROFILE_S' in text), 1, 'one profile per request')
            self.assertEqual(text.count('PROFILE_F') + text.count('PROFILE_S'), 1)

    def test_bad_replies_are_described_and_stop_after_three(self):
        """The first production run failed all 20 batches with a bare JSONDecodeError and a 'success' mark. Now the reason is printed, and
        three failures in a row stop the review instead of hammering the endpoint for the rest of the list."""
        import io, urllib.error
        class Resp:
            status = 200
            headers = {'Content-Type': 'text/html'}
            def __init__(self, raw): self._raw = raw
            def read(self): return self._raw
            def __enter__(self): return self
            def __exit__(self, *a): return False
        jobs = [{'candidate_id': 'f', 'job_id': f'j{i}', 'title': 't', 'company': 'c', 'location': 'l', 'description': 'd', 'profile': 'p'} for i in range(40)]
        calls = []
        def fake_urlopen(req, timeout=0):
            calls.append(1); return Resp(b'<html><body>Sign in to GitHub</body></html>')
        with tempfile.TemporaryDirectory() as d, mock.patch.object(ai_triage.urllib.request, 'urlopen', fake_urlopen), mock.patch.object(ai_triage.time, 'sleep'), \
                mock.patch.dict('os.environ', {'GITHUB_TOKEN': 'x'}), mock.patch('sys.stdout', new_callable=io.StringIO) as out, mock.patch('sys.stderr', new_callable=io.StringIO) as err:
            Path(d, 'top.json').write_text(json.dumps(jobs))
            with mock.patch('sys.argv', ['x', '--in', str(Path(d, 'top.json')), '--out', str(Path(d, 't.sql'))]):
                ai_triage.main()
        rep = json.loads(out.getvalue().strip().splitlines()[-1])
        self.assertEqual(len(calls), 3, 'stopped after three failures in a row, not 8 batches')
        self.assertEqual(rep['reviewed'], 0); self.assertEqual(rep['failed_batches'], 3)
        self.assertIn('Sign in to GitHub', rep['failure_samples'][0]); self.assertIn('text/html', rep['failure_samples'][0])

    def test_probe_reports_failure_and_success(self):
        import io
        class Resp:
            status = 200
            headers = {'Content-Type': 'application/json'}
            def __init__(self, raw): self._raw = raw
            def read(self): return self._raw
            def __enter__(self): return self
            def __exit__(self, *a): return False
        good = json.dumps({'choices': [{'message': {'content': 'ready'}}]}).encode()
        for raw, expect, rc in ((good, 'ok', 0), (b'', 'failed', 1)):
            with mock.patch.object(ai_triage.urllib.request, 'urlopen', lambda req, timeout=0, raw=raw: Resp(raw)), mock.patch.dict('os.environ', {'GITHUB_TOKEN': 'secret-token'}), \
                    mock.patch('sys.stdout', new_callable=io.StringIO) as out, mock.patch('sys.argv', ['x', '--in', 'a', '--out', 'b', '--probe']):
                self.assertEqual(ai_triage.main(), rc)
            self.assertEqual(json.loads(out.getvalue())['probe'], expect)
            self.assertNotIn('secret-token', out.getvalue())

    def test_probe_needs_no_input_files_but_a_review_run_does(self):
        import io
        with mock.patch('sys.argv', ['x', '--probe']), mock.patch.dict('os.environ', {'GITHUB_TOKEN': ''}), mock.patch('sys.stdout', new_callable=io.StringIO) as out:
            self.assertEqual(ai_triage.main(), 1)   # no token: it fails visibly, but it did not complain about missing --in/--out
        self.assertEqual(json.loads(out.getvalue())['probe'], 'failed')
        with mock.patch('sys.argv', ['x']), mock.patch('sys.stderr', new_callable=io.StringIO):
            with self.assertRaises(SystemExit):
                ai_triage.main()

    def test_no_token_writes_nothing(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'top.json').write_text('[{"candidate_id":"f","job_id":"j","title":"t","company":"c","location":"l","description":"d","profile":"p"}]')
            with mock.patch.dict('os.environ', {'GITHUB_TOKEN': ''}), mock.patch('sys.argv', ['x', '--in', str(Path(d, 'top.json')), '--out', str(Path(d, 't.sql'))]):
                ai_triage.main()
            self.assertEqual(Path(d, 't.sql').read_text(), '')


class Eures(unittest.TestCase):
    def test_parse(self):
        payload = {'jvs': [{'id': 'abc', 'title': 'Instandhaltungsingenieur', 'creationDate': '1793690760202', 'locationMap': {'DE': ['DE1']},
                            'employer': {'name': 'Kraftwerk GmbH'}, 'translations': {'en': {'title': 'Maintenance Engineer', 'description': 'Plant <b>work</b>'}}}]}
        with mock.patch.object(ms, 'http', lambda *a, **k: json.dumps(payload).encode()):
            rows = list(ms.eures({'sana_ansari': ['maintenance engineer']}))
        self.assertEqual(len(rows), 1); j = rows[0]
        self.assertEqual((j['title'], j['company'], j['location'], j['ats_type']), ('Maintenance Engineer', 'Kraftwerk GmbH', 'DE', 'eures'))
        self.assertTrue(j['url'].endswith('/jv-details/abc?lang=en')); self.assertEqual(j['description'], 'Plant work')

    def test_adzuna_off_without_keys(self):
        with mock.patch.dict('os.environ', {'ADZUNA_APP_ID': '', 'ADZUNA_APP_KEY': ''}):
            self.assertEqual(list(ms.adzuna({'sana_ansari': [('gb', 'x')]})), [])


if __name__ == '__main__':
    unittest.main()
