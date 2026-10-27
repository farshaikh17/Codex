import hashlib,json,re,tempfile,unittest
from pathlib import Path
import engine.leads as el
from collect import collect
from engine.store import connect,ingest_snapshot
LINK=re.compile(r'\[([^\]]+)\]\((https?://[^)\s]+)\)')
def finder(text,page):
    """Test stand-in for crawl_pages.job_links (absent on this branch): links whose path contains /job."""
    return {url:label for label,url in LINK.findall(text) if '/job' in url}
SOURCE={'id':'acme-lever','provider':'lever','board':'acme','url':'https://api.lever.co/v0/postings/acme?mode=json'}
class Pages:
    """Writes public/pages/index.json and capture files in the capture contract's shape."""
    def __init__(self,root):
        self.root=Path(root)
        self.n=0
    def capture(self,pid,roles,coverage='appears_complete',result='usable',url='https://careers.example.com/jobs',schema=el.SCHEMA_IN,
                tamper=False,claim_links=None):
        self.n+=1
        at='2026-10-26T1%d:00:00+00:00'%self.n
        body='\n'.join('* [%s](https://careers.example.com/jobs/%s)'%(title,slug) for slug,title in roles)+'\n[About us](https://careers.example.com/about)\n'
        content_hash=hashlib.sha256(body.encode()).hexdigest()
        review_hash=hashlib.sha256(json.dumps(sorted(roles)).encode()).hexdigest()
        cap=self.root/'public'/'pages'/'captures'/(pid+'.md')
        captured=result in ('usable','thin')
        if captured:
            cap.parent.mkdir(parents=True,exist_ok=True)
            cap.write_text('# Acme career page capture\n\n- official_url: %s\n- content_hash: sha256:%s\n- notice: x\n\n---\n%s'%(url,'0'*64 if tamper else content_hash,body))
        prev=self.last if hasattr(self,'last') else {}
        page={'id':pid,'employer':'Acme','official_url':url,'capture_file':'public/pages/captures/%s.md'%pid,'capture_status':'usable',
              'captured_at':at if captured else prev.get('captured_at'),'content_hash':content_hash if captured else prev.get('content_hash'),
              'review_hash':review_hash if captured else prev.get('review_hash'),'review_changed_at':at,'review_basis':'job_links',
              'listing_quality':'listings_found','coverage':coverage,'flags':[],'job_links':len(roles) if claim_links is None else claim_links,'claimed_total':None,
              'last_attempt':{'at':at,'result':result,'reason':'test','http_status':200 if captured else None,'final_url':url}}
        self.last=page
        (self.root/'public'/'pages').mkdir(parents=True,exist_ok=True)
        (self.root/'public'/'pages'/'index.json').write_text(json.dumps({'schema':schema,'attempted_at':at,'pages':[page]}))
class LeadTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.conn=connect(self.root/'e.sqlite3')
        self.pages=Pages(self.root)
    def tearDown(self):
        self.conn.close();self.tmp.cleanup()
    def ingest(self,link_finder=finder):
        return el.ingest_pages(self.conn,self.root,link_finder)
    def leads(self):
        return {r['url'].rsplit('/',1)[1]:r['state'] for r in self.conn.execute('select url,state from leads')}
    def test_only_schema_3_is_read(self):
        for schema in ('public-page-capture-index-2','something-else'):
            self.pages.capture('acme',[('a','Implementation Manager')],schema=schema)
            with self.assertRaises(el.LeadError):self.ingest()
    def test_leads_from_a_capture_and_idempotent_reingest(self):
        self.pages.capture('acme',[('a1','Implementation Manager'),('b2','Data Engineer')])
        out=self.ingest()
        self.assertEqual((out['new_captures'],out['new_leads'],out['warnings']),(1,2,[]))
        self.assertEqual(self.leads(),{'a1':'open','b2':'open'})
        self.assertNotIn('about',json.dumps(self.leads()),'non-posting links are not leads')
        again=self.ingest()
        self.assertEqual((again['new_attempts'],again['new_captures'],again['new_leads']),(0,0,0))
    def test_absence_only_counts_on_a_complete_capture(self):
        self.pages.capture('acme',[('a1','A'),('b2','B'),('c3','C')])
        self.ingest()
        self.pages.capture('acme',[('a1','A'),('b2','B')],coverage='partial')
        self.ingest()
        self.assertEqual(self.leads()['c3'],'not_seen_partial_capture','a partial capture is never evidence a role is gone')
        self.pages.capture('acme',[('a1','A')],coverage='appears_complete')
        self.ingest()
        self.assertEqual(self.leads(),{'a1':'open','b2':'not_in_latest_capture','c3':'not_in_latest_capture'})
        self.pages.capture('acme',[('a1','A'),('c3','C')])
        self.ingest()
        self.assertEqual(self.leads()['c3'],'open','a lead that reappears is open again')
    def test_failed_attempt_keeps_evidence_and_marks_page_inaccessible(self):
        self.pages.capture('acme',[('a1','A')])
        self.ingest()
        self.pages.capture('acme',[],result='blocked')
        out=self.ingest()
        page=self.conn.execute('select * from pages').fetchone()
        self.assertEqual(page['state'],'inaccessible')
        self.assertIn('blocked',page['state_reason'])
        self.assertEqual((out['new_captures'],self.leads()),(0,{'a1':'open'}),'a failed attempt changes no lead')
    def test_mismatches_take_no_leads(self):
        self.pages.capture('acme',[('a1','A')],tamper=True)
        out=self.ingest()
        self.assertEqual(self.leads(),{})
        self.assertIn('does not match the index content_hash',out['warnings'][0])
        self.pages.capture('acme',[('a1','A'),('b2','B')],claim_links=5)
        out=self.ingest()
        self.assertEqual(self.leads(),{})
        self.assertIn('index says 5',out['warnings'][0])
    def test_without_the_capture_side_detector_no_leads_are_guessed(self):
        self.pages.capture('acme',[('a1','A')])
        out=el.ingest_pages(self.conn,self.root,None)
        self.assertEqual((self.leads(),self.conn.execute('select state from pages').fetchone()[0]),({},'captured'))
        self.assertIn('not available',out['warnings'][0])
    def test_changed_official_url_discards_earlier_evidence(self):
        self.pages.capture('acme',[('a1','A')])
        self.ingest()
        self.pages.capture('acme',[('z9','Z')],url='https://careers.example.com/openings')
        out=self.ingest()
        self.assertIn('official_url changed',out['warnings'][0])
        self.assertEqual(self.leads(),{'z9':'open'})
    def test_leads_link_to_ats_postings_and_never_become_postings(self):
        posting={'id':'a1','text':'Implementation Manager','hostedUrl':'https://careers.example.com/jobs/a1','descriptionPlain':'Role text',
                 'categories':{'location':'India'},'workplaceType':'remote'}
        collect([SOURCE],self.root/'feed',lambda _:[posting],lambda _:None)
        ingest_snapshot(self.conn,self.root/'feed',[SOURCE])
        before=list(self.conn.execute('select * from postings'))
        self.pages.capture('acme',[('a1','Implementation Manager'),('b2','Data Engineer')])
        out=self.ingest()
        self.assertEqual(out['matched'],1)
        row=self.conn.execute("select state,matched_posting_id from leads where url like '%/a1'").fetchone()
        self.assertEqual(tuple(row),('matched','lever:acme:a1'))
        self.assertEqual(list(self.conn.execute('select * from postings')),before,'a lead never creates or changes a posting')
        self.pages.capture('acme',[('b2','Data Engineer')])
        self.ingest()
        self.assertEqual(self.leads()['a1'],'matched','a matched lead keeps its posting link; the posting has its own availability')
    def test_leads_output_is_public_and_versioned(self):
        self.pages.capture('acme',[('a1','Implementation Manager')])
        self.ingest()
        out=el.write_leads(self.conn,self.root/'out')
        doc=json.loads((self.root/'out'/'leads.json').read_text())
        self.assertEqual((doc['schema'],doc['source_schema'],doc['lead_counts']),('page-leads-1',el.SCHEMA_IN,{'open':1}))
        self.assertIn('not screened',doc['notice'])
        self.assertEqual(out['sha256'],hashlib.sha256((self.root/'out'/'leads.json').read_bytes()).hexdigest())
ROOT=Path(__file__).resolve().parents[2]
@unittest.skipUnless(el.capture_side_job_links() and (ROOT/'public'/'pages'/'index.json').exists(),
                     'needs crawl_pages.py and committed captures (farshaikh17/Codex#1); runs on any tree that has them')
class CommittedCaptureTests(unittest.TestCase):
    def test_real_captures_yield_leads_matching_the_published_link_counts(self):
        with tempfile.TemporaryDirectory() as folder:
            conn=connect(Path(folder)/'e.sqlite3')
            out=el.ingest_pages(conn,ROOT)
            per_page={r[0]:r[1] for r in conn.execute('select page_id,count(*) from leads group by page_id')}
            published={r[0]:r[1] for r in conn.execute('select page_id,job_links from pages')}
            conn.close()
        self.assertEqual(out['warnings'],[])
        self.assertEqual({p:n for p,n in published.items() if n},per_page)
if __name__=='__main__':unittest.main()
