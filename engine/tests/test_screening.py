import copy,json,tempfile,unittest
from pathlib import Path
from unittest import mock
from engine import candidates as cfg
from engine.benchmark import FIXTURES,run
from engine.extract import extract
from engine.gates import EvidenceError,_gate,requirement_units,screen
from engine.places import covers,places
from engine.tests.screening_cases import BASE,CASES,INTRO,REQS
ROOT=Path(__file__).resolve().parents[2]
def people():
    return {c['candidate_id']:c for c in (cfg.load(f) for f in sorted(FIXTURES.glob('*.json')))}
def config(**changes):
    base=json.loads((FIXTURES/'synthetic-impl-in.json').read_text())
    return base|changes
class BenchmarkTests(unittest.TestCase):
    def test_labelled_cases(self):
        """Primary metric: no false READY. Also no incorrect exclusion and no gate label mismatch."""
        metrics,mismatches,_=run(CASES,people())
        self.assertEqual(metrics['false_ready'],0)
        self.assertEqual(metrics['incorrect_exclusions'],0)
        self.assertEqual(mismatches,[],json.dumps(mismatches,indent=1))
        self.assertGreaterEqual(metrics['cases'],30)
class ConfigTests(unittest.TestCase):
    def write(self,folder,data,name='c.json'):
        path=Path(folder)/name
        path.write_text(json.dumps(data))
        return path
    def test_strict_keys_and_values(self):
        for bad in (config(nickname='x'),config(schema='candidate-config-0'),config(candidate_id='Has Space'),config(profile_version=''),
                    config(profile={'eligible_countries':['XX']}),config(profile={'eligible_countries':[]}),
                    config(rules={'required_gates':['vibes']}),config(rules={'salary':{'minimum':10,'currency':'rupees','period':'year'}}),
                    config(rules={'engagement':{'workplace':['beach']}}),config(profile={'application_history':[{'employer':'x','status':'maybe'}]})):
            with self.assertRaises(cfg.ConfigError):cfg.validate(bad)
    def test_real_profile_inside_repository_is_refused(self):
        with tempfile.TemporaryDirectory() as folder,mock.patch.object(cfg,'ROOT',Path(folder).resolve()):
            path=self.write(folder,config(synthetic=False))
            with self.assertRaises(cfg.ConfigError) as err:cfg.load(path)
            self.assertIn(cfg.ENV,str(err.exception))
    def test_real_profile_outside_repository_loads_with_private_history_file(self):
        with tempfile.TemporaryDirectory() as folder:
            data=config(synthetic=False)
            data['profile']=dict(data['profile'],application_history_file='me.history.json')
            del data['profile']['application_history']
            self.write(folder,[{'employer':'acme','title':'X','status':'rejected','date':'2026-01-01'}],'me.history.json')
            self.write(folder,data,'me.json')
            loaded=cfg.load_all(folder)
            self.assertEqual(loaded['synthetic-impl-in']['profile']['application_history'][0]['employer'],'acme')
    def test_duplicate_ids_and_missing_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder,config(),'a.json')
            self.write(folder,config(),'b.json')
            with self.assertRaises(cfg.ConfigError):cfg.load_all(folder)
        with mock.patch.dict('os.environ',{},clear=True):
            with self.assertRaises(cfg.ConfigError):cfg.load_all(None)
    def test_committed_candidate_files_are_synthetic(self):
        found=[p for p in ROOT.rglob('*.json') if '.git' not in p.parts and 'candidate-config' in p.read_text(errors='ignore')[:400]]
        self.assertTrue(found)
        for p in found: self.assertIs(json.loads(p.read_text())['synthetic'],True,p)
    def test_shared_code_names_no_candidate(self):
        ids=list(people())
        for p in (ROOT/'engine').glob('*.py'):
            if p.name=='benchmark.py': continue
            text=p.read_text()
            for cid in ids: self.assertNotIn(cid,text,p.name)
            self.assertNotIn('2500000',text,p.name)
class EvidenceTests(unittest.TestCase):
    def test_pass_or_fail_without_evidence_is_impossible(self):
        for result in ('pass','fail'):
            with self.assertRaises(EvidenceError):_gate(result,'no evidence')
        self.assertEqual(_gate('unknown','nothing stated')['evidence'],[])
    def test_review_needs_profile_evidence(self):
        record=extract(BASE)
        uid=requirement_units(record['fields'])[0]['id']
        with self.assertRaises(EvidenceError):screen(people()['synthetic-impl-in'],BASE,record,{uid:{'decision':'met','evidence':' '}})
        with self.assertRaises(ValueError):screen(people()['synthetic-impl-in'],BASE,record,{uid:{'decision':'probably'}})
    def test_every_gate_result_explains_itself(self):
        _,_,results=run(CASES,people())
        for r in results:
            for name,g in r['gates'].items():
                self.assertTrue(g['reason'],name)
                if g['result']!='unknown':
                    self.assertTrue(g['evidence'],name)
                    self.assertTrue(all(e.get('quote') for e in g['evidence']),name)
