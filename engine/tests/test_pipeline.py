"""End-to-end: discovery -> qualification -> tracker -> dashboard/CSV, offline with synthetic candidates and fakes."""
import csv,json,sqlite3,tempfile,unittest
from pathlib import Path
from engine import pipeline as pl,tracker as tk,sources_extra as sx
from engine import qualify as q
from engine.extract import extract
from engine.match import match
from engine.tests.test_match import person,job,OPS,CRM,PLANT,REQ
DESC='About the role\n'+'You will run operating cadence for the founders across functions. '*12+REQ
PLANT_DESC='About the role\n'+'Plant role at the site. '*30+'\nRequirements\n- power plant maintenance\n- turbine troubleshooting\n- 5+ years of experience in power plant operations\n'
def write_candidates(d):
    a=person('synthetic-remote'); b=person('synthetic-plant',experience=[PLANT],transferable=[],explicit_country_required=False,relocation_countries=['AE'],experience_years=9)
    b['rules']={'required_gates':['geography','qualifications','salary','application_history'],'match':{'min_fit':25,'high_fit':45}}
    for p in (a,b): (d/(p['candidate_id']+'.json')).write_text(json.dumps(p))
def write_boards(d):
    (d/'acme-lever.json').write_text(json.dumps({'source':'acme-lever','jobs':[
        dict(job(key='lever:acme:1'),employer_name='Acme'),
        dict(job('Maintenance Engineer','Dubai, UAE',PLANT_DESC,key='lever:acme:2'),workplace_type='onsite'),
        dict(job('Software Engineer III',desc='About the role\n'+'Build services. '*40+'\nRequirements\n- 5 years Go\n',key='lever:acme:3'))]}))
CONFIG={'himalayas':{'per_run':2,'max_requests':5,'retain_days':21,'queries':[{'id':'h1','q':'a','country':'India'},{'id':'h2','q':'b','country':'India'},{'id':'h3','q':'c','country':'India'}]},
        'workday':{'per_run':1,'max_requests':5,'max_details':5,'retain_days':21,'tenants':[{'id':'t','employer':'T','host':'t.example','tenant':'t','site':'s'}],
                   'queries':[{'id':'w1','text':'x'},{'id':'w2','text':'y'}]}}
class Fakes:
    def __init__(self): self.h_calls=[]; self.w_calls=[]; self.return_search=True
    def himalayas(self,qs):
        self.h_calls.append([x['id'] for x in qs])
        jobs=[dict(job('Chief of Staff','India',DESC.replace('run operating cadence for the founders across functions','lead special projects for the chief executive'),key='himalayas:beta:chief-of-staff'),_source='himalayas',employer_name='Beta')] if self.return_search else []
        return jobs,[{'source':'himalayas','query':x['id'],'status':'ok','listed':len(jobs)} for x in qs],len(qs)
    def workday(self,tenants,qs,seen):
        self.w_calls.append(([x['id'] for x in qs],set(seen)))
        j=dict(job('Plant Maintenance Engineer','Chennai, India',PLANT_DESC,key='workday:t:R1'),_source='workday:t',employer_name='T',workplace_type='onsite',discovery={'adapter_version':sx.ADAPTER_VERSION})
        new=[] if j['key'] in seen else [j]
        return new,[{'source':'workday:t','query':x['id'],'status':'ok','listed':1,'fetched':len(new)} for x in qs],len(qs)+len(new)
