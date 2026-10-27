import json,tempfile,unittest
from pathlib import Path
from engine.acceptance import run
class AcceptanceTests(unittest.TestCase):
    def test_end_to_end_acceptance_passes_offline(self):
        with tempfile.TemporaryDirectory() as folder:
            doc=run(folder)
            on_disk=json.loads((Path(folder)/'acceptance.json').read_text())
        failed=[c for c in doc['checks'] if c['result']=='FAIL']
        self.assertEqual(failed,[],'acceptance checks failed')
        self.assertEqual(on_disk['result'],'pass')
        self.assertGreaterEqual(doc['passed'],40)
        self.assertTrue(all(c['result']=='not_run' and c['evidence'] for c in doc['checks'] if c['result']!='pass'),'every skipped check says why')
        self.assertIn('scheduled execution',doc['scope']['does_not_prove'],'the report never claims what it did not test')
if __name__=='__main__':unittest.main()

