import json
import tempfile
import unittest
from pathlib import Path
from weekend_trial import run

class TrialInputTests(unittest.TestCase):
    def test_missing_directory_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): run(Path(tmp)/'missing','farhan',30)

    def test_empty_directory_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): run(Path(tmp),'sana',30)

    def test_empty_valid_board_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp,'empty.json').write_text(json.dumps({'schema':'public-job-board-1','source':'empty','jobs':[]}))
            self.assertEqual(run(Path(tmp),'farhan',30)['sample_size'],0)
