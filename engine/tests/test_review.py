import copy,json,tempfile,threading,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest import mock
import engine.review as rq
from collect import collect
from engine import candidates as cfg
from engine.benchmark import FIXTURES
from engine.store import connect as store_connect,extract_pending,ingest_snapshot
A='synthetic-impl-in'
REQS='Requirements\n5+ years of experience implementing B2B SaaS\nSQL and data migration experience'
def lever(pid,text=REQS,title='Implementation Manager',**extra):
    return {'id':pid,'text':title,'hostedUrl':'https://jobs.lever.co/x/'+pid,'workplaceType':'remote','categories':{'location':'India'},
            'descriptionPlain':'About the role\nLead SaaS implementation and onboarding for team %s. This is a full-time position.\n'%pid+text,
            'salaryDescriptionPlain':'INR 30,00,000 - 40,00,000 per annum base'}|extra
def source(board):
    return {'id':board+'-lever','provider':'lever','board':board,'url':'https://api.lever.co/v0/postings/%s?mode=json'%board}
T0=datetime(2026,10,26,12,0,tzinfo=timezone.utc)
def at(minutes):
    return (T0+timedelta(minutes=minutes)).isoformat()
class World:
    """A posting store fed by the real collector, plus a private review database outside the repository."""
    def __init__(self,folder):
        self.folder=Path(folder)
        self.store=store_connect(self.folder/'store.sqlite3')
        self.q=rq.connect(self.folder/'private'/'review.sqlite3')
        self.people={c['candidate_id']:c for c in (cfg.load(f) for f in sorted(FIXTURES.glob('*.json')))}
    def collect(self,feeds):
        """feeds: {board: [postings]}"""
        sources=[source(b) for b in sorted(feeds)]
        collect(sources,self.folder/'public',lambda s:feeds[s['board']],lambda _:None)
        ingest_snapshot(self.store,self.folder/'public',sources)
        extract_pending(self.store)
    def enqueue(self,people=None):
        return rq.enqueue(self.store,self.q,people or self.people,now=at(0))
    def items(self,state=None):
        sql='select * from items where candidate_id=?'+(' and state=?' if state else '')
        return self.q.execute(sql,(A,state) if state else (A,)).fetchall()
    def met_all(self,item):
        return {u['id']:{'decision':'met','evidence':'synthetic profile line'} for u in item['gates']['qualifications']['units'] if u['status']=='pending'}
