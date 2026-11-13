"""R9: engine/dataset_discovery.py takes the rules marker from its one definition in dashboard/worker/discovery.ts."""
import re
import unittest
from pathlib import Path

from engine import dataset_discovery as dd


class RulesMarker(unittest.TestCase):
    def test_same_as_the_worker(self):
        ts = (Path(__file__).resolve().parents[2] / 'dashboard' / 'worker' / 'discovery.ts').read_text()
        self.assertEqual(dd.RULES_MARKER, re.search(r"export const RULES_MARKER = '([^']+)'", ts).group(1))
        self.assertRegex(dd.RULES_MARKER, r'^profile_v\d+$')

    def test_rescore_export_uses_it(self):
        import inspect
        src = inspect.getsource(dd.rescore_rows)
        self.assertIn('{RULES_MARKER}', src)


if __name__ == '__main__':
    unittest.main()