class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); t=Path(self.tmp.name)
        self.cand=t/'cand'; self.cand.mkdir(); write_candidates(self.cand)
        self.boards=t/'boards'; self.boards.mkdir(); write_boards(self.boards)
        self.state=t/'state.sqlite'; self.out=t/'out'; self.f=Fakes()
    def tearDown(self): self.tmp.cleanup()
    def run_once(self,offline=False,now='2026-10-30T10:00:00+00:00'):
        return pl.run(self.cand,self.state,self.out,self.boards,offline,CONFIG,{'himalayas':self.f.himalayas,'workday':self.f.workday},now)
    def results(self,cid): return json.loads((self.out/cid/'results.json').read_text())
    def test_end_to_end_durable_incremental_and_reviews(self):
        r1=self.run_once()
        self.assertEqual(r1['outcome'],'ok'); self.assertEqual(r1['discovery']['new_postings'],5)
        for cid in ('synthetic-remote','synthetic-plant'):
            for f in ('dashboard.html','jobs.csv','results.json'): self.assertTrue((self.out/cid/f).exists())
        self.assertTrue((self.out/'index.html').exists())
        remote={j['key']:j['state'] for j in self.results('synthetic-remote')['jobs']}
        plant={j['key']:j['state'] for j in self.results('synthetic-plant')['jobs']}
        self.assertEqual(remote['lever:acme:1'],'PAY_UNKNOWN'); self.assertNotIn('lever:acme:2',remote)  # onsite UAE: remote-only candidate rejects
        self.assertNotIn('lever:acme:3',remote); self.assertNotIn('lever:acme:3',plant)                 # software: screened for both
        self.assertEqual(plant['lever:acme:2'],'NEEDS_REVIEW')                                          # relocation country
        self.assertEqual(plant['workday:t:R1'],'PAY_UNKNOWN')                                           # no salary floor: never READY
        with open(self.out/'synthetic-plant'/'jobs.csv', encoding='utf-8') as f: rows=list(csv.DictReader(f))
        self.assertTrue(all(r['new_this_run']=='True' for r in rows)); self.assertTrue(all(r['apply_url'].startswith('https://') for r in rows))
        # Second run: nothing new, every assessment reused, no transitions; the search posting is not re-fetched.
        self.f.return_search=False
        r2=self.run_once(now='2026-10-31T10:00:00+00:00')
        self.assertEqual(r2['discovery']['new_postings'],0)
        for cid in r2['candidates']:
            self.assertEqual(r2['candidates'][cid]['recomputed'],0); self.assertEqual(r2['candidates'][cid]['transitions'],0)
        self.assertIn('workday:t:R1',self.f.w_calls[1][1])
        self.assertIn('himalayas:beta:chief-of-staff',{j['key'] for j in self.results('synthetic-remote')['jobs']})  # retained, not dropped
        self.assertFalse(any(j['new_this_run'] for j in self.results('synthetic-remote')['jobs']))
        self.assertEqual(self.f.h_calls,[['h1','h2'],['h3','h1']])  # least recently run first
        # A recorded application makes the posting APPLIED on the next run, and the state change is an event.
        conn=tk.connect(self.state); tk.review(conn,'synthetic-remote','lever:acme:1','applied',at='2026-10-31T12:00:00+00:00'); conn.close()
        self.run_once(offline=True,now='2026-11-01T10:00:00+00:00')
        j=next(j for j in self.results('synthetic-remote')['jobs'] if j['key']=='lever:acme:1')
        self.assertEqual((j['state'],j['review']['decision']),('APPLIED','applied'))
        _c=sqlite3.connect(self.state)
        ev=_c.execute("select from_state,to_state from state_events where posting_id='lever:acme:1' and candidate='synthetic-remote' order by run_id").fetchall()
        ok_runs=_c.execute('select count(*) from runs where outcome="ok"').fetchone()[0]
        _c.close()
        self.assertEqual(ev,[(None,'PAY_UNKNOWN'),('PAY_UNKNOWN','APPLIED')])
        self.assertEqual(ok_runs,3)
    def test_private_paths_refused_inside_repository(self):
        with self.assertRaises(SystemExit): pl.run(self.cand,self.state,pl.ROOT/'tmp-out',self.boards,True,CONFIG)
        with self.assertRaises(tk.TrackerError): tk.connect(pl.ROOT/'state.sqlite')
    def test_matching_is_batch_independent(self):
        p=person(); jobs=[job('Chief of Staff %d'%i,key='synthetic:a:%d'%i,desc=DESC if i%2 else None) for i in range(30)]
        alone=q.qualify(p,jobs[1])['fit']
        batch=next(r for r in q.run({'synthetic-remote':p},jobs)['synthetic-remote']['jobs'] if r['key']=='synthetic:a:1')
        self.assertEqual(alone,batch['fit'])
    def test_entry_level_titles_are_capped(self):
        p=person(experience_years=9); j=job('Operations Internship Program',desc=DESC)
        self.assertLessEqual(match(j,extract(j)['fields'],p['profile'])['score'],15)
    def test_it_infrastructure_title_is_not_industrial_fit(self):
        p=person('synthetic-plant',experience=[PLANT],transferable=[])
        j=job('IT Infrastructure Operations Engineer II','India',PLANT_DESC)
        self.assertLessEqual(match(j,extract(j)['fields'],p['profile'])['score'],15)
    def test_experience_gap_is_kept_and_ranked_low_not_rejected(self):
        p=person('synthetic-plant',experience=[PLANT],transferable=[],explicit_country_required=False,experience_years=9)
        p['rules']={'required_gates':['geography','qualifications','salary','application_history'],'match':{'min_fit':25,'high_fit':45}}
        sectioned=job('Maintenance Engineer','India',PLANT_DESC.replace('5+ years','15+ years'))
        self.assertEqual(q.qualify(p,sectioned)['state'],'REJECT')  # parsed mandatory line: the qualifications gate's confirmed shortfall
        loose=job('Maintenance Engineer','India','The plant team runs power plant maintenance and turbine troubleshooting at the site. '*12+
                  'You will need 15+ years of experience in power plant operations and maintenance planning.')
        r=q.qualify(p,loose); self.assertEqual(r['state'],'EXPERIENCE_GAP'); self.assertIn('15+ years',r['why'])
    def test_ashby_ote_salary_component_is_not_base(self):
        raw=json.dumps({'source':'ashby.compensationTiers','tiers':[{'title':'India','components':[{'compensationType':'Salary','currencyCode':'INR','interval':'1 YEAR','minValue':3575300,'maxValue':4996800,'summary':'OTE ₹35,75,300 – ₹49,96,800'}]}]})
        r=q.qualify(person(),job(pay=raw)); self.assertNotEqual(r['gates']['salary']['result'],'pass')
