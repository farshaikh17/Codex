import unittest
from recruiter_triage import triage
from recruiter_dedup import canonical_url,group_results,diverse_shortlist
from triage_collector import analyze
from discover_public import normalize
from job_text import clean_text

def job(title='CRM Implementation Specialist',location='India remote',description=None,url='https://jobs.lever.co/demo/one'):
    return {'title':title,'location':location,'url':url,'description':description or 'Configure workflows and lead customer implementation. '*90}

class EligibilityTests(unittest.TestCase):
    # v3: an unknown qualification is listed for review and never removes a job from the review queue.
    def test_specialist_years_gap(self):
        d=triage(job('Mechanical Engineer','India','15 + years of experience in commissioning. '+'maintenance '*100),'sana')
        self.assertTrue(d.evidence['shortlist_eligible']);self.assertIn('15+ years stated in unsectioned description',d.evidence['qualification_gaps'])
    def test_sql_not_inferred_from_crm(self):
        d=triage(job(description='Advanced proficiency in Excel and SQL. '+'workflow '*100))
        self.assertTrue(d.evidence['shortlist_eligible']);self.assertIn('SQL named in unsectioned description',d.evidence['qualification_gaps'])
    def test_preferred_bi_does_not_hide_required_sql(self):
        d=triage(job(description='Advanced proficiency in SQL; BI tools strongly preferred. '+'workflow '*100))
        self.assertIn('SQL named in unsectioned description',d.evidence['qualification_gaps'])
    def test_role_location_india_is_evidence(self):
        d=triage(job(location='Remote',description='Location: Bangalore, India. '+'workflow '*100))
        self.assertTrue(d.evidence['shortlist_eligible'])
    def test_company_india_office_is_not_role_location(self):
        d=triage(job(location='Remote',description='We have an office in India. '+'workflow '*100))
        self.assertFalse(d.evidence['india_location']);self.assertEqual(d.evidence['review_tier'],'B')
    def test_sana_specialist_design_needs_review(self):
        d=triage(job('Electrical Design Engineer','India hybrid'),'sana')
        self.assertTrue(d.evidence['shortlist_eligible']);self.assertEqual(d.status,'HOLD')
    def test_seniority_gap_stays_reviewable(self):
        d=triage(job('Director, Professional Services'))
        self.assertTrue(d.evidence['shortlist_eligible']);self.assertIn('seniority level in title',d.evidence['qualification_gaps'])
    def test_sana_network_reliability_is_below_relevance(self):
        d=triage(job('Manager, Network and Infrastructure Reliability'),'sana')
        self.assertEqual((d.status,d.evidence['queue']),('HOLD','below_relevance'))
    def test_preferred_etap_does_not_become_required(self):
        d=triage(job('Energy Efficiency Engineer','India hybrid','ETAP experience is preferred. '+'energy '*100),'sana')
        self.assertFalse(d.evidence['qualification_gaps'])
    def test_short_description_is_unresolved_not_excluded(self):
        d=triage(job(description='Short teaser.'))
        self.assertEqual(d.evidence['review_tier'],'B');self.assertIn('full job description not established',d.reasons)
    def test_conflicting_auth_in_india_requires_review(self):
        d=triage(job(description='Candidates must be authorized to work in the US. '+'workflow '*100))
        self.assertEqual((d.status,d.evidence['review_tier']),('HOLD','B'))
        self.assertTrue(any('manual resolution' in r for r in d.reasons))
    def test_closed_notice_is_rejected(self):
        self.assertEqual(triage(job(description='This position is no longer accepting applications. '+'workflow '*100)).status,'REJECT')
    def test_us_location_not_global_remote(self):
        self.assertEqual(triage(job(location='Remote, United States')).status,'REJECT')
    def test_salary_us_notice_preserves_india(self):
        self.assertEqual(triage(job(description='Base salary range for residents of the United States only. '+'workflow '*100)).status,'HOLD')
    def test_hybrid_excludes_farhan(self):
        self.assertEqual(triage(job(location='India hybrid')).status,'REJECT')
    def test_hybrid_does_not_exclude_sana(self):
        self.assertEqual(triage(job('Energy Efficiency Consultant','India hybrid'),'sana').status,'HOLD')
    def test_company_remote_boilerplate_not_enough(self):
        d=triage(job(location='India',description='We are a remote-first company. '+'workflow '*100))
        self.assertEqual(d.evidence['review_tier'],'B');self.assertIn('remote arrangement not affirmatively established',d.reasons)
    def test_role_specific_remote_evidence(self):
        d=triage(job(location='India',description='This position is remote in India. '+'workflow '*100))
        self.assertTrue(d.evidence['shortlist_eligible'])
    def test_sana_foreign_authorization_visible(self):
        d=triage(job('Reliability Engineer','Remote',description='Able to work in the US without sponsorship now or in the future. '+'maintenance '*100),'sana')
        self.assertFalse(d.evidence['shortlist_eligible']);self.assertTrue(d.evidence['excerpts'])
    def test_farhan_foreign_authorization_excludes(self):
        self.assertEqual(triage(job(location='Remote',description='Candidates must be authorized to work in the US or Canada.')).status,'REJECT')
    def test_sana_tool_gap(self):
        d=triage(job('Energy Efficiency Engineer','India hybrid','Proficiency in ETAP is required. '+'energy '*100),'sana')
        self.assertTrue(d.evidence['shortlist_eligible']);self.assertTrue(d.evidence['qualification_gaps'])
    def test_salary_floor_only_explicit_fixed_inr(self):
        d=triage(job(description='Fixed annual salary: INR 1,200,000 per year. '+'workflow '*100),minimum_fixed_annual_inr=1440000)
        self.assertEqual(d.status,'REJECT')
        d=triage(job(description='Total CTC INR 1,200,000 per year. '+'workflow '*100),minimum_fixed_annual_inr=1440000)
        self.assertEqual(d.status,'HOLD')
    def test_role_separation(self):
        self.assertEqual(triage(job('CRM Product Manager')).evidence['role_family'],'adjacent')
        self.assertEqual(triage(job('Site Reliability Engineer'),'sana').evidence['queue'],'below_relevance')
        self.assertEqual(triage(job('Software Development Engineer II - CRM')).evidence['queue'],'below_relevance')
    def test_no_ready(self):
        for candidate,title in [('farhan','CRM Implementation'),('sana','Energy Efficiency Engineer')]:
            self.assertEqual(triage(job(title),candidate).status,'HOLD')