class MissingFactTests(unittest.TestCase):
    def test_missing_facts_stay_unknown(self):
        person=people()['synthetic-impl-in']
        bare=copy.deepcopy(person)
        bare['profile']={}
        bare['rules']={'required_gates':person['rules']['required_gates']}
        r=screen(bare,BASE|{'description':INTRO+'Requirements\n12+ years of experience\nFluent French (required)'},extract(BASE|{'description':INTRO+'Requirements\n12+ years of experience\nFluent French (required)'}))
        self.assertEqual({g:v['result'] for g,v in r['gates'].items()},{g:'unknown' for g in r['gates']})
        self.assertEqual(r['verdict'],'conditional')
        self.assertTrue(all(u['status']=='pending' for u in r['gates']['qualifications']['units']),'no shortfall without profile facts')
    def test_empty_history_differs_from_absent_history(self):
        person=copy.deepcopy(people()['synthetic-impl-in'])
        person['profile']['application_history']=[]
        self.assertEqual(screen(person,BASE,extract(BASE))['gates']['application_history']['result'],'pass')
        del person['profile']['application_history']
        self.assertEqual(screen(person,BASE,extract(BASE))['gates']['application_history']['result'],'unknown')
    def test_gate_not_required_does_not_block(self):
        person=copy.deepcopy(people()['synthetic-impl-in'])
        person['rules']['required_gates']=['geography','engagement','qualifications','application_history']
        r=screen(person,BASE|{'compensation_raw':None},extract(BASE|{'compensation_raw':None}))
        self.assertEqual((r['gates']['salary']['result'],r['gates']['salary']['required']),('unknown',False))
        self.assertNotIn('salary',r['blocking'])
class StabilityTests(unittest.TestCase):
    def test_requirement_ids_survive_unrelated_content_changes(self):
        before=[u['id'] for u in requirement_units(extract(BASE)['fields'])]
        after=[u['id'] for u in requirement_units(extract(BASE|{'description':'New opening paragraph.\n'+BASE['description']})['fields'])]
        self.assertEqual(before,after)
    def test_relevance_routes_but_never_changes_the_verdict(self):
        person=people()['synthetic-impl-in']
        relevant,other=screen(person,BASE,extract(BASE)),screen(person,BASE|{'title':'Account Executive'},extract(BASE|{'title':'Account Executive'}))
        self.assertEqual(relevant['verdict'],other['verdict'])
        self.assertNotEqual(relevant['relevance']['score'],other['relevance']['score'])
    def test_same_posting_two_candidates_independent(self):
        ps=people()
        record=extract(BASE)
        a1=screen(ps['synthetic-impl-in'],BASE,record)
        screen(ps['synthetic-design-eu'],BASE,record)
        self.assertEqual(screen(ps['synthetic-impl-in'],BASE,record),a1)
    def test_places_vocabulary(self):
        self.assertEqual(places('join us today, we are a global company, N/A'),set())
        self.assertEqual(places('work from anywhere in the US'),{'US'})
        self.assertTrue(covers(places('Remote (APAC)'),{'IN'}))
        self.assertFalse(covers(places('Remote - EMEA'),{'IN'}))
class StoreScreeningTests(unittest.TestCase):
    def test_screening_reads_the_store_and_writes_nothing(self):
        from engine.screen import run as screen_store
        from engine.store import connect,extract_pending,ingest_snapshot
        with tempfile.TemporaryDirectory() as folder:
            conn=connect(Path(folder)/'e.sqlite3')
            ingest_snapshot(conn,ROOT/'public',json.loads((ROOT/'sources.json').read_text()))
            extract_pending(conn)
            dump=lambda:list(conn.iterdump())  # every row of every table
            before=dump()
            summary,_=screen_store(conn,people())
            self.assertEqual(dump(),before)
            conn.close()
        for cid,counts in summary.items():
            self.assertEqual(counts['not_extracted'],0)
            self.assertNotIn('ready',counts['verdicts'],'qualifications cannot pass without review decisions')
class CommittedSnapshotTests(unittest.TestCase):
    def test_every_decision_on_real_postings_carries_evidence(self):
        jobs=[j for f in sorted((ROOT/'public'/'boards').glob('*.json')) for j in json.loads(f.read_text())['jobs']]
        for person in people().values():
            for j in jobs:
                r=screen(person,{'posting_id':j['key'],'board':j['board'],'title':j['title'],'canonical_url':j['url'],'description':j['description']},extract(j,j['url']))
                self.assertNotEqual(r['verdict'],'ready')
                for name,g in r['gates'].items():
                    if g['result']!='unknown': self.assertTrue(g['evidence'],(j['key'],name))
if __name__=='__main__':unittest.main()
