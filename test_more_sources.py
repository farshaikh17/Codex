"""engine/more_sources.py: response shapes are parsed, role rules filter, one failing source is skipped. Offline."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import more_sources as ms

FIX = Path(__file__).resolve().parent / 'tests' / 'fixtures' / 'sources'
SF_ROW = ('<tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone"><a href="/job/Riyadh-Reliability-Engineer/11/" class="jobTitle-link">'
          'Reliability Engineer</a></span></td><td class="colLocation"><span class="jobLocation"> Riyadh, SA </span></td>'
          '<td class="colDate"><span class="jobDate">Nov 6, 2026 </span></td></tr>')


def fake_http(url, data=None, headers=None, timeout=40):
    if 'workable' in url:
        return json.dumps({'jobs': [{'id': 'w1', 'title': 'RevOps Manager', 'url': 'https://jobs.workable.com/view/1', 'workplace': 'remote',
                                     'company': {'title': 'Acme'}, 'location': {'city': '', 'countryName': 'India'}, 'description': '<p>CRM</p>',
                                     'created': '2026-11-06T00:00:00Z'}], 'nextPageToken': None}).encode()
    if 'arbeitnow' in url:
        return json.dumps({'data': [{'title': 'Maintenance Engineer', 'company_name': 'Kraftwerk GmbH', 'url': 'https://www.arbeitnow.com/jobs/x',
                                     'location': 'Hamburg', 'remote': False, 'description': 'Turbines', 'created_at': 1794000000, 'visa_sponsorship': True}]}).encode()
    if 'services/rss' in url:
        raise AssertionError('the SuccessFactors RSS (/services/) is disallowed by robots.txt and must not be requested')
    if 'jobs.engie.com/search/?' in url and 'startrow=0' in url:
        return ('<table>' + SF_ROW + '</table>').encode()
    if '/search/?' in url:
        return b'<table></table>'
    if 'siemens-energy' in url:
        return (b'<rss><channel><item><title>Gas Turbine Field Service Technician</title><link>https://jobs.siemens-energy.com/jobs/FolderDetail/x/1</link>'
                b'<description>Canada</description><pubDate>Thu, 12 Sep 2024 00:00:00 +0000</pubDate></item></channel></rss>')
    if 'careers.fluor.com' in url:
        return json.dumps({'positions': [{'id': '1', 'name': 'Electrical Engineer IV', 'location': 'Houston, US-TX', 'work_location_option': 'onsite',
                                          'canonicalPositionUrl': 'https://careers.fluor.com/careers/job/1', 't_create': 1793970544, 'department': ['Engineering']}]}).encode()
    if 'careers.neom.com' in url or 'careers.taqa.com' in url:
        raise OSError('Name or service not known')
    if 'un.org' in url:
        return json.dumps({'data': {'list': [{'jobId': 5, 'postingTitle': 'Energy Efficiency Consultant', 'jobDescription': 'Home-based assignment',
                                              'startDate': '2026-11-05T00:00:00Z'}]}}).encode()
    raise TimeoutError('down')


class MoreSources(unittest.TestCase):
    def test_parse_and_filter(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'profiles.json').write_text(json.dumps({'farhan_shaikh': {'role': 'revops', 'exclude': ''},
                                                            'sana_ansari': {'role': 'maintenance engineer|reliability engineer|energy efficiency|turbine|electrical engineer', 'exclude': ''}}))
            with mock.patch.object(ms, 'http', fake_http), mock.patch('sys.argv', ['x', '--profiles', str(Path(d, 'profiles.json')), '--out', d, '--days', '30']):
                ms.main()
            jobs = {j['ats_type']: j for j in json.loads(Path(d, 'jobsite_raw.json').read_text())['jobs']}
            self.assertEqual(jobs['workable']['location'], 'Remote (India)'); self.assertEqual(jobs['workable']['candidates'], ['farhan_shaikh'])
            self.assertTrue(jobs['arbeitnow']['description'].startswith('Visa sponsorship available.'))
            self.assertEqual(jobs['successfactors']['title'], 'Reliability Engineer')
            self.assertEqual(jobs['successfactors']['company'], 'ENGIE'); self.assertEqual(jobs['successfactors']['location'], 'Riyadh, SA', 'ENGIE: no country mapping')
            self.assertEqual(jobs['successfactors']['url'], 'https://jobs.engie.com/job/Riyadh-Reliability-Engineer/11/')
            self.assertTrue(jobs['uncareers']['is_remote']); self.assertEqual(jobs['uncareers']['location'], 'Remote (home-based)')
            self.assertEqual(jobs['avature']['title'], 'Gas Turbine Field Service Technician', 'an old posting date on an employer site is not a cutoff')
            self.assertEqual(jobs['eightfold']['company'], 'Fluor', 'one Eightfold host failing keeps the others')
            report = json.loads(Path(d, 'more_sources_report.json').read_text())
            self.assertNotIn('getro', report, 'Getro is not read (robots.txt disallows its API)')
            self.assertIn('requests', report['workable'])
            self.assertEqual(report['eightfold']['kept'], 1)
            # employer career sites are the employer's own posting; aggregators stay job-board reports
            for name in ('successfactors', 'avature', 'eightfold'):
                self.assertIs(jobs[name]['board'], False, name)
            for name in ('workable', 'arbeitnow', 'uncareers'):
                self.assertIs(jobs[name]['board'], True, name)


    def test_workable_one_refused_term_keeps_the_others(self):
        calls = []
        def flaky(url, data=None, headers=None, timeout=40):
            calls.append(url)
            if 'query=bad' in url:
                raise OSError('HTTP Error 429')
            return fake_http(url)
        with mock.patch.object(ms, 'http', flaky), mock.patch.object(ms.time, 'sleep'):
            got = list(ms.workable([('bad', True), ('revops', True)]))
        self.assertEqual([j['title'] for j in got], ['RevOps Manager'], 'a refused term is skipped, the next term is still read')
        self.assertEqual(sum('query=bad' in u for u in calls), 2, 'the refused page is tried twice')
        with mock.patch.object(ms, 'http', flaky), mock.patch.object(ms.time, 'sleep'):
            with self.assertRaises(OSError):
                list(ms.workable([('bad', True)]))   # every term failed: the source reports an error, as before

    def test_doosan_group_search_skips_bobcat_postings(self):
        page = ('<table>'
                '<tr class="data-row"><td><a href="/bobcat/job/Statesville-Forklift/1/" class="jobTitle-link">Forklift Operator</a><span class="jobLocation">Statesville, NC, US</span></td></tr>'
                '<tr class="data-row"><td><a href="/job/Changwon-Turbine-Maintenance/2/" class="jobTitle-link">Turbine Maintenance Engineer</a><span class="jobLocation">Changwon, KR</span></td></tr>'
                '</table>').encode()
        def only_doosan(url, data=None, headers=None, timeout=40):
            if 'jobs.doosan.com/search/' in url:
                return page if 'startrow=0' in url else b'<table></table>'
            raise OSError('down')
        with mock.patch.object(ms, 'http', only_doosan):
            got = [j for j in ms.successfactors() if j['company'] == 'Doosan']
        self.assertEqual({j['title'] for j in got}, {'Turbine Maintenance Engineer'}, 'Bobcat postings are skipped; other employers down keep Doosan')
        names = [c[0] for c in ms.SUCCESSFACTORS]
        for n in ('Emirates Global Aluminium', 'Black & Veatch', 'ACWA Power', 'ReNew'):
            self.assertIn(n, names)

    def test_successfactors_reads_allowed_search_pages_not_the_rss(self):
        calls = []
        page = (FIX / 'sf_search_acwa.html').read_bytes()
        def fake(url, data=None, headers=None, timeout=40):
            calls.append(url)
            if 'careers.acwapower.com/search/' in url:
                return page if 'startrow=0' in url else b'<table></table>'
            raise OSError('down')
        with mock.patch.object(ms, 'http', fake):
            got = [j for j in ms.successfactors() if j['company'] == 'ACWA Power']
        self.assertFalse(any('/services/' in u for u in calls), 'robots.txt disallows /services/ on SuccessFactors sites')
        self.assertEqual([j['title'] for j in got], ['HSE Manager', 'Electro Mechanical Technician', 'Director BD'])
        self.assertEqual(got[2]['location'], 'Riyadh, Saudi Arabia', 'a two-letter Gulf country is named on non-US sites')
        self.assertEqual(got[1]['location'], 'United Arab Emirates')
        self.assertEqual(got[0]['url'], 'https://careers.acwapower.com/job/Shanghai-HSE-Manager/1368484223/')
        self.assertTrue(got[0]['posted_at'].startswith('2026-11-13'))
        self.assertIs(got[0]['board'], False)

    def test_successfactors_sitemap_reads_role_job_pages_only(self):
        sitemap = (FIX / 'sf_sitemap_renew.xml').read_bytes()
        job_page = (FIX / 'sf_job_renew.html').read_bytes()
        calls = []
        def fake(url, data=None, headers=None, timeout=40):
            calls.append(url)
            if url.startswith('https://careers.renew.com/search/'):
                return b'<html>another template, no data-row</html>'
            if url == 'https://careers.renew.com/sitemap.xml':
                return sitemap
            if url.startswith('https://careers.renew.com/job/'):
                return job_page
            raise OSError('down')
        with mock.patch.object(ms, 'http', fake), mock.patch.object(ms, 'SF_ROLE_FILTER', [(__import__('re').compile(r'o ?& ?m|wind'), None)]):
            got = [j for j in ms.successfactors() if j['company'] == 'ReNew']
        pages = [u for u in calls if '/job/' in u]
        self.assertTrue(pages and all('Wind' in u for u in pages), 'only job pages whose address names a role are read')
        self.assertLess(len(pages), 6, 'non-role addresses (legal, HR, civil design) are not read')
        self.assertEqual(got[0]['title'], 'Senior Manager - Wind Engineering')
        self.assertEqual(got[0]['location'], 'Kolind ka Bas, India')
        self.assertIn('ReNew', got[0]['description']); self.assertGreater(len(got[0]['description']), 500)
        self.assertTrue(got[0]['posted_at'].startswith('2026-11-02'))

    def test_successfactors_job_page_enriches_a_search_row(self):
        job_page = (FIX / 'sf_job_renew.html').read_bytes()
        row = {'url': 'https://careers.renew.com/job/x/61209744/', 'description': '', 'location': 'See posting', 'posted_at': ''}
        with mock.patch.object(ms, 'http', lambda url, **kw: job_page):
            self.assertTrue(ms.enrich_full_text(row, 'successfactors', {}, [0.0]))
        self.assertEqual(row['location'], 'Kolind ka Bas, India'); self.assertIn('renewable', row['description'].lower())

    def test_workday_reads_public_career_sites(self):
        calls = []
        def fake(url, data=None, headers=None, timeout=40):
            calls.append((url, data))
            if 'kbr.wd5' in url:
                return json.dumps({'jobPostings': [{'title': 'Maintenance Engineer', 'externalPath': '/job/Saudi-Arabia-Rabigh/Maintenance-Engineer_R1',
                                                    'locationsText': 'Saudi Arabia, Rabigh'},
                                                   {'title': 'Remote Planner', 'externalPath': '/job/Remote/Planner_R2', 'locationsText': 'Remote - UK'}]}).encode()
            raise OSError('down')
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.workday(pages=1))
        self.assertEqual([j['title'] for j in got], ['Maintenance Engineer', 'Remote Planner'], 'a repeated posting across search terms is read once; other tenants down keep KBR')
        self.assertEqual(got[0]['url'], 'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/Saudi-Arabia-Rabigh/Maintenance-Engineer_R1')
        self.assertEqual(got[0]['company'], 'KBR'); self.assertEqual(got[0]['location'], 'Saudi Arabia, Rabigh')
        self.assertFalse(got[0]['is_remote']); self.assertTrue(got[1]['is_remote'])
        self.assertEqual(calls[0][1]['searchText'], ms.SF_TERMS[0])
        self.assertEqual({c[0] for c in ms.WORKDAY}, {'KBR', 'GE Vernova', 'Hitachi', 'Johnson Controls', 'Baker Hughes', 'Shell', 'Unilever', 'Dow', '3M'})

    def test_smartrecruiters_reads_public_career_pages_not_the_api(self):
        first = (FIX / 'sr_careers_masdar.html').read_bytes()
        more = (FIX / 'sr_more_masdar.html').read_bytes()
        calls = []
        def fake(url, data=None, headers=None, timeout=40):
            calls.append(url)
            if 'api.smartrecruiters.com' in url:
                raise AssertionError('robots.txt disallows api.smartrecruiters.com')
            if url == 'https://careers.smartrecruiters.com/Masdar':
                return first
            if url.startswith('https://careers.smartrecruiters.com/Masdar/api/more') and 'page=1' in url:
                return more
            if url.startswith('https://careers.smartrecruiters.com/Masdar/'):
                return b''
            if url == 'https://careers.smartrecruiters.com/AFRY':
                return b'<html>forwarded to the employer site</html>'
            raise OSError('down')
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.smartrecruiters())
        titles = [j['title'] for j in got]
        self.assertIn('Manager, Technical – Civil & Structural', titles)
        self.assertIn('Manager, Technical – PV', titles, "a group's further postings come from its 'more' link")
        self.assertIn('Document Controller SPPC5', titles)
        g = next(j for j in got if j['title'] == 'Document Controller SPPC5')
        self.assertEqual(g['location'], 'As Sadawi, Saudi Arabia'); self.assertEqual(g['company'], 'Masdar')
        self.assertEqual(g['url'], 'https://jobs.smartrecruiters.com/Masdar/744000027104115-document-controller-sppc5')
        self.assertTrue(any('api/groups?page=1' in u for u in calls), 'the further group page is read')
        self.assertIn('Statkraft1', [c[1] for c in ms.SMARTRECRUITERS])
        self.assertNotIn('BoschGroup', [c[1] for c in ms.SMARTRECRUITERS])


    def test_oracle_hcm_reads_public_requisitions(self):
        calls = []
        def fake(url, data=None, headers=None, timeout=40):
            calls.append(url)
            return json.dumps({'items': [{'requisitionList': [
                {'Id': '30930', 'Title': 'Mechanical Technician', 'PostedDate': '2026-11-10', 'PrimaryLocation': 'Malabo, Equatorial Guinea', 'WorkplaceType': 'On-site'},
                {'Id': '555', 'Title': 'Planner', 'PostedDate': '2026-11-09', 'PrimaryLocation': 'London, United Kingdom', 'WorkplaceType': 'Remote'}]}]}).encode()
        with mock.patch.object(ms, 'http', fake):
            got = list(ms.oracle_hcm(pages=1))
        self.assertEqual([j['title'] for j in got], ['Mechanical Technician', 'Planner'], 'a requisition repeated across search terms is read once')
        self.assertEqual(got[0]['url'], 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/30930')
        self.assertEqual(got[0]['company'], 'Wood'); self.assertEqual(got[0]['location'], 'Malabo, Equatorial Guinea')
        self.assertFalse(got[0]['is_remote']); self.assertTrue(got[1]['is_remote']); self.assertTrue(got[1]['location'].startswith('Remote'))
        self.assertIn('keyword=maintenance', calls[0]); self.assertIn('siteNumber=CX_1', calls[0])


    def test_full_text_replaces_the_thin_description_within_caps(self):
        def fake(url, data=None, headers=None, timeout=40):
            if url == 'https://jobs.smartrecruiters.com/Masdar/7':
                return (b'<main><meta itemprop="datePosted" content="2026-11-10T09:34:47.764Z"><div itemprop="description"><p>Maintain gas turbines. '
                        b'Visa sponsorship is not available.</p><ul><li>5 years</li></ul></div></main>')
            if 'myworkdayjobs.com/wday/cxs/kbr/KBR_Careers/job/X/Y_R1' in url:
                return json.dumps({'jobPostingInfo': {'jobDescription': '<div>Plant reliability role, relocation assistance offered. ' + 'x' * 60 + '</div>', 'startDate': '2026-11-09'}}).encode()
            if 'recruitingCEJobRequisitionDetails' in url and 'Id="42"' in url:
                return json.dumps({'items': [{'ExternalDescriptionStr': '<p>Commissioning lead. ' + 'y' * 60 + '</p>', 'ExternalQualificationsStr': '<p>Degree</p>'}]}).encode()
            raise OSError('down')
        sr = {'url': 'https://jobs.smartrecruiters.com/Masdar/7', 'description': 'Engineering Renewables', 'location': 'Abu Dhabi', 'posted_at': ''}
        wd = {'url': 'https://kbr.wd5.myworkdayjobs.com/en-US/KBR_Careers/job/X/Y_R1', 'description': 'X', 'location': 'Rabigh', 'posted_at': ''}
        orc = {'url': 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/42', 'description': 'Z', 'location': 'Basra', 'posted_at': ''}
        bad = {'url': 'https://jobs.smartrecruiters.com/Masdar/999-x', 'description': 'keep me', 'location': 'Oslo', 'posted_at': ''}
        used, spent = {}, [0.0]
        with mock.patch.object(ms, 'http', fake):
            self.assertTrue(ms.enrich_full_text(sr, 'smartrecruiters', used, spent))
            self.assertTrue(ms.enrich_full_text(wd, 'workday', used, spent))
            self.assertTrue(ms.enrich_full_text(orc, 'oracle_hcm', used, spent))
            self.assertFalse(ms.enrich_full_text(bad, 'smartrecruiters', used, spent), 'a failing detail call keeps the posting as it was')
        self.assertIn('Visa sponsorship is not available', sr['description']); self.assertIn('5 years', sr['description']); self.assertNotIn('<p>', sr['description'])
        self.assertIn('relocation assistance', wd['description']); self.assertTrue(wd['posted_at'].startswith('2026-11-09'))
        self.assertIn('Commissioning lead', orc['description']); self.assertIn('Degree', orc['description'])
        self.assertEqual(bad['description'], 'keep me')
        # caps: per source count and total time
        with mock.patch.object(ms, 'ENRICH_CAP', 1), mock.patch.object(ms, 'http', fake):
            u = {}
            self.assertTrue(ms.enrich_full_text(dict(sr, description='a'), 'smartrecruiters', u, [0.0]))
            self.assertFalse(ms.enrich_full_text(dict(sr, description='a'), 'smartrecruiters', u, [0.0]), 'per-source cap')
        with mock.patch.object(ms, 'http', fake):
            self.assertFalse(ms.enrich_full_text(dict(sr, description='a'), 'smartrecruiters', {}, [ms.ENRICH_BUDGET_SECONDS + 1]), 'time budget spent')
            self.assertFalse(ms.enrich_full_text(dict(sr, description='a'), 'workable', {}, [0.0]), 'sources without a detail reader are untouched')


class EmployerSitesAreNotBoards(unittest.TestCase):
    def test_flags(self):
        self.assertEqual(set(ms.EMPLOYER_SITES), {'workday', 'oracle_hcm', 'successfactors', 'smartrecruiters', 'siemens_energy', 'eightfold'})
        self.assertIs(ms.job('workday', 'https://x', 'T', 'C', 'P', 'D', None, board=False)['board'], False)
        self.assertIs(ms.job('remoteok', 'https://x', 'T', 'C', 'P', 'D', None)['board'], True, 'a remote board stays a board by default')


if __name__ == '__main__':
    unittest.main()
