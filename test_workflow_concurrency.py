"""R6: the discovery watchdog is its own workflow with its own concurrency group (shared with no other workflow); discovery.yml has its own group; only the D1-writing jobs of the
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
        self.assertEqual(top_level_group(w), 'discovery-watchdog')
        for name in ('watchlist.yml', 'collect.yml', 'sync_collector_to_d1.yml', 'discovery.yml', 'career-pipeline.yml'):
            self.assertNotEqual(top_level_group((WF / name).read_text()), 'discovery-watchdog', name)

    def test_watchdog_runs_after_other_scheduled_workflows(self):
        # Wide intake: GitHub drops most scheduled triggers, so the watchdog also runs when another scheduled workflow finishes.
        w = (WF / 'discovery-watchdog.yml').read_text()
        block = w[w.index('  workflow_run:\n'):w.index('\npermissions:')]
        self.assertIn('types: [completed]', block)
        self.assertIn('branches: [main]', block)
        names = re.findall(r"^      - '([^']+)'$", block, re.M)
        self.assertGreaterEqual(len(names), 3)
        declared = {re.search(r'^name: (.+)$', f.read_text(), re.M).group(1).strip() for f in WF.glob('*.yml')}
        for n in names:   # a renamed workflow would silently stop triggering the watchdog
            self.assertIn(n, declared, n)
            self.assertNotIn(n, ('Discovery watchdog (restarts a missed daily discovery run)',
                                 'Daily discovery (open ATS dataset + light job-site search)'), 'no loop through itself or the run it starts')
        self.assertIn("github.event.workflow_run.head_branch == 'main'", w)
        self.assertNotIn('workflow_run.head_sha', w, 'never checks out the triggering run')
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
