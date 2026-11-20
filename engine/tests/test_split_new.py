"""A new posting is dropped only as an exact duplicate of a stored job: same employer, same title AND same stated location.
The same role in another city is a different opening and must come through (owner rule of 2026-11-10)."""
import json
import unittest
from unittest import mock

from engine import dataset_discovery as dd


def fake_d1(stored):
    def d1(sql, local=None):
        if 'SELECT id, is_active' in sql or 'source_url u' in sql:
            return []
        if 'is_active = 1' in sql:
            return [{'c': c, 't': t, 'l': l} for c, t, l in stored]
        return []
    return d1


def job(i, company, title, location):
    return {'id': f'ds:x:{i}', 'url': f'https://jobs.example.com/{i}', 'company': company, 'title': title, 'location': location}


class SplitNew(unittest.TestCase):
    def test_same_role_in_another_city_is_new_but_an_exact_copy_is_not(self):
        stored = [('ACWA Power', 'Electrical Engineer', 'Riyadh, SA')]
        jobs = [job(1, 'ACWA Power', 'Electrical Engineer', 'Riyadh, SA'),      # exact copy of a stored job: dropped
                job(2, 'ACWA Power', 'Electrical Engineer', 'Tashkent, UZ'),    # another city: a different opening
                job(3, 'ACWA Power', 'Electrical  engineer', 'riyadh SA'),      # same after normalising: dropped
                job(4, 'ACWA Power', 'Maintenance Manager', 'Riyadh, SA')]
        with mock.patch.object(dd, 'd1', fake_d1(stored)):
            fresh, reopen, dropped_in_run = dd.split_new(jobs)
        self.assertEqual([j['id'] for j in fresh], ['ds:x:2', 'ds:x:4'])
        self.assertEqual(reopen, [])
        self.assertEqual(dropped_in_run, 1, 'job 3 is the same as job 1 once normalised: one copy dropped inside the run')


class TrackingParameters(unittest.TestCase):
    """Jobs QA 7: a job-site copy whose URL only adds tracking parameters is the stored posting, not a new job."""
    def test_url_variants_and_key(self):
        a = 'https://jobs.engie.com/job/Bap-Solar-Asset-Manager-State-Lead-342301/1376676255/'
        b = a + '?feedId=null&utm_source=J2WRSS&utm_medium=rss&utm_campaign=J2W_RSS'
        self.assertIn(a, dd.url_variants(b))
        self.assertEqual(dd.posting_url_key(a), dd.posting_url_key(b))
        self.assertEqual(dd.clean_posting_url('https://e.com/job-detail?gh_jid=6234311004&utm_source=x'), 'https://e.com/job-detail?gh_jid=6234311004')
        self.assertNotEqual(dd.posting_url_key('https://e.com/job?gh_jid=1'), dd.posting_url_key('https://e.com/job?gh_jid=2'))
        self.assertNotEqual(dd.posting_url_key('https://t.fa.em2.oraclecloud.com/?site_number=CX#1'), dd.posting_url_key('https://t.fa.em2.oraclecloud.com/?site_number=CX#2'))

    def test_a_stored_url_without_tracking_parameters_drops_the_copy(self):
        stored_url = 'https://jobs.engie.com/job/1376676255/'
        asked = []

        def d1(sql, local=None):
            if 'source_url u' in sql:
                asked.append(sql)
                return [{'u': stored_url}] if stored_url in sql else []
            return []
        jobs = [{'id': 'js:sf:1', 'url': stored_url + '?feedId=null&utm_source=J2WRSS', 'company': 'ENGIE', 'title': 'Solar Asset Manager', 'location': 'Bap, IN, 342301'},
                {'id': 'js:sf:2', 'url': 'https://jobs.engie.com/job/999/?utm_source=x', 'company': 'ENGIE', 'title': 'O&M Engineer', 'location': 'Bap, IN'},
                {'id': 'js:sf:3', 'url': 'https://jobs.engie.com/job/999/?utm_source=y', 'company': 'ENGIE SA', 'title': 'O&M Engineer', 'location': 'Bap, IN'}]
        with mock.patch.object(dd, 'd1', d1):
            fresh, reopen, dropped = dd.split_new(jobs)
        self.assertEqual([j['id'] for j in fresh], ['js:sf:2'], 'the stored posting and the second copy inside the run are dropped')
        self.assertEqual(dropped, 1)


TEXT = ('We are hiring a Maintenance Engineer for our {city} plant. You will lead preventive maintenance of rotating equipment, run root cause '
        'analysis on breakdowns, plan shutdowns and overhauls, and keep the utilities running. Five or more years in a process plant. ') * 2


def fake_d1_b3(stored):
    """stored: (id, company, title, location, workplace, description)"""
    def d1(sql, local=None):
        if 'SELECT id, is_active' in sql or 'source_url u' in sql:
            return []
        if 'substr(description' in sql:
            return [{'id': i, 'd': d} for i, c, t, l, w, d in stored if i in sql]
        if 'is_active = 1' in sql:
            return [{'id': i, 'c': c, 't': t, 'l': l, 'w': w} for i, c, t, l, w, d in stored]
        return []
    return d1


def jobd(i, company, title, location, description, remote=False):
    return {**job(i, company, title, location), 'description': description, 'is_remote': remote}


