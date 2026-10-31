"""v3 repair contract: separate states; unknown qualifications stay reviewable; only documented hard rules reject."""
import json,tempfile,unittest
from pathlib import Path
from recruiter_triage import triage,review_key
from triage_collector import analyze
import weekend_trial,discover_public

def job(title='CRM Implementation Specialist',location='India',description=None,workplace='remote'):
    return {'title':title,'location':location,'url':'https://jobs.lever.co/demo/1','description':description or 'Configure workflows and lead customer implementation. '*90,'workplace_type':workplace}
def raw(location,workplace='remote'):
    return {'locations':[{'text':location,'source':'location'}],'workplace_type':workplace}
def t(title='CRM Implementation Specialist',location='India',description=None,candidate='farhan',workplace='remote'):
    j=job(title,location,description,workplace);return triage(j,candidate,raw=raw(location,workplace))

class UnknownQualificationsStayReviewable(unittest.TestCase):
    def test_required_certification_sql_edi_and_years_are_checks_not_blockers(self):
        d=t(description='Requirements:\n- 12+ years of experience\n- Salesforce certification required\n- Advanced SQL\n- ANSI X12 EDI\n'+'Configure workflows. '*90)
        self.assertEqual((d.status,d.evidence['queue']),('HOLD','review'))
        self.assertEqual(d.evidence['states']['qualifications']['state'],'unknown')
        self.assertTrue(len(d.evidence['qualification_gaps'])>=3)
    def test_states_are_separate(self):
        self.assertEqual(set(t().evidence['states']),{'relevance','eligibility','qualifications','pay','application_history'})
    def test_never_ready(self):
        for c,title in (('farhan','CRM Implementation Specialist'),('sana','Electrical Maintenance Engineer')):
            self.assertIn(t(title,candidate=c).status,('HOLD','REJECT'))

class FarhanHardRules(unittest.TestCase):
    def test_explicit_india_remote_is_tier_a(self):
        d=t();self.assertEqual((d.evidence['india_location'],d.evidence['review_tier']),(True,'A'))
    def test_apac_or_worldwide_alone_is_not_india(self):
        for loc in ('APAC','Worldwide'):
            d=t(location=loc);self.assertFalse(d.evidence['india_location']);self.assertEqual(d.evidence['review_tier'],'B')
    def test_onsite_or_hybrid_rejects(self):
        self.assertEqual(t(location='Bengaluru, India',workplace='hybrid').status,'REJECT')
    def test_foreign_only_location_rejects(self):
        self.assertEqual(t(location='Remote, United States').status,'REJECT')
    def test_existing_foreign_rights_reject(self):
        for text in ('Candidates must be authorized to work in the US or Canada.','Must be located in Japan and have full working rights in Japan.'):
            self.assertEqual(t(location='Remote',description=text+' '+'Configure workflows. '*90).status,'REJECT')
    def test_us_salary_notice_is_not_a_hiring_restriction(self):
        d=t(description='The base salary range is currently for residents of the United States only. '+'Configure workflows. '*90)
        self.assertEqual(d.status,'HOLD')
    def test_support_first_and_quota_sales_titles_reject(self):
        for title in ('Customer Support Representative','Technical Support Engineer','Account Executive - CRM','BDR Support Apprentice'):
            self.assertEqual(t(title).status,'REJECT',title)
    def test_specialist_title_is_below_relevance_not_rejected(self):
        d=t('Software Development Engineer II - CRM');self.assertEqual((d.status,d.evidence['queue']),('HOLD','below_relevance'))
    def test_ai_or_automation_product_ownership_is_reviewable(self):
        self.assertEqual(t('Principal Product Manager - Voice AI').evidence['queue'],'review')
        self.assertEqual(t('Senior Product Manager - Payments').evidence['queue'],'below_relevance')

