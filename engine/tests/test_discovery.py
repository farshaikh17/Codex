import copy
import json
import unittest
from collections import Counter
from engine import candidates as cfg
from engine.discovery import plan, validate
from engine.benchmark import FIXTURES

NOW = '2026-10-27T12:00:00+00:00'


def strategy(shares=(70, 20, 10)):
    return {'lanes': [{'id': key, 'share': share, 'queries': [key + ' query1', key + ' query2'],
                       'sources': [key + '-a', key + '-b']}
                      for key, share in zip(('core', 'bridge', 'stretch'), shares)]}


class DiscoveryTests(unittest.TestCase):
    def test_different_profiles_get_independent_effort_not_ready_quotas(self):
        first = plan(strategy(), now=NOW)
        other = plan(strategy((20, 30, 50)), now=NOW)
        self.assertEqual(Counter(t['lane'] for t in first['tasks']), {'core': 7, 'bridge': 2, 'stretch': 1})
        self.assertEqual(other['planned_batches'], {'core': 2, 'bridge': 3, 'stretch': 5})
        self.assertTrue(all(t['stage'] == 'planned_not_executed' for t in first['tasks']))

    def test_completed_work_continues_allocation_and_does_not_mutate_state(self):
        config, done = strategy(), {'core': 7, 'bridge': 0, 'stretch': 0}
        before = copy.deepcopy((config, done))
        out = plan(config, completed=done, batches=3, now=NOW)
        self.assertEqual(out['planned_batches'], {'core': 0, 'bridge': 2, 'stretch': 1})
        self.assertEqual((config, done), before)

    def test_blocked_source_does_not_starve_independent_discovery(self):
        out = plan(strategy(), paused_sources={'core-a': '2026-10-28T12:00:00Z',
                                               'core-b': '2026-10-28T12:00:00Z'}, now=NOW)
        self.assertEqual(out['unavailable_lanes'], ['core'])
        self.assertEqual(len(out['tasks']), 10)
        self.assertTrue(all(t['lane'] != 'core' for t in out['tasks']))

    def test_cooldown_boundary_and_timezone_are_honored(self):
        paused = {'core-a': '2026-10-27T08:00:00-04:00', 'core-b': '2026-10-28T12:00:00Z'}
        out = plan(strategy(), paused_sources=paused, now=NOW)
        self.assertTrue(all(t['source'] == 'core-a' for t in out['tasks'] if t['lane'] == 'core'))
        with self.assertRaises(ValueError): plan(strategy(), paused_sources={'x': '2026-10-28T12:00:00'}, now=NOW)

    def test_all_sources_paused_reports_unfilled_effort(self):
        config = strategy()
        out = plan(config, paused_sources={s: '2026-10-28T12:00:00Z' for lane in config['lanes'] for s in lane['sources']}, now=NOW)
        self.assertEqual(out['tasks'], [])
        self.assertEqual(out['unfilled_batches'], 10)

    def test_invalid_configuration_and_counters_are_not_silently_accepted(self):
        for shares in ((50, 20, 10), (True, 89, 10), (float('nan'), 20, 10)):
            with self.assertRaises(ValueError): validate(strategy(shares))
        for done in ({'typo': 1}, {'core': -1}, {'core': True}):
            with self.assertRaises(ValueError): plan(strategy(), completed=done, now=NOW)
        for batches in (0, -1, True, 1001):
            with self.assertRaises(ValueError): plan(strategy(), batches=batches, now=NOW)
        config = strategy()
        config['lanes'][1]['id'] = 'core'
        with self.assertRaises(ValueError): validate(config)

    def test_candidate_schema_accepts_strategy_without_changing_other_rules(self):
        path = next(FIXTURES.glob('*.json'))
        candidate = json.loads(path.read_text())
        before = copy.deepcopy(candidate)
        candidate['rules']['discovery'] = strategy()
        cfg.validate(candidate)
        del candidate['rules']['discovery']
        self.assertEqual(candidate, before)
        candidate['rules']['discovery'] = strategy((50, 20, 10))
        with self.assertRaises(cfg.ConfigError): cfg.validate(candidate)