class WorkdayTests(unittest.TestCase):
    T={'id':'t','employer':'T','host':'t.example','tenant':'t','site':'s'}
    INFO={'title':'Plant Engineer','jobReqId':'R9','externalUrl':'https://t.example/s/job/x','remoteType':'Field/Customer Site','startDate':'2026-10-27',
          'jobDescription':'<p>Run the plant.</p><ul><li>5 years power plant</li></ul>','jobRequisitionLocation':{'descriptor':'Chennai','country':{'descriptor':'India'}},'posted':True,'canApply':True}
    def test_search_and_detail_parse_and_seen_postings_are_not_refetched(self):
        calls=[]
        def http(url,data=None):
            calls.append(url)
            return {'jobPostings':[{'externalPath':'/job/x','bulletFields':['R9']},{'externalPath':'/job/y','bulletFields':['R8']}]} if data else {'jobPostingInfo':self.INFO}
        jobs,log=sx.workday([self.T],[{'id':'q','text':'x'}],{'workday:t:R8'},sx.Budget(10,sleep=lambda s:None),'2026-10-30',http=http,fetch_text=lambda u:'User-agent: *\nAllow: /\n')
        self.assertEqual([j['key'] for j in jobs],['workday:t:R9']); self.assertEqual(len(calls),2)
        j=jobs[0]; self.assertEqual((j['workplace_type'],j['locations'][0]['text']),('onsite','Chennai, India')); self.assertIn('5 years power plant',j['description'])
    def test_robots_disallow_and_unavailable_robots_fail_closed(self):
        for robots in ('User-agent: *\nDisallow: /wday/\n',None):
            def ft(u,r=robots):
                if r is None: raise OSError('down')
                return r
            jobs,log=sx.workday([self.T],[{'id':'q','text':'x'}],set(),sx.Budget(10,sleep=lambda s:None),'now',http=lambda *a,**k:self.fail('fetched'),fetch_text=ft)
            self.assertEqual((jobs,log[0]['status']),([],'robots_disallowed'))
    def test_detail_budget_truncation_keeps_query_due(self):
        http=lambda url,data=None:{'jobPostings':[{'externalPath':'/job/%d'%i,'bulletFields':['R%d'%i]} for i in range(5)]} if data else {'jobPostingInfo':{**self.INFO,'jobReqId':url[-1]}}
        jobs,log=sx.workday([self.T],[{'id':'q','text':'x'}],set(),sx.Budget(20,sleep=lambda s:None),'now',max_details=2,http=http,fetch_text=lambda u:'')
        self.assertEqual(len(jobs),2); self.assertTrue(log[0]['truncated'])
    def test_committed_discovery_config_is_valid_and_candidate_agnostic(self):
        c=sx.load_config(); text=sx.CONFIG.read_text().lower()
        self.assertGreaterEqual(len(c['workday']['tenants']),4); self.assertNotIn('farhan',text); self.assertNotIn('sana',text)
