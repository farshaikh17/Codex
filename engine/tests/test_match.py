"""Career matching and qualification states (synthetic profiles only)."""
import json,tempfile,unittest
from pathlib import Path
from engine import candidates as cfg
from engine import qualify as q
from engine.extract import extract
from engine.match import match
import role_search

OPS={'id':'ops','title':'Founder/operator','skills':['founder','business operations','SOPs','process improvement','hiring','stakeholder management'],
     'domains':['startup'],'functions':['operations','chief of staff']}
CRM={'id':'crm','title':'CRM lead','skills':['CRM','workflows','webhooks','integrations','team lead'],'domains':['SaaS'],'functions':['implementation']}
PLANT={'id':'plant','title':'Power plant O&M','skills':['power plant','maintenance','troubleshooting','reliability','turbine'],'domains':['power'],'functions':['maintenance engineer']}
def person(cid='synthetic-remote',**profile):
    base={'schema':'candidate-config-1','candidate_id':cid,'synthetic':True,'profile_version':'s1','rules_version':'s1',
          'profile':{'eligible_countries':['IN'],'explicit_country_required':True,'experience':[OPS,CRM],
                     'transferable':[{'reason':'founder/operator: chief of staff','job_terms':['chief of staff','head of operations'],'from':['ops']}]},
          'rules':{'required_gates':['geography','engagement','qualifications','salary','application_history'],
                   'engagement':{'workplace':['remote'],'employment_types':None},
                   'salary':[{'minimum':1440000,'currency':'INR','period':'year','basis':'base'},{'minimum':25,'currency':'USD','period':'hour','basis':'base'}],
                   'match':{'min_fit':25,'high_fit':45}}}
    base['profile'].update(profile); return cfg.validate(base)
REQ='Requirements\n- Founder or startup business operations experience\n- Build SOPs and drive process improvement\n- Hiring and stakeholder management\n- CRM workflows and integrations\n'
def job(title='Chief of Staff',loc='Remote, India',desc=None,pay=None,key='synthetic:acme:1'):
    return {'key':key,'title':title,'url':'https://jobs.example/1','locations':[{'text':loc,'source':'location'}],'workplace_type':'remote',
            'description':desc or ('About the role\nYou will run operating cadence for the founders across functions. '*12+REQ),'compensation_raw':pay}
class MatchTests(unittest.TestCase):
    def test_cross_industry_operator_role_matches_career_history(self):
        j=job(); m=match(j,extract(j)['fields'],person()['profile'])
        self.assertGreaterEqual(m['score'],45); self.assertTrue(m['transferable']); self.assertIn('ops',m['experience_used'])
        self.assertFalse(m['unmatched_mandatory'])
    def test_specialist_title_without_evidence_is_capped(self):
        j=job('Software Development Engineer III - CRM',desc='About the role\n'+'Build services for users. '*30+'\n'+'Requirements\n- CRM workflows and integrations\n- webhooks\n')
        self.assertLessEqual(match(j,extract(j)['fields'],person()['profile'])['score'],15)
    def test_function_in_title_exempts_a_bare_engineer(self):
        j=job('Implementation Engineer',desc='About the role\n'+'Customer onboarding for clients. '*30+'\n'+REQ)
        self.assertGreater(match(j,extract(j)['fields'],person()['profile'])['score'],15)
