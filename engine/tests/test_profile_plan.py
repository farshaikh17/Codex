"""Discovery from a profile config (dashboard/docs/MULTI_CANDIDATE.md section 6): engine/profile_plan.py builds a person's searches from their
config, dataset_discovery.profiles() writes them into work/profiles.json, and a database without the 0028 table reads as no configs.
The config is the synthetic example profile (tests only; no real person)."""
import contextlib
import io
import json
import re
import unittest
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd
from engine import profile_plan as pp

EXAMPLE = Path(__file__).resolve().parents[2] / 'dashboard' / 'test' / 'profiles' / 'example_data_analyst_remote_eu.json'


class Plan(unittest.TestCase):
    def setUp(self):
        self.cfg = json.loads(EXAMPLE.read_text())

    def test_plan_from_config(self):
        p = pp.plan(self.cfg, {'target_roles': '[]'}, dd.BUILTIN)
        role, exclude = re.compile(p['role'], re.I), re.compile(p['exclude'], re.I)
        self.assertTrue(role.search('senior data analyst'))
        self.assertFalse(role.search('nurse'))
        self.assertTrue(exclude.search('data engineer'))
        self.assertEqual(p['countries'], ['NL', 'DE'])
        self.assertEqual(p['mode'], 'HOME_OR_RELOCATE')
        self.assertLessEqual(len(p['jobspy']), pp.MAX_JOBSPY)
        self.assertEqual(p['jobspy'][1][1], 'Germany', 'searches alternate between the countries')
        self.assertLessEqual(len(p['workable']), pp.MAX_WORKABLE)
        self.assertLessEqual(len(p['workable_places']), pp.MAX_WORKABLE_PLACES)
        self.assertTrue(p['eures'] and len(p['eures']) <= pp.MAX_EURES)
        self.assertLessEqual(len(p['adzuna']), pp.MAX_ADZUNA)
        self.assertEqual((p['max_rows'], p['max_selected']), (5000, 200))

    def test_remote_only_and_builtin_packs(self):
        cfg = {'schema': 1, 'field': {'packs': ['revops_automation']}, 'place': [{'policy': 'remote_from_country', 'country': 'IN'}]}
        p = pp.plan(cfg, {'target_roles': json.dumps(['Implementation Manager'])}, dd.BUILTIN)
        self.assertTrue(p['remote_only'])
        self.assertEqual(p['mode'], 'REMOTE_FROM_HOME')
        self.assertTrue(re.search(p['role'], 'revenue operations manager'), 'the built-in field pack brings its dataset role rule')
        self.assertTrue(all(q[0].endswith(' remote') for q in p['jobspy']))
        self.assertEqual(p['workable_places'], [])
        self.assertEqual(p['max_selected'], pp.DEFAULT_MAX_SELECTED)

    def test_engine_rule_matches_the_worker(self):
        R = '"resolved":true'
        self.assertIsNone(pp.engine_config('{"schema":1,"extends":"legacy:farhan_shaikh",%s}' % R, 'farhan_shaikh'))
        self.assertIsNotNone(pp.engine_config('{"schema":1,"extends":"legacy:farhan_shaikh","engine":"profile",%s}' % R, 'farhan_shaikh'))
        self.assertIsNotNone(pp.engine_config('{"schema":1,%s}' % R, 'someone_new'))
        self.assertIsNone(pp.engine_config('{"schema":1,"engine":"legacy",%s}' % R, 'someone_new'))
        # review 4/8: a config not written by profile_config.mjs (not resolved), or a built-in id without its own base, is not used
        self.assertIsNone(pp.engine_config('{"schema":1}', 'someone_new'))
        self.assertIsNone(pp.engine_config('{"schema":1,"engine":"profile",%s}' % R, 'farhan_shaikh'))
        self.assertIsNone(pp.engine_config('{"schema":1,"extends":"legacy:sana_ansari","engine":"profile",%s}' % R, 'farhan_shaikh'))
        self.assertIsNone(pp.engine_config('{not json', 'someone_new'))


