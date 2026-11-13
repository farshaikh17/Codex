"""A new posting is dropped only as an exact duplicate of a stored job: same employer, same title AND same stated location.
The same role in another city is a different opening and must come through (owner rule of 2026-11-10)."""
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
        self.assertEqual(ids, ['ds:x:0'])
        self.assertEqual(locs['ds:x:0'], 'Pune, India; Chennai, India; Hosur, India')
        self.assertEqual(merges['merged'], 3)

    def test_idempotent_when_the_city_is_already_listed(self):
        stored = [('s1', 'Acme Foods', 'Maintenance Engineer', 'Pune, India; Chennai, India', 'ONSITE', TEXT.format(city='Pune'))]
        ids, merges, _ = self.run_split(stored, [jobd(1, 'Acme Foods', 'Maintenance Engineer', 'Chennai, India', TEXT.format(city='Chennai'))])
        self.assertEqual(ids, [])
        self.assertEqual(merges['stored'], [], 'nothing to write: the city is already there')


if __name__ == '__main__':
    unittest.main()