class StateTests(unittest.TestCase):
    def state(self,j,p=None): return q.qualify(p or person(),j)['state']
    def test_unknown_pay_is_kept(self): self.assertEqual(self.state(job()),'PAY_UNKNOWN')
    def test_hourly_floor_pass_is_high_fit_and_below_rejects(self):
        self.assertEqual(self.state(job(pay='$30 - $40 USD per hour')),'HIGH_FIT')
        self.assertEqual(self.state(job(pay='$10 - $15 USD per hour')),'REJECT')
    def test_worldwide_without_india_needs_review(self):
        self.assertEqual(self.state(job(loc='Remote, Worldwide')),'NEEDS_REVIEW')
    def test_foreign_location_and_existing_rights_reject(self):
        self.assertEqual(self.state(job(loc='Remote, United States')),'REJECT')
        self.assertEqual(self.state(job(desc='About the role\n'+'Run ops for the team. '*30+'\n'+REQ+'- Candidates must be authorized to work in the US\n')),'NEEDS_REVIEW')  # India also named
        self.assertEqual(self.state(job(loc='Remote',desc='About the role\n'+'Run ops for the team. '*30+'\n'+REQ+'- Candidates must be authorized to work in the US\n')),'REJECT')
    def test_relocation_country_is_review_not_reject(self):
        p=person('synthetic-reloc',experience=[PLANT],transferable=[],explicit_country_required=False,relocation_countries=['AE'])
        j=job('Maintenance Engineer','Dubai, UAE','About the role\n'+'Plant role at the site. '*30+'\n'+'Requirements\n- power plant maintenance\n- turbine troubleshooting\n')
        self.assertEqual(self.state(j,p),'NEEDS_REVIEW')
        self.assertEqual(self.state(job('Maintenance Engineer','Houston, United States',j['description']),p),'REJECT')
    def test_work_rights_outside_requirement_sections_are_found(self):
        d='About the role\n'+'Run ops for the team. '*30+'\n'+REQ+'Benefits\nHealth cover.\nApplicants must be authorized to work in the United States without sponsorship.\n'
        self.assertEqual(self.state(job(loc='Remote',desc=d)),'REJECT')
        self.assertEqual(self.state(job(loc='Remote',desc=d.replace('be authorized to work in the United States without sponsorship','have existing authorisation to work in the Netherlands'))),'REJECT')
    def test_dated_fx_converts_annual_pay_and_absent_fx_keeps_unknown(self):
        p=person();self.assertEqual(self.state(job(pay='$20,000 - $25,000 USD per year'),p),'PAY_UNKNOWN')
        p['rules']['fx']={'as_of':'2026-10-30','source':'synthetic test rate','rates':{'USD':{'INR':80}}};cfg.validate(p)
        self.assertEqual(self.state(job(pay='$20,000 - $25,000 USD per year'),p),'HIGH_FIT')   # 1.6M-2.0M INR >= 1.44M
        self.assertEqual(self.state(job(pay='$5,000 - $8,000 USD per year'),p),'REJECT')
    def test_fx_requires_date_and_source(self):
        p=person();p['rules']['fx']={'rates':{'USD':{'INR':80}}}
        with self.assertRaises(cfg.ConfigError): cfg.validate(p)
    def test_thin_description_is_hold(self): self.assertEqual(self.state(job(desc='Chief of staff role.')),'HOLD')
    def test_low_fit_is_screened_not_rejected(self):
        self.assertEqual(self.state(job('Pastry Chef',desc='About the role\n'+'Bake bread for the shop. '*30+'\n'+'Requirements\n- 5 years pastry\n')),'SCREENED')
    def test_regional_copies_group_without_losing_requisitions(self):
        out=q.run({'synthetic-remote':person()},[job(),job(loc='Remote, United States',key='synthetic:acme:2')])['synthetic-remote']
        self.assertEqual(out['groups'],1); self.assertEqual(out['jobs'][0]['regional_variants'][0]['key'],'synthetic:acme:2')
    def test_aggregator_copy_of_ats_posting_merges_and_other_employers_do_not(self):
        ats=job(key='lever:acme:1');copy=dict(job(key='himalayas:acme-inc:chief-of-staff'),description=ats['description']+' Originally posted on Himalayas')
        other=job(key='himalayas:other:chief-of-staff',desc='About the role\n'+'Bake bread and run the shop floor. '*30+'\nRequirements\n- pastry\n')
        out=q.run({'synthetic-remote':person()},[ats,copy,other])['synthetic-remote']
        self.assertEqual(out['groups'],2)
        g=next(j for j in out['jobs']+[{}] if j.get('key')=='lever:acme:1')
        self.assertEqual([d['key'] for d in g['cross_source_duplicates']],['himalayas:acme-inc:chief-of-staff'])
    def test_outputs_must_stay_outside_repository(self):
        with self.assertRaises(SystemExit): q.main(['--candidates',str(Path(__file__).parent/'fixtures'/'candidates'),'--out',str(Path(__file__).parent/'tmp-out')])
class ConfigTests(unittest.TestCase):
    def test_transferable_must_reference_known_experience(self):
        with self.assertRaises(cfg.ConfigError): person(transferable=[{'reason':'x','job_terms':['a'],'from':['missing']}])
class DiscoveryTests(unittest.TestCase):
    def test_role_search_listings_become_qualifiable_jobs(self):
        data={'jobs':[{'guid':'https://himalayas.app/companies/acme/jobs/chief-of-staff','title':'Chief of Staff','companySlug':'acme',
                       'locationRestrictions':['India'],'description':'<p>Run operations</p>','minSalary':40000,'maxSalary':60000,'currency':'USD','salaryPeriod':'annual'}]}
        j=role_search.as_jobs(data,'chief of staff','India','2026-10-30')[0]
        self.assertEqual((j['workplace_type'],j['locations'][0]['text'],j['_source']),('remote','India','himalayas'))
        self.assertIn('aggregator-reported',j['compensation_raw']); self.assertEqual(j['description'],'Run operations')
if __name__=='__main__':unittest.main()
