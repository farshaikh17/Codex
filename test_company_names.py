"""Offline checks of engine/company_names.py (plan B1): known ids get the employer's name, a tenant-looking name tries its career site's
title once, anything else stays as it is, and a site that does not answer never loses the job."""
import unittest

from engine.company_names import KNOWN, clean_site_name, display_company, name_from_html, name_jobs, site_page, tenant_like


class Known(unittest.TestCase):
    def test_table(self):
        for raw, name in [('mdlz', 'Mondelez International'), ('aecom2', 'AECOM'), ('generalmotors', 'General Motors'), ('thermofisher', 'Thermo Fisher Scientific'),
                          ('gohighlevel', 'GoHighLevel'), ('abb', 'ABB'), ('Hdga', 'Lucy Electric'), ('Egup', 'Vertiv'), ('Ekkh', 'Hormel Foods'),
                          ('Fa Espx Saasfaprod1', 'Cummins'), ('fa-emqh-saasfaprod1', 'Kent'), ('fa exty saasfaprod1', 'Howmet Aerospace')]:
            self.assertEqual(display_company(raw, 'workday', 'https://x.example/'), name, raw)

    def test_tenant_with_its_site(self):
        # the dataset stores some Oracle tenants with their site after the id; fa-elxu-saasfaprod1 is SVKM's (sites NMIMS, SVKM Central Office, SVKM)
        url = 'https://fa-elxu-saasfaprod1.fa.ocs.oraclecloud.com/?keyword=&mode=jobs&lang=en&site_number=CX_1001#1'
        self.assertEqual(display_company('Fa Elxu Saasfaprod1 (CX_1001)', 'oracle', url), 'NMIMS')
        self.assertEqual(display_company('Fa Elxu Saasfaprod1 (CX_1016)', 'oracle', url), 'SVKM')
        self.assertTrue(tenant_like('Fa Eqid Saasfaprod1 (CX_2)', 'oracle', 'https://fa-eqid-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_2#1'))
        self.assertEqual(display_company('Fa Eqid Saasfaprod1 (CX_2)', 'oracle', 'https://fa-eqid-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_2#1',
                                         lambda u: '<title>Acme Careers</title>'), 'Acme', 'an unknown tenant with its site is looked up')

    def test_known_needs_no_fetch(self):
        def boom(url):
            raise AssertionError('no fetch for a known id')
        self.assertEqual(display_company('mdlz', 'workday', 'https://mdlz.wd3.myworkdayjobs.com/external/job/x', boom), 'Mondelez International')

    def test_ordinary_names_unchanged(self):
        for raw in ['Siemens Energy', 'GE Vernova', 'Acme', 'Wood', 'Zapier', 'IBM']:
            self.assertEqual(display_company(raw, 'greenhouse', 'https://boards.greenhouse.io/x/jobs/1', lambda u: '<title>Wrong</title>'), raw)
        self.assertTrue(all(v.strip() == v and v for v in KNOWN.values()))


class TenantLike(unittest.TestCase):
    def test_reading(self):
        self.assertTrue(tenant_like('Fa Eqid Saasfaprod1', 'oracle', 'https://fa-eqid-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#1'))
        self.assertTrue(tenant_like('Eluq', 'oracle', 'https://eluq.fa.us2.oraclecloud.com/?site_number=CX#1'))
        self.assertTrue(tenant_like('bmc', 'workday', 'https://bmc.wd1.myworkdayjobs.com/BMC/job/x'))
        self.assertFalse(tenant_like('Wood', 'oracle_hcm', 'https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1'))   # a real name
        self.assertFalse(tenant_like('bmc', 'lever', 'https://jobs.lever.co/bmc/1'))   # only Workday and Oracle
        self.assertFalse(tenant_like('Vertiv Holdings', 'oracle', 'https://egup.fa.us2.oraclecloud.com/'))

    def test_site_page(self):
        self.assertEqual(site_page('https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/?keyword=&mode=jobs&lang=en&site_number=CX_1#2439911'),
                         'https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1')
        self.assertEqual(site_page('https://hdga.fa.em3.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Lucyelectric/job/26081'),
                         'https://hdga.fa.em3.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Lucyelectric')
        self.assertIsNone(site_page('https://bmc.wd1.myworkdayjobs.com/BMC/job/x'))   # Workday pages carry no employer name
        self.assertIsNone(site_page('https://evil.example/?site_number=CX_1'))