class IdentityTests(unittest.TestCase):
    def test_same_url_conflict_is_not_union_eligible(self):
        rows=self.results();rows[1]['url']=rows[0]['url']
        groups,duplicates,unique=group_results(rows)
        self.assertEqual((duplicates,unique),(1,1));self.assertFalse(groups[0]['evidence']['shortlist_eligible'])
    def results(self):
        a={'key':'lever:demo:1','title':'CRM Implementation Specialist','url':'https://jobs.lever.co/demo/1','locations':[{'text':'US only'}],'description':'workflow '*100,'workplace_type':'remote'}
        b={**a,'key':'lever:demo:2','url':'https://jobs.lever.co/demo/2','locations':[{'text':'India'}]}
        return analyze({'schema':'public-job-board-1','source':'demo','jobs':[a,b]},'farhan')['results']
    def test_url_tracking_and_apply_dedup(self):
        self.assertEqual(canonical_url('https://jobs.lever.co/demo/1/apply?utm_source=a'),canonical_url('https://jobs.lever.co/demo/1'))
    def test_greenhouse_alias(self):
        self.assertEqual(canonical_url('https://boards.greenhouse.io/demo/jobs/1?gh_src=a'),canonical_url('https://job-boards.greenhouse.io/demo/jobs/1'))
    def test_group_preserves_regional_eligibility(self):
        groups,duplicates,unique=group_results(self.results())
        self.assertEqual((len(groups),duplicates,unique),(1,0,2))
        self.assertEqual(groups[0]['key'],'lever:demo:2');self.assertEqual(groups[0]['variant_count'],2)
        self.assertEqual(groups[0]['variants'][1]['status'],'REJECT')
    def test_exact_duplicate_across_keys(self):
        rows=self.results();rows.append({**rows[1],'key':'other:demo:3','url':rows[1]['url']+'?utm_source=board'})
        self.assertEqual(group_results(rows)[1],1)
    def test_cap_and_no_padding(self):
        rows=self.results();rows=[{**rows[1],'key':str(i),'url':'https://example.com/'+str(i),'title':'Role '+str(i)} for i in range(15)]
        groups,_,_=group_results(rows);shortlist,cap=diverse_shortlist(groups,50,3)
        self.assertEqual(len(shortlist),3);self.assertEqual(cap,3)

class FeedTests(unittest.TestCase):
    def test_double_escaped_html_preserves_boundaries(self):
        self.assertEqual(clean_text('&lt;li&gt;Required ETAP&lt;/li&gt;&lt;li&gt;Travel&lt;/li&gt;'),'Required ETAP\n Travel')
    def test_greenhouse_content_is_clean(self):
        data={'jobs':[{'id':1,'title':'Implementation','absolute_url':'https://example.com/1','location':{'name':'India Remote'},'content':'<p>Configure &amp; test</p>'}]}
        self.assertEqual(normalize(data,'greenhouse','demo')[0]['description'],'Configure & test')
    def test_lever_workplace_and_lists(self):
        data=[{'id':'one','text':'Reliability','hostedUrl':'https://example.com/1','workplaceType':'hybrid','categories':{'location':'India'},'descriptionPlain':'Duties','lists':[{'text':'Requirements','content':'<li>maintenance</li>'}]}]
        row=normalize(data,'lever','demo')[0];self.assertEqual(row['workplace_type'],'hybrid');self.assertIn('Requirements maintenance',row['description'])
