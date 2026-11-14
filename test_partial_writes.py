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
            stack.enter_context(mock.patch.object(ms, 'workable', lambda q: one('workable')()))
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
