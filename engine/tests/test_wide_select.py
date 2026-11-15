"""Wide intake (14 Nov 2026): the dataset selection pre-scores every role-matching posting in any country and imports every one that can plausibly
fit, best fit first, within a cap set by the D1 read budget. The pre-score itself is the Worker's evaluate() (dashboard/scripts/prescore.mjs, tested
in dashboard/test/prescore.test.mjs); here a fake scorer stands in for it. The SQL tests need DuckDB and are skipped without it (the offline CI)."""
import argparse
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd

try:
    import duckdb
except ImportError:   # the offline CI has no DuckDB
    duckdb = None

ROOT = Path(__file__).resolve().parents[2]


def pre(score, band='remote', status='NEEDS_REVIEW', eligibility='UNKNOWN'):
    return {'score': score, 'status': status, 'eligibility': eligibility, 'band': band}


def row(title, posted='2026-11-10', **pre_kw):
    return {'title': title, 'url': 'https://x.example/' + title, 'posted_at': posted, '_pre': pre(**pre_kw)}


class FitFloor(unittest.TestCase):
    def test_near_the_threshold_and_above_the_low_match_line(self):
        self.assertEqual(dd.fit_floor(70), 55)
        self.assertEqual(dd.fit_floor(65), 50)
        self.assertEqual(dd.fit_floor(55), 46, 'never at or below the line where dataset_apply holds a row as a low match')


class Pick(unittest.TestCase):
    def test_best_fit_first_and_undated_rows_not_last(self):
        rows = [row('old', '2026-10-01', score=80), row('undated', None, score=80), row('low', '2026-11-12', score=60), row('new', '2026-11-12', score=80)]
        got = [r['title'] for r in dd.pick(rows, 10)]
        self.assertEqual(got[-1], 'low', 'fit decides first')
        self.assertLess(got.index('undated'), got.index('old'), 'an undated live posting counts as today, never after the dated ones')

    def test_eligible_before_unknown_at_the_same_score(self):
        rows = [row('unknown', score=70), row('eligible', score=70, eligibility='ELIGIBLE')]
        self.assertEqual([r['title'] for r in dd.pick(rows, 10)], ['eligible', 'unknown'])

    def test_place_sets_go_first_when_the_cap_binds(self):
        rows = [row(f'abroad{i}', score=90, band='other') for i in range(10)] + [row(f'gulf{i}', score=60, band='gulf') for i in range(5)]
        got = dd.pick(rows, 6, [('gulf', ('gulf',), 0.5)])
        self.assertEqual(len(got), 6)
        self.assertEqual(sum(1 for r in got if r['title'].startswith('gulf')), 3, 'the Gulf set keeps its share although its rows score lower')
        self.assertEqual(got[0]['title'][:6], 'abroad', 'the result is still in fit order')

    def test_no_cap_no_rows(self):
        self.assertEqual(dd.pick([row('a', score=90)], 0), [])


class FakeCon:
    """Stands in for DuckDB: every query returns the given rows (the role rule is applied by the real SQL; see SelectSql below)."""
    def __init__(self, rows):
        self.rows = rows
        self.description = None

    def execute(self, sql, params=None):
        cols = list(self.rows[0].keys())
        self.description = [(c,) for c in cols]
        self._out = [tuple(r[c] for c in cols) for r in self.rows]
        return self

    def fetchall(self):
        return self._out


def dataset_row(title, location, country='', remote='', posted='2026-11-10'):
    return {'url': 'https://jobs.example/' + re.sub(r'\W+', '-', title + location), 'title': title, 'company': 'Acme', 'ats_type': 'workday', 'location': location,
            'country_iso': country, 'remote_flag': remote, 'description': 'text', 'posted_at': posted, 'salary_min': None, 'salary_max': None,
            'salary_currency': None, 'salary_period': None, 'salary_summary': None, 'apply_url': None, 'employment_type': None}


