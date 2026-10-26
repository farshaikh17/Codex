import json,tempfile,unittest
from pathlib import Path
from unittest import mock
import engine.store
from collect import collect
from engine.store import connect,extract_pending,ingest_snapshot,posting_record,summary
from engine.tests.test_store import SOURCE,Harness,posting
ROOT=Path(__file__).resolve().parents[2]
REQ="Intro text.\nRequirements\nFive years of implementation work.\nNice to have\nSQL."
class ExtractionStoreTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.h=Harness(self.folder.name)
    def tearDown(self):
        self.h.conn.close()
        self.folder.cleanup()
    def test_extraction_is_cached_by_content_and_incremental(self):
        self.h.run([posting(text=REQ),posting('two',text=REQ)])
        self.assertEqual(extract_pending(self.h.conn)['extracted'],2)
        self.h.run([posting(text=REQ),posting('two',text=REQ)])
        self.assertEqual(extract_pending(self.h.conn)['extracted'],0,'unchanged content is not re-extracted')
        self.h.run([posting(text=REQ+'\nKubernetes.'),posting('two',text=REQ)])
        self.assertEqual(extract_pending(self.h.conn)['extracted'],1)
        self.assertEqual(self.h.count('extractions'),3,'the earlier version keeps its extraction')
        with mock.patch.object(engine.store,'EXTRACTOR_VERSION',engine.store.EXTRACTOR_VERSION+1):
            self.assertEqual(extract_pending(self.h.conn)['extracted'],3,'a new extractor version re-extracts every version')
    def test_interrupted_extraction_keeps_committed_batches_and_resumes(self):
        self.h.run([posting(p,text=REQ) for p in ('a','b','c','d','e')])
        real,calls=engine.store.extract,[]
        def flaky(version,url):
            calls.append(version['posting_id'])
            if len(calls)==3: raise RuntimeError('killed mid-run')
            return real(version,url)
        with mock.patch.object(engine.store,'extract',flaky):
            with self.assertRaises(RuntimeError):extract_pending(self.h.conn,batch=2)
        self.assertEqual(self.h.count('extractions'),2)
        self.assertEqual(extract_pending(self.h.conn)['extracted'],3)
        self.assertEqual(self.h.count('extractions'),5)
    def test_record_carries_hashes_evidence_and_change_kind(self):
        self.h.run([posting(text=REQ)])
        self.h.run([posting(text=REQ,salaryDescriptionPlain='INR 20,00,000 - 25,00,000 per annum')])
        self.h.run([posting(text=REQ+'\nKubernetes.',salaryDescriptionPlain='INR 20,00,000 - 25,00,000 per annum')])
        extract_pending(self.h.conn)
        rec=posting_record(self.h.conn,'lever:sample:one')
        self.assertEqual([c['kind'] for c in rec['changes']],['compensation_source_added','content_changed'])
        self.assertEqual(rec['changes'][1]['fields'],['description'])
        self.assertEqual(rec['changes'][-1]['to_hash'],rec['posting']['content_hash'])
        fields=rec['extraction']['fields']
        self.assertEqual(fields['requirements_mandatory']['items'][0]['quote'],'Five years of implementation work.')
        self.assertEqual(fields['requirements_preferred']['items'][0]['quote'],'SQL.\nKubernetes.','text after Nice to have stays preferred')
        pay=fields['compensation']['items'][0]
        self.assertEqual((pay['interpretation']['ranges'][0]['min'],pay['interpretation']['period'],pay['source_url']),
                         (2000000,'year','https://jobs.lever.co/sample/one'))
        self.assertEqual(summary(self.h.conn)['change_kinds'],{'compensation_source_added':1,'content_changed':1})
    def test_pending_count_until_extracted(self):
        self.h.run([posting(text=REQ)])
        self.assertEqual(summary(self.h.conn)['current_extraction'],{'pending':1})
        extract_pending(self.h.conn)
        self.assertEqual(summary(self.h.conn)['current_extraction'],{'thin':1},'a 10-word fixture is recorded as thin, not ok')
        self.assertEqual(summary(self.h.conn)['current_extraction_warnings'],{'thin_description':1})
    def test_v1_store_migrates_and_backfills_change_history(self):
        self.h.run([posting(text=REQ)])
        self.h.run([posting(text=REQ+'\nKubernetes.')])
        for table in ('evidence','extractions','version_changes','leads','page_captures','page_attempts','pages'): self.h.conn.execute('drop table '+table)
        self.h.conn.execute("update meta set value='1' where key='schema_version'")
        self.h.conn.close()
        self.h.conn=connect(Path(self.folder.name)/'state'/'engine.sqlite3')
        self.assertEqual(self.h.conn.execute("select value from meta where key='schema_version'").fetchone()[0],'3')
        kinds=[(r['kind'],json.loads(r['fields'])) for r in self.h.conn.execute('select * from version_changes')]
        self.assertEqual(kinds,[('content_changed',['description'])])
        self.assertEqual(extract_pending(self.h.conn)['extracted'],2)
    def test_newer_store_is_refused(self):
        self.h.conn.execute("update meta set value='99' where key='schema_version'")
        with self.assertRaises(RuntimeError):connect(Path(self.folder.name)/'state'/'engine.sqlite3')
class CommittedSnapshotExtractionTests(unittest.TestCase):
    def test_every_committed_posting_is_extracted_once(self):
        with tempfile.TemporaryDirectory() as folder:
            conn=connect(Path(folder)/'engine.sqlite3')
            ingest_snapshot(conn,ROOT/'public',json.loads((ROOT/'sources.json').read_text()))
            first=extract_pending(conn)
            again=extract_pending(conn)
            s=summary(conn)
            evidence=conn.execute('select count(*) from evidence').fetchone()[0]
            conn.close()
        self.assertEqual(first['extracted'],s['versions'])
        self.assertEqual(first['failed'],0)
        self.assertEqual(again['extracted'],0)
        self.assertNotIn('pending',s['current_extraction'])
        self.assertGreater(evidence,s['versions'])
if __name__=='__main__':unittest.main()