class Lookup(unittest.TestCase):
    def test_names_from_pages(self):
        self.assertEqual(name_from_html('<meta property="og:site_name" content="Cummins Talent Acquisition"/><title>x</title>'), 'Cummins')
        self.assertEqual(name_from_html('<title>Kent Careers</title>'), 'Kent')
        self.assertEqual(name_from_html('<title>Hormel Foods Family of Companies</title>'), 'Hormel Foods')
        self.assertEqual(name_from_html('<title>Careers at Warby Parker</title>'), 'Warby Parker')
        for bad in ['<title>MS</title>', '<title>Careers</title>', '<title></title>', '', '<title>Fa Eqid Saasfaprod1</title>']:
            self.assertIsNone(name_from_html(bad), bad)
        self.assertIsNone(clean_site_name('Oracle'))

    def test_once_per_site_and_failures_keep_the_raw_name(self):
        calls = []

        def fetch(url):
            calls.append(url)
            if 'eluq' in url:
                raise OSError('timed out')
            return '<meta property="og:site_name" content="Warby Parker"/>'
        jobs = [{'company': 'Fa Evdi Saasfaprod1', 'ats_type': 'oracle', 'url': f'https://fa-evdi-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=WarbyParkerCareers#{i}'}
                for i in range(3)]
        jobs.append({'company': 'Eluq', 'ats_type': 'oracle', 'url': 'https://eluq.fa.us2.oraclecloud.com/?site_number=CX#1'})
        jobs.append({'company': 'mdlz', 'ats_type': 'workday', 'url': 'https://mdlz.wd3.myworkdayjobs.com/x'})
        jobs.append({'company': 'Acme', 'ats_type': 'greenhouse', 'url': 'https://boards.greenhouse.io/acme/jobs/1'})
        report = name_jobs(jobs, fetch)
        self.assertEqual([j['company'] for j in jobs], ['Warby Parker'] * 3 + ['Eluq', 'Mondelez International', 'Acme'])
        self.assertEqual(sorted(calls), ['https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX',
                                         'https://fa-evdi-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/WarbyParkerCareers'])
        self.assertEqual(report, {'renamed': 4, 'looked_up': 2})

    def test_lookups_are_bounded_and_optional(self):
        calls = []
        jobs = [{'company': f'Fa E{c}xx Saasfaprod1', 'ats_type': 'oracle', 'url': f'https://fa-e{c}xx-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#1'}
                for c in 'abcdefgh']
        name_jobs(jobs, lambda u: calls.append(u) or '<title>Some Employer</title>', max_lookups=3)
        self.assertEqual(len(calls), 3)
        self.assertEqual(sum(j['company'] == 'Some Employer' for j in jobs), 3)
        untouched = [{'company': 'Fa Eqid Saasfaprod1', 'ats_type': 'oracle', 'url': 'https://fa-eqid-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#1'}]
        self.assertEqual(name_jobs(untouched, None), {'renamed': 0, 'looked_up': 0})


class Deadline(unittest.TestCase):
    def test_a_slow_site_never_holds_the_run(self):
        import time
        jobs = [{'company': 'Fa Eqid Saasfaprod1', 'ats_type': 'oracle', 'url': 'https://fa-eqid-saasfaprod1.fa.ocs.oraclecloud.com/?site_number=CX_1#1'}]
        t0 = time.monotonic()
        report = name_jobs(jobs, lambda u: time.sleep(2) or '<title>Late Employer</title>', deadline=0.3)
        self.assertLess(time.monotonic() - t0, 1.5)
        self.assertEqual(jobs[0]['company'], 'Fa Eqid Saasfaprod1')
        self.assertEqual(report['looked_up'], 0)

    def test_safe_names_falls_back_to_the_table(self):
        from unittest import mock
        from engine import dataset_discovery as dd
        jobs = [{'company': 'mdlz', 'ats_type': 'workday', 'url': 'https://mdlz.wd3.myworkdayjobs.com/x'}]
        with mock.patch.object(dd, 'name_jobs', side_effect=[RuntimeError('boom'), {'renamed': 1, 'looked_up': 0}]):
            self.assertEqual(dd.safe_names(jobs), {'renamed': 1, 'looked_up': 0, 'lookup_failed': True})


class Collector(unittest.TestCase):
    def test_collector_rows_use_the_display_name(self):
        from engine.staging_bridge import codex_to_d1_job
        self.assertEqual(codex_to_d1_job({'key': 'lever:gohighlevel:1', 'board': 'gohighlevel', 'url': 'https://jobs.lever.co/gohighlevel/1'})['company'], 'GoHighLevel')
        self.assertEqual(codex_to_d1_job({'key': 'k', 'company': 'Drivetrain', 'url': 'https://jobs.lever.co/d/1'})['company'], 'Drivetrain')


if __name__ == '__main__':
    unittest.main()
