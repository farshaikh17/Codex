import copy,unittest
from registry import RegistryError,load,validate
EVIDENCE={'url':'https://example.com/careers','checked_at':'2026-10-26','quote':'We hire in India'}
BASE={'schema':'employer-registry-1','employers':[{'id':'acme','name':'Acme','careers_url':None,'inclusion':{'reason':'test'}}],
      'sources':[{'id':'acme-lever','employer':'acme','provider':'lever','board':'acme'}]}
def check(r):
    """Splits the combined test fixture into the two registry files."""
    return validate(r['sources'],{k:v for k,v in r.items() if k!='sources'})
def reg(**changes):
    r=copy.deepcopy(BASE)
    for k,v in changes.items():
        if k=='source': r['sources'][0].update(v)
        elif k=='employer': r['employers'][0].update(v)
        else: r[k]=v
    return r
class RegistryTests(unittest.TestCase):
    def errors(self,r):
        with self.assertRaises(RegistryError) as c: check(r)
        return ' | '.join(c.exception.errors)
    def test_repository_registry_is_valid(self):
        employers,sources,_=load()
        self.assertTrue(sources)
        self.assertTrue(all(s['employer'] in employers for s in sources))
    def test_url_derived_and_defaults_applied(self):
        _,sources,warns=check(reg())
        self.assertEqual(sources[0]['url'],'https://api.lever.co/v0/postings/acme?mode=json')
        self.assertEqual((sources[0]['enabled'],sources[0]['poll_interval_hours']),(True,5))
        self.assertIn('employer acme has no verified careers_url',warns)
    def test_duplicate_board_detected_case_insensitively(self):
        r=reg()
        r['sources'].append({'id':'acme-lever-2','employer':'acme','provider':'lever','board':'ACME'})
        self.assertIn('duplicates the lever board',self.errors(r))
    def test_duplicate_source_id(self):
        r=reg()
        r['sources'].append({'id':'acme-lever','employer':'acme','provider':'ashby','board':'acme'})
        self.assertIn('duplicate source id',self.errors(r))
    def test_malformed_identifiers(self):
        self.assertIn('board',self.errors(reg(source={'board':'acme/../x'})))
        self.assertIn('id must match',self.errors(reg(source={'id':'Acme Lever'})))
        self.assertIn('provider must be one of',self.errors(reg(source={'provider':'workday'})))
    def test_url_must_match_provider_and_board(self):
        self.assertIn('https://api.lever.co',self.errors(reg(source={'url':'https://evil.example/v0/postings/acme?mode=json'})))
        self.assertIn('does not match board',self.errors(reg(source={'url':'https://api.lever.co/v0/postings/other?mode=json'})))
        self.assertIn('not allowed',self.errors(reg(source={'url':'https://api.lever.co/v0/postings/acme?mode=json&token=x'})))
    def test_candidate_preferences_rejected(self):
        self.assertIn('unknown keys: salary_floor',self.errors(reg(source={'salary_floor':100000})))
        self.assertIn('unknown keys: candidate',self.errors(reg(employer={'candidate':'someone'})))
    def test_unknown_employer_and_no_enabled_sources(self):
        self.assertIn("employer 'nobody'",self.errors(reg(source={'employer':'nobody'})))
        self.assertIn('no enabled sources',self.errors(reg(source={'enabled':False})))
    def test_poll_interval_bounds(self):
        self.assertIn('poll_interval_hours',self.errors(reg(source={'poll_interval_hours':0.1})))
        self.assertIn('poll_interval_hours',self.errors(reg(source={'poll_interval_hours':True})))
    def test_geography_requires_explicit_evidence(self):
        self.assertIn('remote wording alone',self.errors(reg(employer={'geography':[{'region':'IN','basis':'remote','evidence':EVIDENCE}]})))
        self.assertIn('needs evidence',self.errors(reg(employer={'geography':[{'region':'IN','basis':'explicit_statement'}]})))
        check(reg(employer={'geography':[{'region':'IN','basis':'explicit_statement','evidence':EVIDENCE}]}))
    def test_job_family_requires_evidence(self):
        self.assertIn('needs evidence',self.errors(reg(employer={'job_families':[{'family':'support'}]})))
    def test_sources_file_must_stay_a_list(self):
        with self.assertRaises(RegistryError): validate({'sources':[]},{'schema':'employer-registry-1','employers':[]})
    def test_every_problem_reported_together(self):
        r=reg(source={'board':'bad board','enabled':'yes'})
        r['employers'][0]['inclusion']={}
        self.assertGreaterEqual(len(self.errors(r).split(' | ')),2)
if __name__=='__main__':unittest.main()