class SelectWide(unittest.TestCase):
    ROWS = [dataset_row('Maintenance Manager', 'Gurugram, HR'), dataset_row('Plant Engineer', 'Lagos, Nigeria'),
            dataset_row('Reliability Engineer', 'Houston, TX'), dataset_row('O&M Engineer', 'Ruwais, AE', posted=None)]

    def scorer(self, items):
        # Sana's place rules, as the Worker applies them: India and the Gulf are workable, abroad needs a stated visa route (here: Lagos says so).
        table = {'Gurugram, HR': pre(80, 'india_onsite', eligibility='ELIGIBLE'), 'Lagos, Nigeria': pre(72, 'abroad_with_route', eligibility='ELIGIBLE'),
                 'Houston, TX': pre(45, 'other'), 'Ruwais, AE': pre(66, 'gulf')}
        return [{'k': k, 'cid': cid, **table[r['location']]} for k, (cid, r) in enumerate(items)]

    def test_any_country_the_place_rules_decide(self):
        stats = {}
        got = dd.select_wide(FakeCon(self.ROWS), 'x.parquet', {'sana_ansari': dict(dd.BUILTIN['sana_ansari'])},
                             [{'id': 'sana_ansari', 'qualification_threshold': 65}], 45, 100_000, self.scorer, stats)
        titles = [r['title'] for r in got['sana_ansari']]
        self.assertEqual(titles, ['Maintenance Manager', 'Plant Engineer', 'O&M Engineer'],
                         'an Indian city with no country, an African posting with a visa route and an undated Gulf row all go in, best fit first')
        self.assertNotIn('Reliability Engineer', titles, 'on site abroad with no route: capped by the screen, below her floor')
        self.assertEqual(stats['sana_ansari']['read'], 4)
        self.assertEqual(stats['sana_ansari']['plausible'], 3)
        self.assertEqual(stats['sana_ansari']['cap'], 100_000 // dd.SELECT_READS_PER_ROW)
        self.assertEqual(stats['sana_ansari']['by_band'], {'india_onsite': 1, 'abroad_with_route': 1, 'gulf': 1})
        self.assertIs(got['sana_ansari'][0]['is_remote'], None, 'rows come out in the shape the import expects')

    def test_the_cap_comes_from_the_read_budget_and_is_shared(self):
        stats = {}
        profs = {'sana_ansari': dict(dd.BUILTIN['sana_ansari']), 'farhan_shaikh': dict(dd.BUILTIN['farhan_shaikh'])}
        dd.select_wide(FakeCon(self.ROWS), 'x.parquet', profs, [], 45, dd.SELECT_READS_PER_ROW * 4, self.scorer, stats)
        self.assertEqual(stats['sana_ansari']['cap'], 2)
        self.assertEqual(stats['sana_ansari']['picked'], 2)

    def test_ineligible_rows_never_go_in(self):
        def scorer(items):
            return [{'k': k, 'cid': c, **pre(90, status='INELIGIBLE')} for k, (c, _) in enumerate(items)]
        got = dd.select_wide(FakeCon(self.ROWS), 'x.parquet', {'farhan_shaikh': dict(dd.BUILTIN['farhan_shaikh'])}, [], 45, 100_000, scorer)
        self.assertEqual(got['farhan_shaikh'], [])


class Fallback(unittest.TestCase):
    def test_a_failed_pre_score_falls_back_to_the_quotas(self):
        def broken(items):
            raise RuntimeError('node missing')
        a = argparse.Namespace(no_prescore=False, dataset='x.parquet', max_days=45, select_read_budget=1000, home_quota=1, remote_quota=1, abroad_quota=1, gulf_quota=1)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(dd, 'select_quota', return_value=[{'title': 'q'}]) as q:
            Path(d, 'candidates.json').write_text('[]')
            picked, rep = dd.wide_or_quota(FakeCon(SelectWide.ROWS), a, {'sana_ansari': dd.BUILTIN['sana_ansari']}, Path(d), scorer=broken)
        self.assertEqual(rep['mode'], 'quota')
        self.assertEqual(picked, {'sana_ansari': [{'title': 'q'}]})
        q.assert_called_once()


class WorkerPlaceLists(unittest.TestCase):
    """The fallback's India and Gulf tests are read from the Worker's own lists; dashboard/test/place_lists.test.mjs checks the same fixture there."""
    CASES = json.loads((ROOT / 'engine' / 'tests' / 'fixtures' / 'place_cases.json').read_text())

    def test_read_from_the_worker(self):
        words = dd.india_place_words()
        for w in ('india', 'gurugram', 'pithampur' if 'pithampur' in words else 'chakan', 'jamnagar', 'mundra'):
            self.assertIn(w, words)
        self.assertIn('ruwais', dd.gulf_place_source())

    def test_same_cases_as_the_worker(self):
        for c in self.CASES:
            loc = c['location']
            india = bool(re.search(dd.INDIA_LOC, loc.lower()))
            gulf = bool(re.search(dd.GULF_LOC, loc.lower())) or bool(re.search(r',\s*(AE|QA|OM|KW|BH)\s*$', loc))
            self.assertEqual(india, c['india'], loc)
            self.assertEqual(gulf, c['gulf'], loc)


@unittest.skipUnless(duckdb, 'DuckDB is not installed')
class SelectSql(unittest.TestCase):
    """The real SQL on a small parquet file."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.src = str(Path(self.tmp.name) / 'd.parquet')
        rows = [dataset_row('Maintenance Manager', 'Gurugram, HR'), dataset_row('Electrical Maintenance Engineer', 'Pithampur, IN'),
                dataset_row('O&M Engineer', 'Ruwais, AE', posted=None), dataset_row('O&M Engineer', 'Abu Dhabi', country='AE', posted=None),
                dataset_row('Plant Engineer', 'Lagos, Nigeria', country='NG'), dataset_row('Chef', 'Pune, India', country='IN'),
                dataset_row('Reliability Engineer', 'Austin, TX', country='US', posted='2026-11-12')]
        con = duckdb.connect()
        con.execute('CREATE TABLE t AS SELECT * FROM (VALUES ' + ','.join(
            '(' + ','.join("NULL" if r[k] is None else "'" + str(r[k]).replace("'", "''") + "'" for k in
                           ('url', 'title', 'company', 'ats_type', 'location', 'country_iso', 'remote_flag', 'description', 'posted_at')) + ')' for r in rows)
            + ') v(url, title, company, ats_type, location, country_iso, is_remote, description, posted_at)')
        con.execute(f"COPY (SELECT *, NULL AS salary_min, NULL AS salary_max, NULL AS salary_currency, NULL AS salary_period, NULL AS salary_summary, "
                    f"NULL AS apply_url, NULL AS employment_type FROM t) TO '{self.src}' (FORMAT PARQUET)")
        self.con = duckdb.connect()

    def tearDown(self):
        self.tmp.cleanup()

    def test_candidate_rows_any_country_role_rule_only(self):
        got = {(r['title'], r['location']) for r in dd.candidate_rows(self.con, self.src, dd.BUILTIN['sana_ansari'], 45)}
        self.assertIn(('Plant Engineer', 'Lagos, Nigeria'), got)
        self.assertIn(('O&M Engineer', 'Ruwais, AE'), got, 'undated rows are read')
        self.assertNotIn(('Chef', 'Pune, India'), got, 'the role rule still applies')

    def test_quota_fallback_india_by_the_workers_places_and_a_gulf_quota(self):
        p = dd.BUILTIN['sana_ansari']
        home = {r['location'] for r in dd.select_quota(self.con, self.src, p, 10, 0, 45, 0, 0)}
        self.assertEqual(home, {'Gurugram, HR', 'Pithampur, IN'}, 'Indian places with no country code are home rows')
        gulf = [r['location'] for r in dd.select_quota(self.con, self.src, p, 0, 0, 45, 0, 5)]
        self.assertEqual(sorted(gulf), ['Abu Dhabi', 'Ruwais, AE'], 'undated Gulf rows have their own quota')


if __name__ == '__main__':
    unittest.main()
