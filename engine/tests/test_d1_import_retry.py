"""engine/staging_bridge.D1StagingBridge: a collector batch import (`wrangler d1 execute --remote --file`) that fails for a
transient Cloudflare reason is retried at most twice; any other failure is raised at once. Offline: subprocess.run is a fake wrangler."""
import unittest
from types import SimpleNamespace
from unittest import mock

from engine import staging_bridge as sb

OK = SimpleNamespace(returncode=0, stdout='[{"results": [], "success": true, "meta": {"changes": 3}}]', stderr='')
NO_POLL = SimpleNamespace(returncode=1, stderr='',
                          stdout='Uploading complete.\n{"error": {"text": "Cancelled due to no poll() received in 15000ms."}}')
SQL_ERROR = SimpleNamespace(returncode=1, stderr='', stdout='{"error": {"text": "near \\"INSERTT\\": syntax error [code: 7500]"}}')

ITEM = {'job': {'key': 'test:1', 'title': 'Test Job'}, 'decision': {'fit': 50}}


class D1ImportRetry(unittest.TestCase):
    def run_import(self, *answers):
        calls, slept = [], []

        def run(cmd, **kw):
            calls.append(cmd)
            return answers[min(len(calls) - 1, len(answers) - 1)]

        bridge = sb.D1StagingBridge(mode='remote')
        with mock.patch.object(sb.subprocess, 'run', run), mock.patch.object(sb.time, 'sleep', slept.append):
            try:
                return bridge.import_batch('farhan_shaikh', [ITEM]), None, calls, slept
            except RuntimeError as e:
                return None, e, calls, slept

    def test_transient_error_then_success_retries_once(self):
        res, err, calls, slept = self.run_import(NO_POLL, OK)
        self.assertIsNone(err)
        self.assertEqual(res['status'], 'SUCCESS')
        self.assertEqual(res['rows_actually_changed'], 3)
        self.assertEqual(len(calls), 2)
        self.assertEqual(slept, [sb.D1_IMPORT_RETRY_WAITS[0]])

    def test_non_transient_error_is_not_retried(self):
        res, err, calls, slept = self.run_import(SQL_ERROR, OK)
        self.assertIsNone(res)
        self.assertIn('D1 batch import failed for farhan_shaikh', str(err))
        self.assertIn('syntax error', str(err))
        self.assertEqual(len(calls), 1)
        self.assertEqual(slept, [])

    def test_transient_three_times_fails(self):
        res, err, calls, slept = self.run_import(NO_POLL, NO_POLL, NO_POLL, OK)
        self.assertIsNone(res)
        self.assertIn('D1 batch import failed for farhan_shaikh', str(err))
        self.assertIn('no poll() received', str(err))
        self.assertEqual(len(calls), 3)
        self.assertEqual(slept, list(sb.D1_IMPORT_RETRY_WAITS))


if __name__ == '__main__':
    unittest.main()
