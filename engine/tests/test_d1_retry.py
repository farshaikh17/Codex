"""engine/dataset_discovery.d1(): a read that fails for a network or 5xx-type reason is retried (5, 20, 60 s); an SQL error is not.
Offline: subprocess.run is replaced by a fake wrangler."""
import json
import subprocess
import unittest
from types import SimpleNamespace
from unittest import mock

from engine import dataset_discovery as dd
from engine import liveness

OK = SimpleNamespace(returncode=0, stdout='[{"results": [{"n": 1}], "success": true}]', stderr='')


def failing(*answers):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        a = answers[min(len(calls) - 1, len(answers) - 1)]
        if isinstance(a, Exception):
            raise a
        return a
    return run, calls


def err(msg):
    return SimpleNamespace(returncode=1, stdout='', stderr=msg)


class D1Retry(unittest.TestCase):
    def test_transient_failures_are_retried_with_the_stated_waits(self):
        run, calls = failing(err('fetch failed: ECONNRESET'), err('A request to the Cloudflare API failed. [code: 7500] 503 Service Unavailable'),
                             subprocess.TimeoutExpired('npx', 180), OK)
        slept = []
        with mock.patch.object(dd.subprocess, 'run', run):
            self.assertEqual(dd.d1('SELECT 1', sleep=slept.append), [{'n': 1}])
        self.assertEqual(len(calls), 4)
        self.assertEqual(slept, [5, 20, 60])

    def test_json_error_drives_retry_when_stderr_contains_a_cli_warning(self):
        for message, count in [('503 Service Unavailable', 2), ('no such column: network: SQLITE_ERROR', 1),
                               ("Your account has exceeded D1's free tier daily row read limit", 1)]:
            with self.subTest(message=message):
                failure = SimpleNamespace(returncode=1, stdout=json.dumps({'error': {'text': message}}),
                                          stderr='Warning: a newer CLI version is available')
                run, calls = failing(failure, OK)
                slept = []
                with mock.patch.object(dd.subprocess, 'run', run):
                    if count == 2:
                        self.assertEqual(dd.d1('SELECT 1', sleep=slept.append), [{'n': 1}])
                    else:
                        with self.assertRaises(dd.D1Error) as caught:
                            dd.d1('SELECT 1', sleep=slept.append)
                        self.assertIn(message, str(caught.exception))
                self.assertEqual(len(calls), count)
                self.assertEqual(slept, [5] if count == 2 else [])

    def test_gives_up_after_three_retries(self):
        run, calls = failing(err('502 Bad Gateway'))
        slept = []
        with mock.patch.object(dd.subprocess, 'run', run):
            with self.assertRaises(RuntimeError):
                dd.d1('SELECT 1', sleep=slept.append)
        self.assertEqual(len(calls), 4)
        self.assertEqual(slept, [5, 20, 60])

    def test_sql_errors_are_not_retried(self):
        for msg in ('no such column: foo: SQLITE_ERROR', 'Authentication error [code: 10000]', 'near "SELEC": syntax error'):
            run, calls = failing(err(msg))
            slept = []
            with mock.patch.object(dd.subprocess, 'run', run):
                with self.assertRaises(RuntimeError):
                    dd.d1('SELECT 1', sleep=slept.append)
            self.assertEqual((len(calls), slept), (1, []), msg)

    def test_liveness_export_uses_the_same_helper(self):
        import inspect
        self.assertIn('from engine.dataset_discovery import d1', inspect.getsource(liveness.main))


if __name__ == '__main__':
    unittest.main()
