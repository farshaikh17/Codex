"""Dataset and list downloads in the scheduled workflows retry on any error (a 'connection reset' mid-transfer is not retried by plain --retry). Text checks."""
import re
import unittest
from pathlib import Path

WF = Path(__file__).resolve().parent / '.github' / 'workflows'
FLAGS = '--retry 5 --retry-delay 20 --retry-all-errors --connect-timeout 30'


class Downloads(unittest.TestCase):
    def test_main_dataset_download_retries_all_errors(self):
        t = (WF / 'discovery.yml').read_text()
        line = next(l for l in t.splitlines() if 'jobs/v1/all.parquet' in l and 'curl' in l)
        self.assertIn('curl -fsSL ' + FLAGS + ' ', line)

    def test_every_download_curl_uses_the_same_retry_flags(self):
        for name in ('discovery.yml', 'watchlist.yml'):
            t = (WF / name).read_text()
            calls = re.findall(r'curl -fsSL[^\n]*', t)
            self.assertTrue(calls, name)
            for c in calls:
                self.assertIn(FLAGS, c, f'{name}: {c}')
                self.assertNotRegex(c, r'--retry [0-4] ', f'{name}: {c}')


if __name__ == '__main__':
    unittest.main()
