"""Max discovery (20 Nov 2026): the parallel collector parts are merged once (engine/merge_collect.py), every job-site row is pre-screened with the
Worker's screen before the duplicate check (engine/prescreen.py), more_sources.py runs one group of sources per part, and discovery.yml wires it.
Offline: a fake scorer stands in for scripts/prescore.mjs (tested in dashboard/test/prescore.test.mjs)."""
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import merge_collect as mc
from engine import prescreen as ps
from engine import reposters

ROOT = Path(__file__).resolve().parents[2]


def job(i, title='Maintenance Engineer', company='Acme', cands=('sana_ansari',), src='indeed'):
    return {'id': f'js:{src}:{i}', 'url': f'https://x.example/{i}', 'title': title, 'company': company, 'ats_type': src, 'candidates': list(cands)}


class Prescreen(unittest.TestCase):
    CANDS = [{'id': 'farhan_shaikh', 'qualification_threshold': 70}, {'id': 'sana_ansari', 'qualification_threshold': 60}]

    def scorer(self, table):
        def score(items):
            return [{'k': k, 'cid': c, 'score': table[(j['id'], c)][0], 'status': table[(j['id'], c)][1]} for k, (c, j) in enumerate(items)]
        return score

    def test_keeps_a_person_only_where_the_posting_can_reach_a_list(self):
        jobs = [job(1, cands=('sana_ansari', 'farhan_shaikh')), job(2), job(3), job(4, src='workday')]
        table = {('js:indeed:1', 'sana_ansari'): (75, 'NEEDS_REVIEW'), ('js:indeed:1', 'farhan_shaikh'): (54, 'NEEDS_REVIEW'),
                 ('js:indeed:2', 'sana_ansari'): (46, 'NEEDS_REVIEW'), ('js:indeed:3', 'sana_ansari'): (90, 'INELIGIBLE'),
                 ('js:workday:4', 'sana_ansari'): (45, 'NEEDS_REVIEW')}
        kept, rep = ps.prescreen(jobs, self.CANDS, self.scorer(table))
        self.assertEqual([(j['id'], j['candidates']) for j in kept], [('js:indeed:1', ['sana_ansari']), ('js:indeed:2', ['sana_ansari'])],
                         "Farhan at 54 is under his floor (55); Sana's floor is 46; an ineligible row never goes on")
        self.assertEqual(rep['per_person']['sana_ansari'], {'in': 4, 'kept': 2, 'at_threshold': 1, 'floor': 46})
        self.assertEqual(rep['by_source'], {'indeed': {'in': 3, 'kept': 2}, 'workday': {'in': 1, 'kept': 0}})
        self.assertEqual((rep['in'], rep['kept']), (4, 2))

    def test_a_failed_pre_score_keeps_every_row(self):
        with tempfile.TemporaryDirectory() as d:
            raw = Path(d, 'raw.json')
            raw.write_text(json.dumps({'source': 'job_sites', 'jobs': [job(1), job(2)]}))
            Path(d, 'c.json').write_text(json.dumps(self.CANDS))
            with mock.patch.object(ps, 'node_scorer', lambda *a: (lambda items: (_ for _ in ()).throw(RuntimeError('node missing')))), \
                    mock.patch('sys.argv', ['x', '--raw', str(raw), '--candidates', str(Path(d, 'c.json')), '--work', d, '--report', str(Path(d, 'r.json'))]):
                self.assertEqual(ps.main(), 0)
            self.assertEqual(len(json.loads(raw.read_text())['jobs']), 2)
            self.assertEqual(json.loads(Path(d, 'r.json').read_text())['skipped'], 'RuntimeError')


