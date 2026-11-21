"""Run the CI entry point with disposable profiles and inspect only its public output."""
import base64
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest


class PipelinePrivacyTest(unittest.TestCase):
    def test_invalid_profile_stays_private_on_failure(self):
        marker = 'synthetic-privacy-canary'
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w:gz') as tar:
            body = b'{"schema":"invalid"}'
            entry = tarfile.TarInfo(marker + '.json')
            entry.size = len(body)
            tar.addfile(entry, io.BytesIO(body))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            work = root / 'work'
            result = subprocess.run(
                ['bash', 'engine/ci/run_pipeline.sh'],
                cwd=Path(__file__).resolve().parents[2],
                env={**os.environ, 'CANDIDATES_B64': base64.b64encode(archive.getvalue()).decode(),
                     'PIPELINE_PASSPHRASE': 'fixture-only', 'WORK_DIR': str(work),
                     'STATE_DIR': str(root / 'cache'), 'PIPELINE_ARGS': '--offline'},
                capture_output=True, text=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            with self.subTest('public logs'):
                self.assertNotIn(marker, result.stdout + result.stderr)
            with self.subTest('plaintext on disk'):
                self.assertFalse(any(p.is_file() for p in work.rglob('*')))