class SanaPolicy(unittest.TestCase):
    def test_overseas_without_rights_statement_is_unresolved_not_excluded(self):
        d=t('Electrical Commissioning Engineer','Sydney',candidate='sana',workplace='onsite')
        self.assertEqual((d.status,d.evidence['queue'],d.evidence['review_tier']),('HOLD','review','B'))
    def test_no_sponsorship_or_citizen_only_rejects(self):
        for text in ('Able to work in the US without sponsorship now or any time in the future.','Candidates need to be either SGP citizen or PR holder.',
                     '· Eligible to work full-time in Ireland.','· Candidates need to be either an SGP citizen or a PR holder.'):
            self.assertEqual(t('Electrical Commissioning Engineer','Overseas',text+' '+'Commissioning of switchgear. '*90,'sana','onsite').status,'REJECT',text)
    def test_mandatory_masters_or_bee_rejects_but_alternatives_do_not(self):
        req='Requirements:\n- Master\'s degree in Energy Engineering is mandatory\n'+'- energy audits\n'*90
        self.assertEqual(t('Energy Efficiency Consultant','Pune, India',req,'sana','onsite').status,'REJECT')
        alt='Requirements:\n- Bachelor\'s or Post Graduation Degree in Electrical Engineering\n- BEE certified energy auditor preferred\n'+'- energy audits\n'*90
        self.assertEqual(t('Energy Efficiency Consultant','Pune, India',alt,'sana','onsite').status,'HOLD')
    def test_customer_experience_cx_is_not_commissioning(self):
        self.assertEqual(t('Senior CX Platform Engineer','Remote',candidate='sana').evidence['queue'],'below_relevance')
        self.assertEqual(t('Commissioning (Cx) Engineer - Electrical','India',candidate='sana',workplace='onsite').evidence['queue'],'review')
    def test_onsite_india_is_reviewable_for_sana(self):
        self.assertEqual(t('Lead Commissioning (Cx) Engineer - Electrical','India',candidate='sana',workplace='onsite').evidence['review_tier'],'A')
    def test_policies_do_not_leak_between_candidates(self):
        j=('Electrical Maintenance Engineer','Bengaluru, India')
        self.assertEqual(t(*j,candidate='sana',workplace='onsite').evidence['queue'],'review')
        self.assertEqual(t(*j,candidate='farhan',workplace='onsite').status,'REJECT')

class RepeatedRunsAndSources(unittest.TestCase):
    def board(self,content_hash='h1'):
        return {'schema':'public-job-board-1','source':'demo-lever','jobs':[{'key':'lever:demo:1','title':'CRM Implementation Specialist',
                'url':'https://jobs.lever.co/demo/1','locations':[{'text':'India'}],'workplace_type':'remote','content_hash':content_hash,
                'description':'Configure workflows and lead customer implementation. '*90}]}
    def test_review_key_is_stable_and_changes_with_content(self):
        a=analyze(self.board(),'farhan')['results'][0]['review_key']
        self.assertEqual(a,analyze(self.board(),'farhan')['results'][0]['review_key'])
        self.assertNotEqual(a,analyze(self.board('h2'),'farhan')['results'][0]['review_key'])
        self.assertNotEqual(a,analyze(self.board(),'sana')['results'][0]['review_key'])
        self.assertEqual(a,review_key('farhan','lever:demo:1','h1'))
    def test_completed_reviews_are_skipped_and_receipts_must_be_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            boards=Path(tmp)/'public'/'boards';boards.mkdir(parents=True);(boards/'demo-lever.json').write_text(json.dumps(self.board()))
            receipts=Path(tmp)/'receipts.json';receipts.write_text(json.dumps([review_key('farhan','lever:demo:1','h1')]))
            r=weekend_trial.run(boards,'farhan',5,str(receipts))
            self.assertEqual((r['completed_reviews_skipped'],r['shortlist_size']),(1,0))
            inside=Path(weekend_trial.__file__).resolve().parent/'receipts-test.json'
            with self.assertRaises(ValueError): weekend_trial._completed(str(inside))
    def test_failed_source_jobs_are_last_known_good(self):
        out=analyze(self.board(),'farhan',{'demo-lever':{'status':'failed','checked_at':'2026-10-30T00:00:00+00:00'}})['results'][0]
        self.assertEqual(out['source_status'],'failed');self.assertTrue(out['reasons'][0].startswith('source failed'))
    def test_smartrecruiters_is_not_fetched(self):
        with self.assertRaises(ValueError): discover_public.fetch({'provider':'smartrecruiters','board':'Ramboll3','candidate':'sana'})
        self.assertFalse(any(s['provider']=='smartrecruiters' for s in json.loads((Path(discover_public.__file__).with_name('discovery_sources.json')).read_text())))

if __name__=='__main__':unittest.main()