class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.w=World(self.tmp.name)
    def tearDown(self):
        self.w.store.close();self.w.q.close();self.tmp.cleanup()
    def test_enqueue_is_idempotent_and_never_rescreens_unchanged_keys(self):
        self.w.collect({'x':[lever('1'),lever('2')]})
        first=self.w.enqueue()[A]
        self.assertEqual((first['new_items'],first['pending']),(2,2))
        with mock.patch.object(rq,'screen',side_effect=AssertionError('rescreened')):
            again=self.w.enqueue()[A]
        self.assertEqual((again['new_items'],again['unchanged']),(0,2))
    def test_states_from_screening(self):
        self.w.collect({'x':[lever('1'),lever('us',categories={'location':'Remote - US'}),lever('off',title='Account Executive',
                        descriptionPlain='Sell things.\n'+REQS)]})
        self.w.enqueue()
        by={r['posting_id'].split(':')[-1]:(r['state'],r['outcome'],r['decided_by']) for r in self.w.items()}
        self.assertEqual(by,{'1':('pending',None,None),'us':('completed','excluded','gates'),'off':('deferred',None,None)})
    def test_change_supersedes_and_carries_reviews_only_within_profile_version(self):
        self.w.collect({'x':[lever('1')]})
        self.w.enqueue()
        item,=rq.claim(self.w.store,self.w.q,A,'w1',now=at(1))
        rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',self.w.met_all(item),now=at(2))
        self.w.collect({'x':[lever('1',salaryDescriptionPlain='INR 35,00,000 - 45,00,000 per annum base')]})
        self.assertEqual(self.w.enqueue()[A]['superseded'],1)
        new,=self.w.items('completed')
        self.assertEqual((new['outcome'],new['decided_by']),('ready','gates'),'unchanged requirement lines keep their review; only pay changed')
        self.assertIn('content changed: content_changed compensation_raw',new['priority_reasons'])
        moved=copy.deepcopy(self.w.people)
        moved[A]['profile_version']='synthetic-2'
        self.assertEqual(self.w.enqueue(moved)[A]['superseded'],1)
        self.assertEqual(self.w.items('pending')[0]['verdict'],'conditional','a new profile version needs fresh reviews')
    def test_rules_change_requeues_every_posting(self):
        self.w.collect({'x':[lever('1'),lever('2')]})
        self.w.enqueue()
        changed=copy.deepcopy(self.w.people)
        changed[A]['rules_version']='synthetic-2'
        out=self.w.enqueue(changed)[A]
        self.assertEqual((out['new_items'],out['superseded']),(2,2))
    def test_claim_priority_cap_and_leases(self):
        self.w.collect({'a':[lever('a%d'%n) for n in range(4)],'b':[lever('b1',title='Implementation Onboarding Manager')]})
        self.w.enqueue()
        batch=rq.claim(self.w.store,self.w.q,A,'w1',batch_size=10,per_employer_cap=2,now=at(1))
        self.assertEqual(len(batch),3)
        self.assertEqual(batch[0]['posting_id'],'lever:b:b1','higher relevance first')
        self.assertEqual(rq.claim(self.w.store,self.w.q,A,'w2',batch_size=10,per_employer_cap=2,now=at(2))[0]['posting_id'][:9],'lever:a:a','leased items are not handed out twice')
    def test_concurrent_claims_never_overlap(self):
        self.w.collect({'x':[lever('p%d'%n) for n in range(8)]})
        self.w.enqueue()
        path=self.w.folder/'private'/'review.sqlite3'
        got,barrier={},threading.Barrier(2)
        def worker(name):
            q,store=rq.connect(path),store_connect(self.w.folder/'store.sqlite3')
            barrier.wait()
            got[name]={b['item_id'] for b in rq.claim(store,q,A,name,batch_size=5,per_employer_cap=10,now=at(1))}
            q.close();store.close()
        threads=[threading.Thread(target=worker,args=(n,)) for n in ('w1','w2')]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertFalse(got['w1']&got['w2'])
        self.assertEqual(len(got['w1']|got['w2']),8)
    def test_only_the_lease_holder_submits_and_expired_leases_resume(self):
        self.w.collect({'x':[lever('1')]})
        self.w.enqueue()
        item,=rq.claim(self.w.store,self.w.q,A,'w1',lease_seconds=60,now=at(1))
        with self.assertRaises(rq.QueueError):rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w2',now=at(1))
        with self.assertRaises(rq.QueueError):rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',now=at(5))
        self.assertEqual(rq.status(self.w.store,self.w.q,A,now=at(5))['queue']['expired_leases'],1)
        again,=rq.claim(self.w.store,self.w.q,A,'w2',now=at(6))
        self.assertEqual(again['item_id'],item['item_id'])
        rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w2',self.w.met_all(again),now=at(7))
        events=[e[0] for e in self.w.q.execute('select event from events where item_id=? order by seq',(item['item_id'],))]
        self.assertEqual(events,['created','claimed','reclaimed_after_expiry','reviewed'])
    def test_interrupted_batch_scenario(self):
        """farshaikh17/Codex#7 queue scenario 'interrupted-batch': 5 items, interrupt after 2, a collection in
        between; the pending set is the other 3 and every item is processed exactly once."""
        feed={'x':[lever('q%d'%n) for n in range(1,6)]}
        self.w.collect(feed)
        self.w.enqueue()
        batch=rq.claim(self.w.store,self.w.q,A,'run-1',batch_size=5,per_employer_cap=5,lease_seconds=600,now=at(1))
        self.assertEqual(len(batch),5)
        done=[]
        for item in batch[:2]:
            rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'run-1',self.w.met_all(item),now=at(2))
            done.append(item['posting_id'])
        self.w.q.close()  # the run dies here, holding leases on three items
        self.w.collect(feed)  # a collection happens before anyone resumes
        self.w.q=rq.connect(self.w.folder/'private'/'review.sqlite3')
        self.assertEqual(self.w.enqueue()[A]['new_items'],0,'the collection changed nothing, so nothing is requeued')
        self.assertEqual(rq.claim(self.w.store,self.w.q,A,'run-2',batch_size=5,per_employer_cap=5,now=at(5)),[],'live leases are respected')
        resumed=rq.claim(self.w.store,self.w.q,A,'run-2',batch_size=5,per_employer_cap=5,now=at(20))
        pending=sorted(i['posting_id'].split(':')[-1] for i in resumed)
        self.assertEqual(set(pending),{b['posting_id'].split(':')[-1] for b in batch[2:]},'exactly the items not yet submitted')
        self.assertEqual(pending,['q3','q4','q5'],'ties are broken by posting id, so the order matches the scenario')
        for item in resumed: rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'run-2',self.w.met_all(item),now=at(21))
        reviewed=[r[0] for r in self.w.q.execute("select item_id from events where event='reviewed'")]
        self.assertEqual(len(reviewed),5)
        self.assertEqual(len(set(reviewed)),5,'each item processed exactly once')
    def test_findings_must_quote_the_posting_and_only_settle_unknowns(self):
        self.w.collect({'x':[lever('1',salaryDescriptionPlain=None)]})
        self.w.enqueue()
        item,=rq.claim(self.w.store,self.w.q,A,'w1',now=at(1))
        submit=lambda **k:rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',now=at(2),**k)
        with self.assertRaises(rq.QueueError):submit(findings={'salary':{'result':'pass','quote':'INR 50 lakh base','reason':'invented'}})
        with self.assertRaises(rq.QueueError):submit(findings={'geography':{'result':'fail','quote':'India','reason':'already decided'}})
        with self.assertRaises(rq.QueueError):submit(findings={'qualifications':{'result':'pass','quote':'SQL','reason':'no'}})
        with self.assertRaises(rq.QueueError):submit(unit_decisions={'not-a-line':{'decision':'met','evidence':'x'}})
        self.assertEqual(self.w.q.execute('select count(*) from unit_reviews').fetchone()[0],0,'refused submissions write nothing')
        out=submit(unit_decisions=self.w.met_all(item),findings={'salary':{'result':'fail','quote':'This is a full-time position.',
                   'reason':'no pay stated; candidate rule requires one','basis':'synthetic'}})
        self.assertEqual((out['state'],out['verdict']),('completed','excluded'))
    def test_ready_counts_stay_distinct_and_survive_disappearance(self):
        self.w.collect({'x':[lever('1'),lever('2')]})
        self.w.enqueue()
        for item in rq.claim(self.w.store,self.w.q,A,'w1',now=at(1)):
            rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',self.w.met_all(item),usage={'input_tokens':10} if item['posting_id'].endswith('1') else None,now=at(2))
        s=rq.status(self.w.store,self.w.q,A,since=at(2),now=at(3))
        self.assertEqual((s['assessed']['ready'],s['newly_qualified'],s['open_ready']),(2,2,2))
        self.assertEqual(s['ai_usage'],{'reviews':2,'reviews_with_reported_usage':1,'reported_totals':{'input_tokens':10},'reviews_avoided_by_deduplication':0,
                                        'note':'Only what reviewers reported. Missing usage is not estimated.'})
        self.w.collect({'x':[lever('1')]})
        self.w.enqueue()
        s=rq.status(self.w.store,self.w.q,A,since=at(3),now=at(4))
        self.assertEqual((s['assessed']['ready'],s['newly_qualified'],s['open_ready'],s['ready_not_open']),(2,0,1,1))
        self.assertEqual(len(self.w.items()),2,'a disappearing posting never deletes its item')
    def test_pending_items_survive_collections_and_closed_postings_are_not_handed_out(self):
        self.w.collect({'x':[lever('1'),lever('2')]})
        self.w.enqueue()
        self.w.collect({'x':[lever('1')]})
        self.w.enqueue()
        s=rq.status(self.w.store,self.w.q,A,now=at(1))
        self.assertEqual((s['queue']['pending'],s['queue']['pending_not_open']),(2,1))
        self.assertEqual([i['posting_id'] for i in rq.claim(self.w.store,self.w.q,A,'w1',now=at(1))],['lever:x:1'])
    def test_decisions_are_durable_and_the_shared_store_is_untouched(self):
        self.w.collect({'x':[lever('1')]})
        before=list(self.w.store.iterdump())
        self.w.enqueue()
        item,=rq.claim(self.w.store,self.w.q,A,'w1',now=at(1))
        rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',self.w.met_all(item),now=at(2))
        self.assertEqual(list(self.w.store.iterdump()),before,'no candidate data in the shared posting store')
        self.w.q.close()
        self.w.q=rq.connect(self.w.folder/'private'/'review.sqlite3')
        self.assertEqual(self.w.items()[0]['decided_by'],'review')
        with self.assertRaises(rq.QueueError):rq.submit(self.w.store,self.w.q,self.w.people,item['item_id'],'w1',now=at(3))
    def test_identical_reposts_are_reviewed_once(self):
        same=lambda pid:lever(pid)|{'descriptionPlain':'About the role\nLead SaaS implementation and onboarding. This is a full-time position.\n'+REQS}
        self.w.collect({'x':[same('a'),same('b'),lever('c')]})
        out=self.w.enqueue()[A]
        self.assertEqual((out['pending'],out['duplicate']),(2,1))
        claimed=rq.claim(self.w.store,self.w.q,A,'w1',per_employer_cap=10,now=at(1))
        self.assertEqual(sorted(i['posting_id'] for i in claimed),['lever:x:a','lever:x:c'],'the repost is not handed out')
        primary=[i for i in claimed if i['posting_id']=='lever:x:a'][0]
        rq.submit(self.w.store,self.w.q,self.w.people,primary['item_id'],'w1',self.w.met_all(primary),now=at(2))
        dup=self.w.q.execute("select * from items where candidate_id=? and posting_id='lever:x:b'",(A,)).fetchone()
        self.assertEqual((dup['state'],dup['outcome'],dup['decided_by'],dup['duplicate_of']),('completed','ready','review_of_duplicate',primary['item_id']))
        s=rq.status(self.w.store,self.w.q,A,now=at(3))
        self.assertEqual((s['assessed']['ready'],s['open_ready'],s['ai_usage']['reviews'],s['ai_usage']['reviews_avoided_by_deduplication']),(2,2,1,1))
    def test_duplicate_is_released_when_its_primary_changes(self):
        same=lambda pid,extra='':lever(pid)|{'descriptionPlain':'About the role\nLead SaaS implementation.'+extra+' This is a full-time position.\n'+REQS}
        self.w.collect({'x':[same('a'),same('b')]})
        self.w.enqueue()
        self.w.collect({'x':[same('a',' Now with travel.'),same('b')]})
        out=self.w.enqueue()[A]
        self.assertEqual((out['superseded'],out['duplicates_released']),(1,1))
        self.assertEqual(sorted(r['posting_id'] for r in self.w.items('pending')),['lever:x:a','lever:x:b'])
    def test_review_database_inside_repository_is_refused(self):
        with self.assertRaises(rq.QueueError):rq.connect(cfg.ROOT/'state'/'review.sqlite3')
if __name__=='__main__':unittest.main()
