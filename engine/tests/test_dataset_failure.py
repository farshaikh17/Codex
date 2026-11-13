"""R3: a failed dataset download or a stale snapshot no longer stops (or silently empties) the daily run. Offline: D1, the manifest and
DuckDB are replaced."""
import json
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd


def fake_d1(sql, local=None, **kw):
    if 'FROM candidates c LEFT JOIN client_profiles' in sql:
        return [{'id': 'farhan_shaikh', 'primary_skills': '[]', 'search_profile': None, 'visibility': None}]
    return []


class DatasetFailure(unittest.TestCase):
    def run_main(self, d, *args):
        with mock.patch.object(dd, 'd1', fake_d1), mock.patch.object(sys, 'argv', ['x', '--out', d, *args]), mock.patch('builtins.print'):
            return dd.main()

    def test_no_dataset_writes_what_the_later_steps_need_and_an_empty_result(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.run_main(d, '--no-dataset', '--rescore-export'), 0)
            for f in ('candidates.json', 'profiles.json', 'rescore.json', 'taste_rows.json', 'taste_targets.json', 'matches.json', 'report.json'):
                self.assertTrue(Path(d, f).exists(), f)
            m = json.loads(Path(d, 'matches.json').read_text())
            self.assertEqual((m['jobs'], m['closed']), ([], []))
            self.assertEqual(json.loads(Path(d, 'report.json').read_text())['dataset'], 'download_failed')
            self.assertFalse(Path(d, 'dataset_stale.txt').exists())

    def test_manifest_three_tries(self):
        calls, slept = [], []

        def boom(*a, **k):
            calls.append(1)
            raise OSError('down')
        with mock.patch('urllib.request.urlopen', boom), mock.patch('builtins.print'):
            self.assertIsNone(dd.load_manifest(sleep=slept.append))
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(slept), 2)

    def test_manifest_age(self):
        now = datetime(2026, 11, 13, 12, tzinfo=timezone.utc)
        self.assertAlmostEqual(dd.manifest_age_hours({'generated_at': '2026-11-11T11:00:00Z'}, now), 49)
        self.assertIsNone(dd.manifest_age_hours({}, now))
        self.assertIsNone(dd.manifest_age_hours(None, now))

    def stale_run(self, generated):
        fake_duckdb = types.SimpleNamespace(connect=lambda: types.SimpleNamespace(execute=lambda *a: None))
        closures = mock.Mock(return_value=(['c1'], ['m1'], [], {'greenhouse': 1}))
        with tempfile.TemporaryDirectory() as d, mock.patch.dict(sys.modules, {'duckdb': fake_duckdb}), \
                mock.patch.object(dd, 'load_manifest', lambda: {'generated_at': generated, 'stats': {'total_jobs': 5_000_000}}), \
                mock.patch.object(dd, 'select', lambda *a, **k: []), mock.patch.object(dd, 'split_new', lambda jobs, local=None, merges=None: ([], [], 0)), \
                mock.patch.object(dd, 'closures', closures):
            self.assertEqual(self.run_main(d, '--dataset', 'work/all.parquet'), 0)
            return (Path(d, 'dataset_stale.txt').exists(), json.loads(Path(d, 'matches.json').read_text()), json.loads(Path(d, 'report.json').read_text()), closures.called)

    def test_stale_snapshot_is_flagged_and_closes_nothing(self):
        old = (datetime.now(timezone.utc) - timedelta(hours=60)).strftime('%Y-%m-%dT%H:%M:%SZ')
        flagged, m, report, closed_called = self.stale_run(old)
        self.assertTrue(flagged, 'the workflow fails the run on this file')
        self.assertTrue(report['stale'])
        self.assertEqual((m['closed'], m['missing_mark'], closed_called), ([], [], False), 'the same old snapshot twice is not two observations')

    def test_fresh_snapshot_runs_as_before(self):
        new = (datetime.now(timezone.utc) - timedelta(hours=5)).strftime('%Y-%m-%dT%H:%M:%SZ')
        flagged, m, report, closed_called = self.stale_run(new)
        self.assertFalse(flagged)
        self.assertFalse(report['stale'])
        self.assertEqual(m['closed'], ['c1'])


class Workflow(unittest.TestCase):
    def test_wiring(self):
        wf = (Path(__file__).resolve().parents[2] / '.github' / 'workflows' / 'discovery.yml').read_text()
        dl = wf[wf.index("Download today's dataset"):wf.index('Discovery state and past-applications')]
        self.assertIn('continue-on-error: true', dl, 'a failed download does not stop the run')
        self.assertIn('--no-dataset', wf)
        health = wf[wf.index('Run health'):]
        self.assertIn('if: always()', health.split('run:')[0])
        self.assertIn('scripts/run_health.mjs', health)
        script = (Path(__file__).resolve().parents[2] / 'dashboard' / 'scripts' / 'run_health.mjs').read_text()
        self.assertIn('dataset_stale.txt', script, 'a stale dataset makes the run red (R8 health job)')


if __name__ == '__main__':
    unittest.main()
