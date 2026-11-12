"""Offline checks of engine/dataset_discovery.py: the built-in searches select the intended role families and reject the
look-alikes found in the first real run, and the home-country match is a whole word (India, not Indiana)."""
import re
import unittest

from engine.dataset_discovery import BUILTIN, INSIDE, kw_regex, job_id, clean, profiles  # noqa: F401


def picks(cid, title):
    p = BUILTIN[cid]
    t = title.lower()
    return bool(re.search(p['role'], t)) and not (p.get('exclude') and re.search(p['exclude'], t))


class Searches(unittest.TestCase):
    def test_farhan(self):
        for t in ['Senior Implementation Consultant', 'Solutions Engineer', 'Zoho CRM Developer', 'Revenue Operations Analyst',
                  'Integration Specialist', 'Business Systems Analyst: Salesforce', 'Technical Operations Manager']:
            self.assertTrue(picks('farhan_shaikh', t), t)
        for t in ['Operations Executive (PUW)', 'Warehouse Operations Associate', 'QA Automation Engineer', 'Site Reliability Engineer',
                  'Software Engineer, Integrations', 'Team Sales Manager']:
            self.assertFalse(picks('farhan_shaikh', t), t)

    def test_sana(self):
        for t in ['Repair & Maintenance Engineer', 'Commissioning Engineer', 'Solar O&M Engineer', 'Electrical Engineer – Power System Studies',
                  'Maintenance Manager', 'Substation Engineer']:
            self.assertTrue(picks('sana_ansari', t), t)
        for t in ['Site Reliability Engineer', 'Customer Reliability Engineer', 'Product Reliability Engineer', 'Power BI Developer',
                  'Network Reliability Engineer', 'Commercial Energy Sales Executive']:
            self.assertFalse(picks('sana_ansari', t), t)

    def test_home_is_a_whole_word_and_values_are_parameters(self):
        self.assertIn('$home', INSIDE)
        self.assertIn('$countries', INSIDE)
        word = re.compile('(^|[^a-z])' + re.escape('india') + '([^a-z]|$)')
        self.assertTrue(word.search('pune, india'))
        self.assertFalse(word.search('indianapolis, in'))
        self.assertFalse(word.search('fort wayne, indiana'))

    def test_client_keywords_with_quotes_build_valid_patterns(self):
        rx = kw_regex(["women's health", 'c++ developer', 'data (bi) analyst'])
        self.assertTrue(re.search(rx, "senior women's health program lead"))
        self.assertTrue(re.search(rx, 'c++ developer'))
        self.assertTrue(re.search(rx, 'data (bi) analyst'))
        self.assertIsNone(kw_regex(['', '  ']))

    def test_fields_are_bounded_and_control_characters_removed(self):
        j = clean({'title': 'A\x00B\x07C', 'description': 'x' * 10000, 'salary_summary': 's' * 50000, 'url': 'https://x/' + 'a' * 5000})
        self.assertEqual(j['title'], 'A B C')
        self.assertEqual(len(j['description']), 6000)
        self.assertEqual(len(j['salary_summary']), 300)
        self.assertEqual(len(j['url']), 2000)

    def test_ids_are_stable(self):
        self.assertEqual(job_id('greenhouse', 'https://x/1'), job_id('greenhouse', 'https://x/1'))
        self.assertNotEqual(job_id('greenhouse', 'https://x/1'), job_id('greenhouse', 'https://x/2'))
        self.assertTrue(job_id('lever', 'https://x/1').startswith('ds:lever:'))


if __name__ == '__main__':
    unittest.main()