class Merge(unittest.TestCase):
    def write(self, root, name, jobs=None, **reports):
        d = Path(root, name)
        d.mkdir()
        if jobs is not None:
            (d / 'jobsite_raw.json').write_text(json.dumps({'source': 'job_sites', 'jobs': jobs}))
        for k, v in reports.items():
            (d / f'{k}.json').write_text(json.dumps(v))
        return d

    def test_parts_are_joined_once_with_their_reports(self):
        with tempfile.TemporaryDirectory() as root:
            a = self.write(root, 'collect-jobsites-sana-india', [job(1), job(2)],
                           jobsite_report={'shard': 'sana_india', 'searches': 3, 'blocked': 1, 'returned': 30, 'selected': 2, 'by_site': {'indeed': 2}, 'robots': {'indeed': 'disallowed'}, 'log': [{'a': 1}]})
            b = self.write(root, 'collect-jobsites-farhan', [{**job(1), 'candidates': ['farhan_shaikh']}],
                           jobsite_report={'shard': 'farhan', 'searches': 2, 'blocked': 0, 'returned': 5, 'selected': 1, 'by_site': {'indeed': 1, 'linkedin': 0}, 'log': [{'b': 1}]})
            c = self.write(root, 'collect-more-big', [job(3, src='workday')], more_sources_report={'workday': {'read': 9, 'kept': 1}})
            e = self.write(root, 'collect-boards', [], boards_report={'remoteok': {'read': 4, 'kept': 0}})
            missing = Path(root, 'collect-more-successfactors')
            missing.mkdir()
            out = Path(root, 'work')
            summary = mc.merge([c, missing, b, a, e], out)
            raw = json.loads((out / 'jobsite_raw.json').read_text())['jobs']
            self.assertEqual([j['id'] for j in raw], ['js:indeed:1', 'js:indeed:2', 'js:workday:3'], 'job sites first, then boards and more sources')
            self.assertEqual(sorted(raw[0]['candidates']), ['farhan_shaikh', 'sana_ansari'], 'one posting found by two searches keeps both people')
            rep = json.loads((out / 'jobsite_report.json').read_text())
            self.assertEqual((rep['searches'], rep['blocked'], rep['returned'], rep['selected']), (5, 1, 35, 3))
            self.assertEqual(rep['by_site'], {'indeed': 3, 'linkedin': 0})
            self.assertEqual(sorted(rep['shards']), ['farhan', 'sana_india'])
            self.assertEqual(json.loads((out / 'more_sources_report.json').read_text()), {'workday': {'read': 9, 'kept': 1}})
            self.assertEqual(json.loads((out / 'boards_report.json').read_text()), {'remoteok': {'read': 4, 'kept': 0}})
            self.assertEqual(summary['parts']['collect-more-successfactors'], 'missing')
            self.assertEqual(summary['jobs'], 3)

    def test_reposters_are_capped_across_parts(self):
        n = reposters.REPOSTER_CAP
        with tempfile.TemporaryDirectory() as root:
            a = self.write(root, 'collect-more-workable', [job(i, company='Jobgether') for i in range(n)])
            b = self.write(root, 'collect-more-big', [job(i + 10, company='Jobgether') for i in range(n)] + [job(99)])
            mc.merge([a, b], Path(root, 'w'))
            raw = json.loads(Path(root, 'w', 'jobsite_raw.json').read_text())['jobs']
        self.assertEqual(sum(1 for j in raw if j['company'] == 'Jobgether'), n)
        self.assertIn('js:indeed:99', [j['id'] for j in raw])

    def test_clients_and_the_other_person_are_matched_by_their_role_rules(self):
        profs = {'sana_ansari': {'role': 'engineer', 'exclude': 'software'},
                 'client_1': {'role': '(^|[^a-z0-9])(plant engineer)($|[^a-z0-9])', 'exclude': None},
                 'farhan_shaikh': {'role': 'x^', 'wide_role': 'implementation', 'exclude': None}}
        jobs = [job(1, title='Plant Engineer'), job(2, title='Implementation Manager', cands=()), job(3, title='Software Engineer', cands=())]
        self.assertEqual(mc.attribute(jobs, profs), 2)
        self.assertEqual([sorted(j['candidates']) for j in jobs], [['client_1', 'sana_ansari'], ['farhan_shaikh'], []])