class Profiles(unittest.TestCase):
    def test_profiles_json_gets_the_config_searches(self):
        cfg = json.dumps({**json.loads(EXAMPLE.read_text()), 'resolved': True})

        def d1(sql, local=None):
            if 'candidate_profile_configs' in sql:
                return [{'candidate_id': 'example_x', 'config': cfg}, {'candidate_id': 'farhan_shaikh', 'config': '{"schema":1,"extends":"legacy:farhan_shaikh"}'}]
            return [{'id': 'example_x', 'primary_skills': '[]', 'target_roles': '[]', 'search_profile': None, 'visibility': 'private'},
                    {'id': 'farhan_shaikh', 'primary_skills': '[]', 'target_roles': '[]', 'search_profile': None, 'visibility': 'public'}]
        with mock.patch.object(dd, 'd1', d1):
            profs = dd.profiles()
        self.assertTrue(profs['example_x']['profile_engine'])
        self.assertEqual(profs['example_x']['jobspy'][0][0], 'data analyst')
        self.assertEqual(profs['farhan_shaikh']['role'], dd.BUILTIN['farhan_shaikh']['role'], 'the built-in people keep their tables')

    def test_a_config_without_a_role_rule_is_skipped_with_a_warning(self):
        # review 3: plan() returns None, profiles() skips that person and the others still get their entries
        self.assertIsNone(pp.plan({'schema': 1, 'field': {'packs': ['keyword']}}, {'target_roles': '[]'}, dd.BUILTIN))
        bad = json.dumps({'schema': 1, 'resolved': True, 'field': {'packs': ['keyword']}})
        good = json.dumps({**json.loads(EXAMPLE.read_text()), 'resolved': True})

        def d1(sql, local=None):
            if 'candidate_profile_configs' in sql:
                return [{'candidate_id': 'bad_one', 'config': bad}, {'candidate_id': 'good_one', 'config': good}]
            return [{'id': 'bad_one', 'primary_skills': '[]', 'target_roles': '[]', 'search_profile': None, 'visibility': 'private'},
                    {'id': 'good_one', 'primary_skills': '[]', 'target_roles': '[]', 'search_profile': None, 'visibility': 'private'}]
        err = io.StringIO()
        with mock.patch.object(dd, 'd1', d1), contextlib.redirect_stderr(err):
            profs = dd.profiles()
        self.assertNotIn('bad_one', profs)
        self.assertIn('good_one', profs)
        self.assertIn('Profile config of bad_one skipped', err.getvalue())
        for p in profs.values():
            re.compile(p['role'])   # what the discovery steps do with every entry

    def test_config_threshold_and_caps_reach_the_selection(self):
        # review 2: the fit floor uses the config's own cut-off; review 5: the row cap keeps dated rows first (undated last)
        p = pp.plan({'schema': 1, 'field': {'role_families': ['data_analytics']}, 'thresholds': {'qualify': 62}}, {'qualification_threshold': 80}, dd.BUILTIN)
        self.assertEqual(p['threshold'], 62)
        seen = {}

        class Con:
            def execute(self, sql, params):
                seen['sql'] = sql
                return mock.Mock(description=[], fetchall=lambda: [])
        dd.candidate_rows(Con(), 'x.parquet', {**p, 'max_rows': 10}, 45)
        self.assertIn('ORDER BY posted_at DESC NULLS LAST LIMIT 10', seen['sql'])
        rows = [{'_pre': {'score': 60, 'status': 'NEEDS_REVIEW', 'eligibility': 'ELIGIBLE', 'band': 'remote'}, 'posted_at': '2026-11-19'}]
        with mock.patch.object(dd, 'candidate_rows', lambda *a: [dict(r) for r in rows]):
            out = dd.select_wide(None, 'x', {'example_thr': p}, [{'id': 'example_thr', 'qualification_threshold': 80}], 45, scorer=lambda items: [r['_pre'] for _, r in items])
        self.assertEqual(len(out['example_thr']), 1, 'a score of 60 passes the fit floor of the config threshold 62 (47); the stored 80 would need 65')

    def test_missing_table_reads_as_no_configs(self):
        def d1(sql, local=None):
            if 'candidate_profile_configs' in sql:
                raise dd.D1Error('D1 query failed: no such table: candidate_profile_configs', False)
            return [{'id': 'farhan_shaikh', 'primary_skills': '[]', 'rejected_companies': '[]'}]
        with mock.patch.object(dd, 'd1', d1):
            self.assertEqual(dd.profile_configs(), {})
            self.assertNotIn('profile_config', dd.candidates_rows()[0])
        def d1_down(sql, local=None):
            raise dd.D1Error('D1 query failed: 503 service unavailable', True)
        with mock.patch.object(dd, 'd1', d1_down), self.assertRaises(dd.D1Error):
            dd.profile_configs()


if __name__ == '__main__':
    unittest.main()
