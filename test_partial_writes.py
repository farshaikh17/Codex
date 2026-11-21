"""R5: engine/more_sources.py and engine/remote_boards.py write their output after every source (a step stopped at its time limit keeps what
it fetched), start no new source after 80% of the step's time budget, and exit non-zero when every source failed. Offline."""
import contextlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import more_sources as ms
from engine import remote_boards as rb

PROFILES = {'farhan_shaikh': {'role': 'revops', 'exclude': ''}}


def one(source):
    def gen():
        yield rb.job(source, f'https://example.com/{source}/1', 'RevOps Manager', 'Acme', 'Remote', 'CRM', None)
    return gen


class PartialWrites(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        Path(self.d, 'profiles.json').write_text(json.dumps(PROFILES))
        self.argv = ['x', '--profiles', str(Path(self.d, 'profiles.json')), '--out', self.d]

    def raw(self):
        return [j['ats_type'] for j in json.loads(Path(self.d, 'jobsite_raw.json').read_text())['jobs']]

    def test_boards_file_is_written_after_each_source(self):
        seen_on_disk = []

        def second():
            seen_on_disk.extend(self.raw())   # what a step killed now would leave
            raise TimeoutError('hangs, then the step is stopped')
            yield   # noqa: unreachable - makes this a generator
        with mock.patch.object(rb, 'SOURCES', {'remoteok': one('remoteok'), 'himalayas': second}), mock.patch('sys.argv', self.argv):
            self.assertEqual(rb.main(), 0)
        self.assertEqual(seen_on_disk, ['remoteok'], 'the first source was on disk before the second started')
        report = json.loads(Path(self.d, 'boards_report.json').read_text())
        self.assertEqual(report['remoteok']['kept'], 1)
        self.assertFalse(Path(self.d, 'jobsite_raw.json.tmp').exists())

    def test_more_sources_file_is_written_after_each_source(self):
        seen_on_disk = []

        def second():
            seen_on_disk.extend(self.raw())
            return iter([])
        quiet = [n for n in ('siemens_energy', 'successfactors', 'smartrecruiters', 'workday', 'oracle_hcm', 'jibe', 'watch_boards') if hasattr(ms, n)]
        with contextlib.ExitStack() as stack:   # every other --fast source returns nothing (no network in tests)
            for n in quiet:
                stack.enter_context(mock.patch.object(ms, n, lambda: iter([])))
            stack.enter_context(mock.patch.object(ms, 'workable', lambda q, pages=2: one('workable')() if not pages > 2 else iter([])))
            stack.enter_context(mock.patch.object(ms, 'eightfold', second))
            stack.enter_context(mock.patch('sys.argv', self.argv + ['--fast']))
            self.assertEqual(ms.main(), 0)
        self.assertEqual(seen_on_disk, ['workable'])

    def test_no_new_source_after_80_percent_of_the_budget(self):
        clock = iter([0.0, 0.0, 85.0, 85.0, 85.0, 85.0, 85.0, 85.0, 85.0])
        with mock.patch.object(rb, 'SOURCES', {'remoteok': one('remoteok'), 'weworkremotely': one('weworkremotely'), 'himalayas': one('himalayas')}), \
                mock.patch.object(rb.time, 'monotonic', lambda: next(clock)), mock.patch('sys.argv', self.argv + ['--budget-seconds', '100']):
            self.assertEqual(rb.main(), 0)
        report = json.loads(Path(self.d, 'boards_report.json').read_text())
        self.assertEqual(report['remoteok']['kept'], 1)
        self.assertEqual(report['weworkremotely'].get('skipped'), 'time budget')
        self.assertEqual(report['himalayas'].get('skipped'), 'time budget')
        self.assertEqual(self.raw(), ['remoteok'])

    def test_exit_non_zero_when_every_source_errored(self):
        def bad():
            raise OSError('down')
            yield   # noqa: unreachable
        with mock.patch.object(rb, 'SOURCES', {'a': bad, 'b': bad}), mock.patch('sys.argv', self.argv):
            self.assertEqual(rb.main(), 1)
        with mock.patch.object(rb, 'SOURCES', {'a': bad, 'b': one('b')}), mock.patch('sys.argv', self.argv):
            self.assertEqual(rb.main(), 0, 'one source answering is enough')
        with mock.patch.object(ms, 'http', mock.Mock(side_effect=OSError('down'))), mock.patch('sys.argv', self.argv + ['--fast']):
            self.assertEqual(ms.main(), 1, 'every employer site down')

    def test_all_errored_rule(self):
        self.assertTrue(rb.all_errored({'a': {'error': 'x'}, 'b': {'error': 'y'}, 'c': {'skipped': 'time budget'}}))
        self.assertFalse(rb.all_errored({'a': {'error': 'x'}, 'b': {'read': 0, 'kept': 0}}))
        self.assertFalse(rb.all_errored({'c': {'skipped': 'time budget'}}))
        self.assertFalse(rb.all_errored({}))


class SourceOrderAndCaps(unittest.TestCase):
    """QA 3 F2: small and high-priority sources run first, and each source has its own time cap, so a slow one cannot starve the rest."""
    def setUp(self):
        self.d = tempfile.mkdtemp()
        Path(self.d, 'profiles.json').write_text(json.dumps(PROFILES))
        self.argv = ['x', '--profiles', str(Path(self.d, 'profiles.json')), '--out', self.d]

    def test_watch_boards_first_big_readers_last(self):
        names = ['workable', 'workable_places', 'eightfold', 'siemens_energy', 'successfactors', 'smartrecruiters', 'workday', 'oracle_hcm', 'jibe',
                 'watch_boards', 'arbeitnow', 'uncareers', 'eures', 'adzuna']
        got = list(ms.ordered({n: None for n in names + ['new_source']}))
        self.assertEqual(got[0], 'watch_boards')
        self.assertEqual(got[-4:], ['oracle_hcm', 'smartrecruiters', 'workday', 'new_source'])
        for cheap in ('arbeitnow', 'uncareers', 'eures', 'adzuna', 'jibe', 'oracle_hcm'):
            self.assertLess(got.index(cheap), got.index('workday'), cheap)
        self.assertEqual(sorted(got), sorted(names + ['new_source']), 'nothing lost or added')

    def test_sources_outside_the_open_dataset_run_before_those_in_it(self):
        # 19 Nov: EURES and the Oracle, SmartRecruiters and Workday employers are all in the open ATS dataset the daily run reads in full;
        # Workable search, Jibe, Eightfold, Siemens Energy and SuccessFactors (ReNew, Tata Power) are not, so they are read first.
        got = list(ms.ordered({n: None for n in ms.ORDER}))
        for outside in ('jibe', 'workable', 'workable_places', 'eightfold', 'siemens_energy', 'successfactors'):
            for inside in ('eures', 'oracle_hcm', 'smartrecruiters', 'workday'):
                self.assertLess(got.index(outside), got.index(inside), (outside, inside))

    def test_cap_is_a_weighted_share_of_the_time_left(self):
        self.assertIsNone(ms.source_cap('workday', ['workday'], 0, 0, 0), 'no budget: no cap')
        # 1000 s budget, 800 s window, at t=0: watch_boards (1) + workday (3) -> 200 s and 600 s.
        self.assertAlmostEqual(ms.source_cap('watch_boards', ['watch_boards', 'workday'], 0, 0, 1000), 200)
        self.assertAlmostEqual(ms.source_cap('workday', ['workday'], 100, 0, 1000), 700, msg='time left unused passes on')
        self.assertEqual(ms.source_cap('workday', ['workday'], 900, 0, 1000), 0)
        # the whole step budget is unchanged: the caps of all sources started at t=0 add up to the 80% window
        names = list(ms.ORDER)
        self.assertLessEqual(ms.source_cap(names[0], names, 0, 0, 1000) * sum(ms.WEIGHT.get(n, 1) for n in names) / ms.WEIGHT.get(names[0], 1), 800.0001)

    def _run(self, slow_name, step=50.0):
        """--fast run with a fake clock: `slow_name` yields postings forever, each costing `step` seconds; the others return one posting."""
        clock = [0.0]

        def slow():
            i = 0
            while True:
                clock[0] += step
                i += 1
                yield rb.job(slow_name, f'https://example.com/{slow_name}/{i}', 'RevOps Manager', 'Acme', 'Remote', 'CRM', None)
        fast = ('workable', 'eightfold', 'siemens_energy', 'successfactors', 'smartrecruiters', 'workday', 'oracle_hcm', 'jibe', 'watch_boards')
        with contextlib.ExitStack() as stack:
            for n in fast:
                fn = slow if n == slow_name else one(n)
                stack.enter_context(mock.patch.object(ms, n, (lambda f: (lambda *a, **k: f()))(fn)))
            stack.enter_context(mock.patch.object(ms, 'enrich_full_text', lambda *a: False))
            stack.enter_context(mock.patch.object(ms.time, 'monotonic', lambda: clock[0]))
            stack.enter_context(mock.patch('sys.argv', self.argv + ['--fast', '--budget-seconds', '1000']))
            buf = __import__('io').StringIO()
            with contextlib.redirect_stdout(buf):
                self.assertEqual(ms.main(), 0)
        return json.loads(Path(self.d, 'more_sources_report.json').read_text()), buf.getvalue()

    def test_a_slow_source_is_stopped_at_its_cap_and_the_rest_still_run(self):
        report, out = self._run('smartrecruiters')
        self.assertEqual(report['smartrecruiters'].get('stopped'), 'time cap')
        for n in ('successfactors', 'workday', 'watch_boards', 'oracle_hcm', 'jibe'):
            self.assertNotIn('skipped', report[n], n)
            self.assertEqual(report[n]['kept'], 1, n)
        self.assertIn('::warning::more_sources: smartrecruiters was stopped at its time cap', out)

    def test_a_source_skipped_for_time_is_reported_as_a_warning(self):
        self.assertEqual(ms.time_warnings({'a': {'skipped': 'time budget', 'read': 0, 'kept': 0}, 'b': {'read': 3, 'kept': 1},
                                           'c': {'stopped': 'time cap', 'cap_seconds': 120, 'read': 40, 'kept': 2}}),
                         ['more_sources: a was skipped for time (no time left in the step budget)',
                          'more_sources: c was stopped at its time cap (120 s) after reading 40'])


class WatchlistFetchedNothing(unittest.TestCase):
    """The watchlist's last check: a run that read nothing fails (so the 7-hour guard does not count it as done)."""
    def run_check(self, reports):
        import os
        import subprocess
        import sys
        import textwrap
        wf = (Path(__file__).resolve().parent / '.github' / 'workflows' / 'watchlist.yml').read_text()
        part = wf[wf.index('Fetched something?'):]
        code = textwrap.dedent(part[part.index("<<'PY'\n") + 6:part.index('\n          PY\n')])
        with tempfile.TemporaryDirectory() as d:
            os.mkdir(Path(d, 'work'))
            for name, body in reports.items():
                Path(d, 'work', name).write_text(json.dumps(body))
            return subprocess.run([sys.executable, '-c', code], cwd=d, capture_output=True, text=True).returncode

    def test_rule(self):
        self.assertEqual(self.run_check({}), 1, 'no report at all')
        self.assertEqual(self.run_check({'more_sources_report.json': {'a': {'error': 'x', 'read': 0, 'kept': 0}},
                                         'boards_report.json': {'b': {'error': 'y', 'read': 0, 'kept': 0}}}), 1)
        self.assertEqual(self.run_check({'boards_report.json': {'b': {'read': 12, 'kept': 0}}}), 0, 'something read, even if nothing matched')


if __name__ == '__main__':
    unittest.main()
