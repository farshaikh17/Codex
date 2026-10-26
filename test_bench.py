import copy,unittest
from bench import score
from bench.collection import run_all,run_scenario
class FixtureTests(unittest.TestCase):
    def test_labels_are_internally_consistent(self):
        self.assertEqual(score.validate(),[])
    def test_required_difficult_cases_present(self):
        covers={x for c in score.load('cases.json')['cases'] for x in c['covers']}
        covers|={x for s in score.load('collection.json')['scenarios']+score.load('collection.json')['queue_scenarios'] for x in s['covers']}
        for needed in ('remote US-only','remote India explicitly allowed','worldwide wording with a conflicting country restriction',
                       'missing salary','variable-only compensation','salary range spanning a configured threshold',
                       'mandatory experience not met','preferred experience not met','duplicate postings across URLs',
                       'reopened requisitions','expired page returning HTTP 200','failed retrieval after an earlier successful capture',
                       'same posting assessed for two candidates','queue completion and interruption recovery'):
            self.assertIn(needed,covers)
    def test_validator_catches_bad_labels(self):
        cases=score.load('cases.json')
        broken=copy.deepcopy(cases)
        exp=next(c for c in broken['cases'] if c['id']=='range-spans-threshold')['expected']['cand-us']
        exp['verdict']='ready'  # a salary range spanning the floor must not be labelled ready
        self.assertIn('contradicts the verdict rule',' '.join(score.validate(broken)))
        broken=copy.deepcopy(cases)
        next(c for c in broken['cases'] if c['id']=='remote-india-allowed')['expected']['cand-us']['gates']['qualifications']['value']='pass'
        self.assertIn('contradicts 3 years of implementation on file',' '.join(score.validate(broken)))  # caught by cross-checking PR #2's gates
        broken=copy.deepcopy(cases)
        next(c for c in broken['cases'] if c['id']=='remote-us-only')['expected']['cand-us']['gates']['geography']['basis']='Open to anyone anywhere'
        self.assertIn('is not quoted from the posting',' '.join(score.validate(broken)))
    def test_two_candidates_differ_on_one_posting(self):
        case=next(c for c in score.load('cases.json')['cases'] if c['id']=='contract-role')
        self.assertEqual((case['expected']['cand-in']['verdict'],case['expected']['cand-us']['verdict']),('ready','excluded'))
class MetricTests(unittest.TestCase):
    def test_baselines_are_separated(self):
        ready=score.score_assessments(score.baseline('always_ready'))
        exclude=score.score_assessments(score.baseline('always_exclude'))
        review=score.score_assessments(score.baseline('always_review'))
        self.assertEqual(len(ready['false_ready']),ready['pairs']-len([1 for c,cid,e in score.pairs(score.load('cases.json')) if e.get('verdict')=='ready']))
        self.assertEqual((len(exclude['false_ready']),len(exclude['incorrect_exclusions'])>0),(0,True))
        self.assertEqual((len(review['false_ready']),len(review['incorrect_exclusions']),review['retained_unknowns']),(0,0,review['expected_unknowns']))
        self.assertTrue(review['missed_ready'])  # never committing is not free either
    def test_perfect_predictions_score_clean(self):
        perfect=[{'case':c['id'],'candidate':cid,'verdict':e['verdict'],'gates':{g:v['value'] for g,v in e['gates'].items()}}
                 for c,cid,e in score.pairs(score.load('cases.json'))]
        r=score.score_assessments(perfect)
        self.assertEqual((r['false_ready'],r['missed_ready'],r['incorrect_exclusions'],r['missed_exclusions'],r['missing']),([],[],[],[],[]))
        self.assertTrue(all(a.split('/')[0]==a.split('/')[1] for a in r['gate_agreement'].values()))
    def test_missing_predictions_are_reported_not_ignored(self):
        r=score.score_assessments([])
        self.assertEqual(len(r['missing']),r['pairs'])
        self.assertEqual(r['false_ready'],[])
    def test_unreviewed_real_cases_excluded_from_gating(self):
        ids={c['id'] for c,_,_ in score.pairs(score.load('cases.json'))}
        self.assertFalse({i for i in ids if i.startswith('real-')})
    def test_extraction_duplicates_and_queue_scoring(self):
        ex=score.score_extraction([{'case':'missing-salary','fields':{'compensation':'stated'}}])
        self.assertEqual((ex['fields_checked'],ex['fields_agreed']),(1,0))
        self.assertIn('missing-salary.compensation: expected not_stated, got stated',ex['disagreements'])
        dup=score.score_duplicates([])
        self.assertEqual((dup['expected_pairs'],dup['true_pairs']),(1,0))
        self.assertEqual(score.score_duplicates([['lever:bench-a:a1','lever:bench-b:b1']])['missed'],[])
        q=score.score_queue([{'scenario':'interrupted-batch','processed':['q1','q2','q2','q3','q4','q5'],'pending_after_interrupt':['q3','q4','q5']}])
        self.assertEqual(q['interrupted-batch'],{'completed':True,'each_once':False,'pending_after_interrupt_ok':True})
class CollectionTests(unittest.TestCase):
    def test_collector_meets_every_scenario(self):
        for name,result in run_all().items():
            self.assertEqual(result['failures'],[],name)
            self.assertGreater(result['checks'],0,name)
    def test_runner_detects_a_wrong_expectation(self):
        s=copy.deepcopy(next(x for x in score.load('collection.json')['scenarios'] if x['id']=='failed-after-success'))
        s['steps'][1]['expect']['jobs']['lever:bench-a:p1']['change']='unchanged'  # a failure must never look unchanged
        _,failures=run_scenario(s)
        self.assertTrue(failures)
if __name__=='__main__':unittest.main()
