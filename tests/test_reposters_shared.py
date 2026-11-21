"""The reposter names in engine/reposters.py and dashboard/shared/reposters.ts (shortlist and seeker page) are the same list."""
import pathlib
import re
import unittest

from engine.reposters import REPOSTER_NAMES, is_reposter

ROOT = pathlib.Path(__file__).resolve().parents[1]


def js_names():
    src = (ROOT / 'dashboard' / 'shared' / 'reposters.ts').read_text()
    body = re.search(r'REPOSTER_NAMES[^=]*=\s*new Set\(\[(.*?)\]\)', src, re.S).group(1)
    return set(re.findall(r"'([^']+)'", body))


class SharedReposterList(unittest.TestCase):
    def test_python_and_js_lists_agree(self):
        self.assertEqual(js_names(), set(REPOSTER_NAMES))

    def test_jobgether_is_a_reposter(self):
        self.assertTrue(is_reposter('Jobgether'))
        self.assertIn('jobgether', js_names())

    def test_va_placement_firms_are_reposters(self):
        # 20 Nov: Seamless Assist places virtual assistants with client businesses, like 20four7VA and Wing Assistant
        for name in ('Seamlessassist', 'Seamless Assist', '20four7VA', 'Wing Assistant'):
            self.assertTrue(is_reposter(name), name)
        self.assertFalse(is_reposter('Seamless'))


if __name__ == '__main__':
    unittest.main()
