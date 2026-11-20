"""Fault injection for the feed adapters: a feed that sends the wrong type for any field of a job must produce a record or a Skip,
never an unexpected exception (which would mark a whole employer board as failed, or abort a discovery pass)."""
import copy
import unittest

import adapters
from adapters import Skip

SAMPLES = {
    'greenhouse': {'id': 1, 'title': 'T', 'location': {'name': 'Remote; India'}, 'offices': [{'location': 'X', 'name': 'Y'}], 'content': '&lt;p&gt;Hello&lt;/p&gt;',
                   'absolute_url': 'https://x/1', 'first_published': '2026-11-01T00:00:00Z', 'updated_at': '2026-11-02T00:00:00Z', 'pay_input_ranges': [{'min_cents': 1}]},
    'lever': {'id': 'a', 'text': 'T', 'categories': {'location': 'Remote', 'allLocations': ['A', 'B']}, 'descriptionPlain': 'd', 'lists': [{'text': 'x', 'content': '<li>y</li>'}],
              'additionalPlain': 'z', 'workplaceType': 'remote', 'hostedUrl': 'https://x', 'applyUrl': 'https://x/a', 'createdAt': 1730000000000, 'salaryRange': {'min': 1}},
    'ashby': {'id': 'b', 'title': 'T', 'location': 'Remote', 'secondaryLocations': [{'location': 'Y'}], 'address': {'postalAddress': {'addressCountry': 'IN'}}, 'workplaceType': 'Remote',
              'isRemote': True, 'compensation': {'compensationTierSummary': '$1', 'summaryComponents': [{'compensationType': 'Salary', 'minValue': 1, 'maxValue': 2, 'currencyCode': 'USD', 'interval': '1 YEAR'}]},
              'descriptionPlain': 'd', 'jobUrl': 'https://x', 'applyUrl': 'https://x/a', 'publishedAt': '2026-11-01'},
}
WEIRD = [None, 0, -1, 1.5, float('nan'), True, False, [], {}, '', ' ', 'x' * 100000, '<script>alert(1)</script>', [None], [[]], {'a': {'b': None}}, 10 ** 30, '2026-13-45T99:99:99Z']


def paths(o, p=()):
    yield p
    if isinstance(o, dict):
        for k, v in o.items():
            yield from paths(v, p + (k,))
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from paths(v, p + (i,))


def setp(o, p, v):
    for k in p[:-1]:
        o = o[k]
    o[p[-1]] = v


class AdapterFaultInjection(unittest.TestCase):
    def test_requisition_keys_use_only_source_identifiers(self):
        for provider, base in SAMPLES.items():
            for invalid in (True, False, [], {}, 1.5):
                with self.subTest(provider=provider, invalid=invalid), self.assertRaises(Skip):
                    adapters.normalize(provider, 'board', dict(base, id=invalid))
            for value, expected in [(123, '123'), (' 00123 ', '00123')]:
                rec = adapters.normalize(provider, 'board', dict(base, id=value))
                self.assertEqual(rec['key'], f'{provider}:board:{expected}')

    def test_samples_are_valid(self):
        for prov, base in SAMPLES.items():
            rec = adapters.normalize(prov, 'b', copy.deepcopy(base))
            self.assertEqual(rec['title'], 'T')

    def test_any_field_with_the_wrong_type_gives_a_record_or_a_skip(self):
        bad = []
        for prov, base in SAMPLES.items():
            for p in [q for q in paths(base) if q]:
                for w in WEIRD:
                    j = copy.deepcopy(base)
                    setp(j, p, w)
                    try:
                        adapters.normalize(prov, 'b', j)
                    except Skip:
                        pass
                    except Exception as e:  # noqa: BLE001 - this is exactly what must not happen
                        bad.append((prov, '.'.join(map(str, p)), type(e).__name__, repr(w)[:20]))
        self.assertEqual(bad, [])

    def test_whole_job_and_whole_response_of_the_wrong_shape(self):
        for prov in SAMPLES:
            for w in WEIRD + ['a string', [1, 2]]:
                try:
                    adapters.normalize(prov, 'b', w)
                except Skip:
                    pass
                try:
                    adapters.extract_jobs(prov, w)
                except ValueError:
                    pass

    def test_list_fields_given_a_scalar_are_ignored_not_iterated(self):
        j = copy.deepcopy(SAMPLES['lever'])
        j['categories']['allLocations'] = 'Remote'          # a string would have been split into letters
        j['lists'] = 5
        rec = adapters.normalize('lever', 'b', j)
        self.assertEqual(rec['title'], 'T')


if __name__ == '__main__':
    unittest.main()