class RescorePaging(unittest.TestCase):
    """rescore_rows: per person, best-ranked first, capped, paged by (score, job) and never by OFFSET; rows already scored with the
    current profile and rules (profile_v8) and rows with an application are left out."""

    def _db(self):
        import sqlite3
        db = sqlite3.connect(':memory:'); db.row_factory = sqlite3.Row
        db.executescript("""
          CREATE TABLE candidates(id TEXT PRIMARY KEY, primary_skills TEXT);
          CREATE TABLE jobs(id TEXT PRIMARY KEY, title TEXT, company TEXT, salary_min REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT,
                            location_restrictions TEXT, description TEXT, workplace_type TEXT, is_active INTEGER);
          CREATE TABLE candidate_qualifications(candidate_id TEXT, job_id TEXT, qualification_status TEXT, manual_override_status TEXT);
          CREATE TABLE candidate_job_scores(candidate_id TEXT, job_id TEXT, overall_score INTEGER, score_breakdown TEXT);
          CREATE TABLE applications(candidate_id TEXT, job_id TEXT);
          INSERT INTO candidates VALUES ('farhan', '["a"]'), ('sana', '["b"]'), ('noskills', '[]');""")
        for c in ('farhan', 'sana', 'noskills'):
            for i in range(23):
                db.execute("INSERT OR IGNORE INTO jobs VALUES (?,?,?,NULL,NULL,NULL,NULL,'x','d','REMOTE',1)", (f'j{i:02d}', 't', 'c'))
                db.execute("INSERT INTO candidate_qualifications VALUES (?,?, 'NEEDS_REVIEW', NULL)", (c, f'j{i:02d}'))
                bd = '{"preliminary":true,"profile_v8":true}' if i % 5 == 0 else '{"preliminary":true,"profile_v3":true}'
                db.execute("INSERT INTO candidate_job_scores VALUES (?,?,?,?)", (c, f'j{i:02d}', (i * 7) % 11, bd))
        db.execute("INSERT INTO applications VALUES ('farhan','j01')")
        db.execute("UPDATE candidate_qualifications SET manual_override_status='READY' WHERE candidate_id='sana' AND job_id='j02'")
        # columns the legacy-row export reads (rescore_rows also returns never-scored first-import rows; this fixture has none: every row is 'preliminary')
        db.executescript("ALTER TABLE jobs ADD COLUMN provenance TEXT; ALTER TABLE jobs ADD COLUMN source_adapter TEXT; ALTER TABLE candidate_qualifications ADD COLUMN qualification_reason TEXT;")
        return db

    def _run(self, db, **kw):
        from unittest import mock
        from engine import dataset_discovery as dd
        calls = []
        def fake_d1(sql, local=None):
            calls.append(sql)
            return [dict(r) for r in db.execute(sql).fetchall()]
        with mock.patch.object(dd, 'd1', fake_d1):
            return dd.rescore_rows(**kw), calls

    def test_best_first_paged_and_complete(self):
        db = self._db()
        small, calls = self._run(db, page=3, per_candidate=1000)
        big, _ = self._run(db, page=1000, per_candidate=1000)
        key = lambda r: (r['candidate_id'], r['job_id'])
        self.assertEqual([key(r) for r in small], [key(r) for r in big], 'paging does not change the result')
        self.assertEqual(len({key(r) for r in small}), len(small), 'no row twice')
        keys = {key(r) for r in small}
        self.assertNotIn(('farhan', 'j01'), keys, 'an application is never re-scored')
        self.assertNotIn(('sana', 'j02'), keys, 'a hand-set status is never re-scored')
        self.assertFalse({k for k in keys if k[1] in {f'j{i:02d}' for i in range(0, 23, 5)}}, 'rows already on the current profile are left out')
        self.assertNotIn('noskills', {k[0] for k in keys}, 'a person with no stored skills is skipped')
        for cid in ('farhan', 'sana'):
            scores = [r['cur_score'] for r in small if r['candidate_id'] == cid]
            self.assertEqual(scores, sorted(scores, reverse=True), 'best-ranked first')
        self.assertTrue(all('OFFSET' not in c for c in calls)); self.assertGreater(len(calls), 3, 'it did page')

    def test_cap_per_candidate(self):
        db = self._db()
        rows, _ = self._run(db, page=2, per_candidate=5)
        for cid in ('farhan', 'sana'):
            self.assertEqual(len([r for r in rows if r['candidate_id'] == cid]), 5)
        full, _ = self._run(db, page=100, per_candidate=1000)
        best = {c: [r['job_id'] for r in full if r['candidate_id'] == c][:5] for c in ('farhan', 'sana')}
        for cid in ('farhan', 'sana'):
            self.assertEqual([r['job_id'] for r in rows if r['candidate_id'] == cid], best[cid], 'the capped set is the top of the uncapped list')
