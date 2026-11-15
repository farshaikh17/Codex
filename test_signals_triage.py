"""engine/signals.py and engine/more_sources.py: UK register parsing, the taste model, EURES parsing. Offline."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from engine import signals, more_sources as ms


class Signals(unittest.TestCase):
    def test_uk_register(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, 'r.csv').write_text('﻿Organisation Name,Town/City,County,Type & Rating,Route\n Drax Group plc ,Selby,,Worker (A rating),Skilled Worker\n'
                                        'Fish Shop Ltd,Hull,,Temporary Worker (A rating),Seasonal Worker\nSSE PLC,Perth,,Worker (A rating),Global Business Mobility: Senior or Specialist Worker\n')
            keys = signals.uk_sponsors(Path(d, 'r.csv'))
            self.assertEqual(keys, {signals.company_key('Drax Group'), signals.company_key('SSE')})

    def test_taste_needs_enough_labels_and_learns(self):
        rows = [{'candidate_id': 'f', 'title': 'RevOps Manager', 'company': 'A', 'label': 'SAVED'}] * 7 + \
               [{'candidate_id': 'f', 'title': 'Zoho CRM Developer', 'company': 'B', 'label': 'INELIGIBLE'}] * 6 + \
               [{'candidate_id': 's', 'title': 'x', 'company': 'y', 'label': 'SAVED'}] * 3
        m = signals.train(rows)
        self.assertTrue(m['f']['active']); self.assertGreater(m['f']['weights']['revops'], 0); self.assertLess(m['f']['weights']['zoho'], 0)
        self.assertFalse(m['s']['active'], 'too few decisions')
        self.assertGreater(signals.taste_score(m['f'], 'RevOps Lead', 'Z'), 0); self.assertLess(signals.taste_score(m['f'], 'Zoho Developer', 'Z'), 0)
        self.assertEqual(signals.taste_score(m['s'], 'x', 'y'), 0.0)

    def test_good_match_and_not_for_me_are_labels(self):
        rows = [{'candidate_id': 'f', 'title': 'Implementation Manager', 'company': 'A', 'label': 'GOOD_MATCH'}] * 6 + \
               [{'candidate_id': 'f', 'title': 'Support Agent', 'company': 'B', 'label': 'NOT_FOR_ME'}] * 6
        m = signals.train(rows)
        self.assertTrue(m['f']['active'])
        self.assertGreater(signals.taste_score(m['f'], 'Implementation Lead', 'Z'), 0)
        self.assertLess(signals.taste_score(m['f'], 'Support Specialist', 'Z'), 0)


class Eures(unittest.TestCase):
    def test_parse(self):
        payload = {'jvs': [{'id': 'abc', 'title': 'Instandhaltungsingenieur', 'creationDate': '1793690760202', 'locationMap': {'DE': ['DE1']},
                            'employer': {'name': 'Kraftwerk GmbH'}, 'translations': {'en': {'title': 'Maintenance Engineer', 'description': 'Plant <b>work</b>'}}}]}
        with mock.patch.object(ms, 'http', lambda *a, **k: json.dumps(payload).encode()):
            rows = list(ms.eures({'sana_ansari': ['maintenance engineer']}))
        self.assertEqual(len(rows), 1); j = rows[0]
        self.assertEqual((j['title'], j['company'], j['location'], j['ats_type']), ('Maintenance Engineer', 'Kraftwerk GmbH', 'DE', 'eures'))
        self.assertTrue(j['url'].endswith('/jv-details/abc?lang=en')); self.assertEqual(j['description'], 'Plant work')

    def test_adzuna_off_without_keys(self):
        with mock.patch.dict('os.environ', {'ADZUNA_APP_ID': '', 'ADZUNA_APP_KEY': ''}):
            self.assertEqual(list(ms.adzuna({'sana_ansari': [('gb', 'x')]})), [])


if __name__ == '__main__':
    unittest.main()
