"""Regression coverage for the disconnected pipeline review path; synthetic inputs only."""
import json,sqlite3,tempfile,unittest
from pathlib import Path
from engine import pipeline as pl,tracker as tk,qualify as q
from engine.extract import extract
from engine.gates import requirement_units
from engine.tests.test_match import person,job,REQ

class QualificationHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.cand=self.root/'candidates'; self.cand.mkdir()
        self.boards=self.root/'boards'; self.boards.mkdir()
        self.state=self.root/'state.sqlite'; self.out=self.root/'out'
        self.people=[person('synthetic-one',application_history=[]),person('synthetic-two',application_history=[])]
        desc='About the role\n'+'Run operating cadence and CRM workflows for the team. '*20+'\n'+REQ
        self.jobs=[job(desc=desc,pay='INR 1800000 - 2000000 base salary per year')]
        self.write()
    def tearDown(self): self.tmp.cleanup()
    def write(self):
        for p in self.people: (self.cand/(p['candidate_id']+'.json')).write_text(json.dumps(p))
        (self.boards/'acme.json').write_text(json.dumps({'source':'synthetic','jobs':self.jobs}))
    def run_once(self): return pl.run(self.cand,self.state,self.out,self.boards,offline=True)
    def state_of(self,cid='synthetic-one',key=None):
        c=sqlite3.connect(self.state)
        try: return c.execute('select state from qualifications where candidate=? and posting_id=?',(cid,key or self.jobs[0]['key'])).fetchone()[0]
        finally: c.close()
    def receipts(self,conn,p=None,key=None):
        key=key or self.jobs[0]['key']; p=p or self.people[0]
        units=tk.qualification_units(conn,key); self.assertTrue(units)
        tk.review_qualifications(conn,p,key,{u['id']:{'decision':'met','evidence':'Synthetic ops/CRM work evidence'} for u in units},by='synthetic-reviewer')
    def test_receipts_are_consumed_cached_and_candidate_scoped(self):
        self.run_once(); self.assertEqual(self.state_of(),'HIGH_FIT')
        c=tk.connect(self.state); self.receipts(c); c.close()
        r=self.run_once(); self.assertEqual(self.state_of(),'VERIFIED_READY')
        self.assertEqual(self.state_of('synthetic-two'),'HIGH_FIT')
        self.assertEqual(r['candidates']['synthetic-one']['recomputed'],1)
        r=self.run_once(); self.assertEqual(r['candidates']['synthetic-one']['reused'],1)
        c=sqlite3.connect(self.state)
        self.assertEqual(c.execute('select count(*) from postings').fetchone()[0],1)
        self.assertEqual(c.execute('select count(*) from reviews').fetchone()[0],1)
        self.assertEqual(c.execute('select count(*) from runs').fetchone()[0],3)
        self.assertEqual(c.execute('select from_state,to_state from state_events where candidate=? order by run_id',('synthetic-one',)).fetchall(),[(None,'HIGH_FIT'),('HIGH_FIT','VERIFIED_READY')]); c.close()
        for p in self.people: self.assertTrue((self.out/p['candidate_id']/'dashboard.html').exists())
    def test_receipts_do_not_survive_a_profile_change(self):
        self.run_once(); c=tk.connect(self.state); self.receipts(c); c.close()
        self.people[0]['profile_version']='s2'; self.write(); self.run_once()
        self.assertEqual(self.state_of(),'HIGH_FIT')
    def test_new_requirement_remains_pending(self):
        self.run_once(); c=tk.connect(self.state); self.receipts(c); c.close()
        self.jobs[0]['description']+='\n- Mandatory specialist credential XYZ\n'; self.write(); self.run_once()
        self.assertEqual(self.state_of(),'HIGH_FIT')
    def test_receipts_need_valid_units_reviewer_and_evidence(self):
        self.run_once(); c=tk.connect(self.state); uid=tk.qualification_units(c,self.jobs[0]['key'])[0]['id']
        for decisions,by in (({'stale':{'decision':'met','evidence':'x'}},'r'),({uid:{'decision':'met','evidence':''}},'r'),({uid:{'decision':'ready','evidence':'x'}},'r'),({uid:{'decision':'met','evidence':'x'}},'')):
            with self.assertRaises(tk.TrackerError): tk.review_qualifications(c,self.people[0],self.jobs[0]['key'],decisions,by)
        self.assertEqual(c.execute('select count(*) from reviews').fetchone()[0],0); c.close()
    def test_partial_application_history_never_clears_unknown_prior_history(self):
        self.people[0]['profile']['application_history']=None
        self.jobs.append(dict(self.jobs[0],key='synthetic:acme:2',url='https://jobs.example/2'))
        self.write(); self.run_once(); c=tk.connect(self.state)
        tk.review(c,'synthetic-one',self.jobs[0]['key'],'applied')
        self.receipts(c,key=self.jobs[1]['key']); c.close(); r=self.run_once()
        self.assertEqual(self.state_of(),'APPLIED')
        self.assertNotEqual(self.state_of(key=self.jobs[1]['key']),'VERIFIED_READY')
        self.assertEqual(r['candidates']['synthetic-one']['gate_counts']['application_history']['unknown'],1)
        self.assertTrue(r['candidates']['synthetic-one']['configuration_warnings'])
    def test_qualification_receipts_do_not_clear_missing_pay(self):
        self.jobs[0]['compensation_raw']=None; self.write(); self.run_once()
        c=tk.connect(self.state); self.receipts(c); c.close(); self.run_once()
        self.assertEqual(self.state_of(),'PAY_UNKNOWN')

class PayPeriodTests(unittest.TestCase):
    def salary(self,text,p=None): return q.qualify(p or person(),job(pay=text))['gates']['salary']['result']
    def test_monthly_base_pay_compares_to_annual_floor(self):
        self.assertEqual(self.salary('INR 120000 - 150000 base salary per month'),'pass')
        self.assertEqual(self.salary('INR 80000 - 110000 base salary per month'),'fail')
        self.assertEqual(self.salary('INR 110000 - 130000 base salary per month'),'unknown')
    def test_annual_base_pay_compares_to_monthly_floor(self):
        p=person(); p['rules']['salary']={'minimum':120000,'currency':'INR','period':'month','basis':'base'}
        self.assertEqual(self.salary('INR 1440000 - 1800000 base salary per year',p),'pass')
    def test_hourly_annual_conversion_and_ote_are_not_assumed(self):
        self.assertEqual(self.salary('USD 60000 - 80000 base salary per year'),'unknown')
        self.assertEqual(self.salary('USD 25 - 30 per hour'),'pass')
        self.assertEqual(self.salary('INR 120000 - 150000 OTE per month'),'unknown')

class EmployerHeadingTests(unittest.TestCase):
    def test_employer_headings_produce_reviewable_units_and_keep_preferred_separate(self):
        for heading in ('Qualification:','Your background','Qualifications/Requirements','Qualifications & Experience','Required Technical Skills'):
            with self.subTest(heading=heading):
                desc='About the role\n'+'Maintain plant equipment and coordinate safe service work. '*15
                desc+='\n'+heading+'\n- Experience in power plant maintenance\n'
                desc+='Desired Characteristics\n- Advanced certification preferred\nAdditional Information\nRelocation details to discuss.'
                fields=extract(job(desc=desc))['fields']
                units=requirement_units(fields)
                self.assertEqual([u['text'] for u in units],['Experience in power plant maintenance'])
                self.assertEqual(fields['requirements_preferred']['state'],'stated')
