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


if __name__ == '__main__':
    unittest.main()