class ManyCities(unittest.TestCase):
    """Plan B3: the same job (same employer, title and text) in another city is stored once, with the city added to the location."""

    def run_split(self, stored, jobs):
        merges = {}
        with mock.patch.object(dd, 'd1', fake_d1_b3(stored)):
            fresh, _, _ = dd.split_new(jobs, None, merges)
        return [j['id'] for j in fresh], merges, {j['id']: j['location'] for j in fresh}

    def test_a_stored_job_gets_the_new_city(self):
        stored = [('s1', 'Acme Foods', 'Maintenance Engineer', 'Pune, Maharashtra, India', 'ONSITE', TEXT.format(city='Pune'))]
        ids, merges, _ = self.run_split(stored, [jobd(1, 'Acme Foods', 'Maintenance Engineer', 'Chennai, Tamil Nadu, India', TEXT.format(city='Chennai'))])
        self.assertEqual(ids, [])
        self.assertEqual(merges['stored'], [{'id': 's1', 'old': 'Pune, Maharashtra, India', 'new': 'Pune, Maharashtra, India; Chennai, Tamil Nadu, India'}])
        self.assertEqual(merges['merged'], 1)

    def test_different_text_country_or_mode_stays_a_separate_opening(self):
        stored = [('s1', 'Acme Foods', 'Maintenance Engineer', 'Pune, Maharashtra, India', 'ONSITE', TEXT.format(city='Pune'))]
        jobs = [jobd(1, 'Acme Foods', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai') + ' Night shifts.'),     # other text
                jobd(2, 'Acme Foods', 'Maintenance Engineer', 'Houston, Texas', TEXT.format(city='Houston')),                       # other country
                jobd(3, 'Acme Foods', 'Maintenance Engineer', 'Remote - India', TEXT.format(city='Remote'), remote=True),          # remote
                jobd(4, 'Acme Foods', 'Maintenance Engineer', 'Hosur, India', 'Short text.'),                                       # too short to tell
                jobd(5, 'Other Co', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai'))]                         # other employer
        ids, merges, _ = self.run_split(stored, jobs)
        self.assertEqual(ids, ['ds:x:1', 'ds:x:2', 'ds:x:3', 'ds:x:4', 'ds:x:5'])
        self.assertEqual(merges['stored'], [])

    def test_in_the_same_run_one_row_lists_the_cities_and_stops_at_three(self):
        jobs = [jobd(i, 'Acme Foods', 'Maintenance Engineer', f'{c}, India', TEXT.format(city=c)) for i, c in enumerate(['Pune', 'Chennai', 'Hosur', 'Nagpur'])]
        ids, merges, locs = self.run_split([], jobs)
        self.assertEqual(ids, ['ds:x:0', 'ds:x:3'], 'a fourth city cannot be added, so it is stored as its own row (tenth-man review)')
        self.assertEqual(locs['ds:x:0'], 'Pune, India; Chennai, India; Hosur, India')
        self.assertEqual(merges['merged'], 2)

    def test_idempotent_when_the_city_is_already_listed(self):
        stored = [('s1', 'Acme Foods', 'Maintenance Engineer', 'Pune, India; Chennai, India', 'ONSITE', TEXT.format(city='Pune'))]
        ids, merges, _ = self.run_split(stored, [jobd(1, 'Acme Foods', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai'))])
        self.assertEqual(ids, [])
        self.assertEqual(merges['stored'], [], 'nothing to write: the city is already there')
        self.assertEqual(merges['already_listed'], 1)

    def test_tenth_man_cases(self):
        # a bare city and a city with a country are not one job ('Berlin' and 'Austin, TX')
        self.assertFalse(dd.same_job_other_city('Berlin', TEXT.format(city='Berlin'), False, 'Austin, TX', TEXT.format(city='Austin'), False))
        # a stored row someone applied to (or decided on) is never joined: the posting is stored as its own row
        guarded = [('s1', 'Acme Foods', 'Maintenance Engineer', 'Pune, India', 'ONSITE', TEXT.format(city='Pune'))]
        base = fake_d1_b3(guarded)
        d1 = lambda sql, local=None: [{**r, 'g': 1} for r in base(sql)] if 'substr(description' in sql else base(sql)   # noqa: E731
        merges = {}
        with mock.patch.object(dd, 'd1', d1):
            fresh, _, _ = dd.split_new([jobd(1, 'Acme Foods', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai'))], None, merges)
        self.assertEqual([j['id'] for j in fresh], ['ds:x:1'])
        self.assertEqual(merges['stored'], [])
        # a stored row with three places already: the fourth city is stored as its own row
        full = [('s2', 'Acme Foods', 'Maintenance Engineer', 'Pune, India; Hosur, India; Nagpur, India', 'ONSITE', TEXT.format(city='Pune'))]
        ids, merges, _ = self.run_split(full, [jobd(2, 'Acme Foods', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai'))])
        self.assertEqual(ids, ['ds:x:2'])
        # a failure in the check never stops the run: every posting is inserted as before
        with mock.patch.object(dd, 'd1', fake_d1_b3(guarded)), mock.patch.object(dd, 'merge_cities', side_effect=RuntimeError('boom')):
            fresh, _, _ = dd.split_new([jobd(3, 'Acme Foods', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai'))], None, {})
        self.assertEqual([j['id'] for j in fresh], ['ds:x:3'])

    def test_stored_tenant_ids_key_as_the_employer(self):
        stored = [('s1', 'mdlz', 'Maintenance Engineer', 'Baddi, India', 'ONSITE', 'x')]
        ids, _, _ = self.run_split(stored, [jobd(1, 'Mondelez International', 'Maintenance Engineer', 'Baddi, India', 'y')])
        self.assertEqual(ids, [], 'the same job stored under the tenant id is a duplicate of the named one')
        with mock.patch.object(dd, 'd1', lambda sql, local=None: [{'id': 'farhan_shaikh', 'rejected_companies': '[{"company": "mdlz", "on": "2026-11-01"}]'}]):
            rows = dd.candidates_rows()
        self.assertEqual(json.loads(rows[0]['rejected_companies'])[0]['company'], 'Mondelez International')


if __name__ == '__main__':
    unittest.main()
