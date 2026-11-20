"""Discovery from a profile config (dashboard/docs/MULTI_CANDIDATE.md section 6): engine/profile_plan.py builds a person's searches from their
config, dataset_discovery.profiles() writes them into work/profiles.json, and a database without the 0028 table reads as no configs.
The config is the synthetic example profile (tests only; no real person)."""
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
        self.assertIsNone(pp.engine_config('{"schema":1,"extends":"legacy:farhan_shaikh"}', 'farhan_shaikh'))
        self.assertIsNotNone(pp.engine_config('{"schema":1,"extends":"legacy:farhan_shaikh","engine":"profile"}', 'farhan_shaikh'))
        self.assertIsNotNone(pp.engine_config('{"schema":1}', 'someone_new'))
        self.assertIsNone(pp.engine_config('{"schema":1,"engine":"legacy"}', 'someone_new'))
        self.assertIsNone(pp.engine_config('{not json', 'someone_new'))


class Profiles(unittest.TestCase):
    def test_profiles_json_gets_the_config_searches(self):
        cfg = EXAMPLE.read_text()

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