class MoreSourcesOnly(unittest.TestCase):
    def test_only_runs_the_named_group(self):
        from engine import more_sources as ms
        ran = []

        def src(name):
            def f(*a, **k):
                ran.append(name)
                return iter([])
            return f
        names = ('workable', 'eightfold', 'siemens_energy', 'successfactors', 'smartrecruiters', 'workday', 'oracle_hcm', 'jibe', 'watch_boards',
                 'arbeitnow', 'un_careers', 'eures', 'adzuna')
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'p.json').write_text(json.dumps({'sana_ansari': {'role': 'engineer', 'exclude': '', 'home': 'india'}}))
            patches = [mock.patch.object(ms, n, src(n)) for n in names]
            for p in patches:
                p.start()
            try:
                with mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'p.json')), '--out', d, '--only', 'successfactors,workday']):
                    ms.main()
            finally:
                for p in patches:
                    p.stop()
            rep = json.loads(Path(d, 'more_sources_report.json').read_text())
        self.assertEqual(sorted(ran), ['successfactors', 'workday'])
        self.assertEqual(sorted(rep), ['successfactors', 'workday'])


class Workflow(unittest.TestCase):
    WF = (ROOT / '.github' / 'workflows' / 'discovery.yml').read_text()

    def job(self, name):
        i = self.WF.index(f'\n  {name}:\n')
        j = re.search(r'\n  [a-z][a-z_-]*:\n', self.WF[i + 3:])
        return self.WF[i:i + 3 + j.start()] if j else self.WF[i:]

    def test_collectors_run_in_parallel_without_credentials(self):
        c = self.job('collect')
        self.assertIn('matrix:', c)
        self.assertIn('fail-fast: false', c)
        self.assertNotIn('CLOUDFLARE', c, 'the collector parts never get database credentials')
        self.assertIn('--builtin-profiles work/profiles.json', c)
        self.assertIn('actions/upload-artifact@v4', c)
        for f in ('candidates.json', 'taste_rows.json', 'rescore.json', 'profiles.json\n'):
            self.assertNotIn(f, c.split('upload-artifact')[1], 'no personal data in a public artifact')
        parts = [(n, k, a.strip("'")) for n, k, a in re.findall(r"- \{ name: ([a-z-]+), kind: (\w+), arg: ('[^']*'|[^,]*), minutes: \d+ \}", c)]
        self.assertEqual(len(parts), 8)
        self.assertEqual({k for _, k, _ in parts}, {'jobsites', 'boards', 'more'})
        groups = [set(a.split(',')) for _, k, a in parts if k == 'more']
        self.assertEqual(sum(len(g) for g in groups), len(set().union(*groups)), 'each source in one group only')
        from engine import more_sources as ms
        self.assertEqual(set().union(*groups), set(ms.ORDER), 'every more_sources source is in a group')
        from engine import jobsite_discovery as jd
        self.assertEqual({a for _, k, a in parts if k == 'jobsites'} | {'clients'}, set(jd.SHARDS))

    def test_one_import_after_every_part(self):
        d = self.job('discover')
        self.assertIn('needs: [guard, collect]', d)
        self.assertIn("!cancelled()", d)
        at = lambda s: d.index(s)   # noqa: E731
        self.assertLess(at('dataset_discovery.py --out work --dataset'), at('merge_collect.py --out work --profiles work/profiles.json'))
        self.assertLess(at('merge_collect.py'), at('engine/prescreen.py'))
        self.assertLess(at('engine/prescreen.py'), at('--dedupe work/jobsite_raw.json'))
        self.assertEqual(d.count('--file=../work/apply.sql'), 1, 'one all-or-nothing import')
        self.assertNotIn('more_sources.py', d, 'the collectors moved to the parallel parts')
        self.assertIn('--shard clients', d)

    def test_guards_find_the_discover_job_among_all_the_jobs(self):
        for f in ('recent_run_guard.mjs', 'discovery_watchdog.mjs'):
            src = (ROOT / 'dashboard' / 'scripts' / f).read_text()
            self.assertIn('/jobs?per_page=50', src, f)
        self.assertLessEqual(self.WF.count('\n          - { name: ') + 6, 50)


if __name__ == '__main__':
    unittest.main()
