"""R6: the discovery watchdog is its own workflow with no concurrency group; discovery.yml has its own group; only the D1-writing jobs of the
watchlist and the collector sync share d1-collector-sync. Text checks (no YAML library in the offline CI)."""
import re
import unittest
from pathlib import Path

WF = Path(__file__).resolve().parent / '.github' / 'workflows'


def top_level_group(text):
    m = re.search(r'^concurrency:\n(?:  #[^\n]*\n)*  group: (\S+)', text, re.M)
    return m.group(1) if m else None


class Concurrency(unittest.TestCase):
    def test_watchdog_workflow(self):
        w = (WF / 'discovery-watchdog.yml').read_text()
        self.assertIn("cron: '27 */2 * * *'", w)
        self.assertNotRegex(w, r'(?m)^\s*concurrency:')
        self.assertIn('node dashboard/scripts/discovery_watchdog.mjs', w)
        self.assertIn('actions: write', w)

    def test_groups(self):
        self.assertEqual(top_level_group((WF / 'discovery.yml').read_text()), 'daily-discovery')
        for name, job in (('watchlist.yml', 'watch'), ('sync_collector_to_d1.yml', 'sync')):
            t = (WF / name).read_text()
            self.assertIsNone(top_level_group(t), name)
            self.assertNotIn('discovery_watchdog', t, f'{name}: the watchdog moved to its own workflow')
            block = t[t.index(f'\n  {job}:\n'):]
            block = block[:block.index('\n    steps:')]
            self.assertRegex(block, r'concurrency:[^\n]*\n\s+group: d1-collector-sync\n\s+cancel-in-progress: false', name)

    def test_every_workflow_parses_shallowly(self):
        for f in WF.glob('*.yml'):
            t = f.read_text()
            self.assertNotIn('\t', t, f.name)
            self.assertRegex(t, r'(?m)^on:', f.name)
            self.assertRegex(t, r'(?m)^jobs:', f.name)


if __name__ == '__main__':
    unittest.main()
