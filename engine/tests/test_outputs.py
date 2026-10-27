import json,tempfile,unittest
from pathlib import Path
from unittest import mock
import engine.outputs as eo
import engine.review as rq
from engine import candidates as cfg
from engine.tests.test_review import A,REQS,World,at,lever
class PostingOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.w=World(self.tmp.name)
        self.out=Path(self.tmp.name)/'outputs'
        self.w.collect({'x':[lever('p%d'%n) for n in range(7)]})
    def tearDown(self):
        self.w.store.close();self.w.q.close();self.tmp.cleanup()
    def files(self):
        return {p.relative_to(self.out).as_posix():p.read_bytes() for p in self.out.rglob('*.json')}
    def test_public_outputs_hold_no_candidate_data(self):
        self.w.enqueue()
        eo.write_postings(self.w.store,self.out)
        text=b''.join(self.files().values()).decode()
        for person in self.w.people.values():
            self.assertNotIn(person['candidate_id'],text)
            for entry in person['profile'].get('application_history') or []:
                self.assertNotIn(entry['date'],text)
        self.assertNotIn('verdict',text)
        for name,data in self.files().items():
            self.assertIn(json.loads(data)['schema'],eo.SCHEMAS.values(),name)
    def test_records_are_stable_and_verifiable(self):
        first=eo.write_postings(self.w.store,self.out,now=at(0))
        self.assertEqual(first['records_rewritten'],7)
        self.w.collect({'x':[lever('p%d'%n) for n in range(7)]})  # same content, new retrieval time
        self.assertEqual(eo.write_postings(self.w.store,self.out,now=at(1))['records_rewritten'],0)
        self.assertEqual(eo.verify(self.out),[])
        record=json.loads((self.out/eo.record_name('lever:x:p1')).read_text())
        self.assertNotIn('last_seen_at',json.dumps(record),'retrieval times live in the index, not in records')
        self.assertIn('p1',record['content']['description'])
        (self.out/eo.record_name('lever:x:p2')).write_text('{}')
        self.assertEqual(eo.verify(self.out),['lever:x:p2: record missing or changed'])
    def test_cursor_pages_cover_every_posting_once_and_then_only_changes(self):
        eo.write_postings(self.w.store,self.out,limit=3)
        seen,cursor=[],None
        while True:
            eo.write_postings(self.w.store,self.out,since=cursor,limit=3)
            page=json.loads((self.out/'changes.json').read_text())
            seen+=[e['posting_id'] for e in page['entries']]
            cursor=page['cursor_to']
            if not page['has_more']: break
        self.assertEqual(sorted(seen),sorted('lever:x:p%d'%n for n in range(7)))
        self.assertEqual(len(seen),len(set(seen)))
        feed=[lever('p%d'%n) for n in range(7) if n!=3]
        feed[0]=lever('p0',text=REQS+'\nKubernetes')
        self.w.collect({'x':feed})
        status=eo.write_postings(self.w.store,self.out,since=cursor)
        page=json.loads((self.out/'changes.json').read_text())
        self.assertEqual(sorted(e['posting_id'] for e in page['entries']),['lever:x:p0','lever:x:p3'])
        self.assertEqual({e['posting_id']:e['availability'] for e in page['entries']}['lever:x:p3'],'missing')
        self.assertEqual(status['records_rewritten'],2)
        self.assertEqual(json.loads((self.out/eo.record_name('lever:x:p0')).read_text())['changes'][0]['fields'],['description'])
    def test_status_is_written_last_so_a_partial_write_is_detectable(self):
        eo.write_postings(self.w.store,self.out,now=at(0))
        old_status=(self.out/'status.json').read_bytes()
        self.w.collect({'x':[lever('p0',text=REQS+'\nRust')]+[lever('p%d'%n) for n in range(1,7)]})
        real=eo._write
        def crash(path,data):
            if path.name=='index.json': raise OSError('disk full')
            return real(path,data)
        with mock.patch.object(eo,'_write',crash):
            with self.assertRaises(OSError):eo.write_postings(self.w.store,self.out,now=at(1))
        self.assertEqual((self.out/'status.json').read_bytes(),old_status,'status.json still describes the previous complete write')
        self.assertTrue(eo.verify(self.out),'the reader can see that the files no longer match status.json')
        eo.write_postings(self.w.store,self.out,now=at(2))
        self.assertEqual(eo.verify(self.out),[],'rerunning repairs it')
    def test_cursor_validation(self):
        with self.assertRaises(eo.OutputError):eo.write_postings(self.w.store,self.out,since='df1|5')
class PrivateOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.w=World(self.tmp.name)
        self.out=Path(self.tmp.name)/'private-out'
        self.w.collect({'x':[lever('p%d'%n) for n in range(3)]+[lever('us',categories={'location':'Remote - US'})]})
        self.w.enqueue()
    def tearDown(self):
        self.w.store.close();self.w.q.close();self.tmp.cleanup()
    def fill(self,batch_id,answers):
        path=self.out/('batch-%s.response.json'%batch_id)
        doc=json.loads(path.read_text())
        for item in doc['items']:
            fn=answers.get(item['posting_id'])
            if fn: fn(item)
        path.write_text(json.dumps(doc))
        return path
    def test_private_outputs_refuse_the_repository(self):
        with self.assertRaises(eo.OutputError):eo.write_batch(self.w.store,self.w.q,self.w.people,cfg.ROOT/'state'/'out',A,'w1')
        with self.assertRaises(eo.OutputError):eo.write_decisions(self.w.q,cfg.ROOT/'out',A)
    def test_batch_round_trip_is_safe_to_rerun(self):
        made=eo.write_batch(self.w.store,self.w.q,self.w.people,self.out,A,'w1',batch_size=3,now=at(1))
        self.assertEqual(made['items'],3)
        batch=json.loads((self.out/made['files'][0]).read_text())
        self.assertEqual(batch['schema'],'review-batch-1')
        self.assertTrue(all(i['posting']['description'] for i in batch['items']))
        def met(item):
            for d in item['unit_decisions'].values(): d.update(decision='met',evidence='synthetic profile line')
        def bad(item):
            met(item);item['findings']={'salary':{'result':'pass','quote':'not in the posting','reason':'x'}}
        response=self.fill(made['batch_id'],{'lever:x:p0':met,'lever:x:p1':bad})
        first=eo.submit_batch(self.w.store,self.w.q,self.w.people,response,'w1',now=at(2))
        self.assertEqual(sorted(r['result'] for r in first['results']),['error','skipped_unanswered','submitted'])
        self.assertEqual(first['errors'],1)
        again=eo.submit_batch(self.w.store,self.w.q,self.w.people,response,'w1',now=at(3))
        self.assertEqual(sorted(r['result'] for r in again['results']),['already_submitted','error','skipped_unanswered'])
        reviewed=self.w.q.execute("select count(*) from events where event='reviewed'").fetchone()[0]
        self.assertEqual(reviewed,1,'the rerun submitted nothing twice')
    def test_decision_feed_resumes_and_keeps_history_apart_from_current_state(self):
        first=eo.write_decisions(self.w.q,self.out,A,now=at(1))
        feed=json.loads((self.out/first['file']).read_text())
        self.assertEqual([(e['event'],e['posting_id'],e['current']['outcome']) for e in feed['entries']],[('created','lever:x:us','excluded')],
                         'only automatic decisions appear from creation; pending items are not decisions')
        item=rq.claim(self.w.store,self.w.q,A,'w1',batch_size=1,now=at(2))[0]
        rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',self.w.met_all(item),now=at(3))
        second=eo.write_decisions(self.w.q,self.out,A,since=first['cursor_to'],now=at(4))
        feed=json.loads((self.out/second['file']).read_text())
        self.assertEqual([(e['event'],e['detail']['state'],e['current']['verdict']) for e in feed['entries']],[('reviewed','completed','ready')])
        self.assertEqual(eo.write_decisions(self.w.q,self.out,A,since=second['cursor_to'],now=at(5))['entries'],0)
        with self.assertRaises(eo.OutputError):eo.write_decisions(self.w.q,self.out,A,since='pc1|x|y')
if __name__=='__main__':unittest.main()
