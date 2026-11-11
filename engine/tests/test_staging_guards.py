"""The collector sync must not undo what the Worker or a person decided.

Runs the SQL that D1StagingBridge really generates against a scratch SQLite built from the dashboard migrations:
 * a row still "Unassessed" is imported and refreshed as before;
 * a row the Worker has since assessed keeps its status, lane, eligibility, reason AND score on the next sync;
 * a row with a manual override keeps its score (it used to be zeroed);
 * a row with an application keeps everything.
"""
import sqlite3
import unittest
from pathlib import Path

from engine.staging_bridge import D1StagingBridge

MIGRATIONS = sorted((Path(__file__).resolve().parent.parent.parent / 'dashboard' / 'migrations').glob('*.sql'))
CAND = 'farhan_shaikh'
UNASSESSED = '[GITHUB_COLLECTOR] Unassessed public ATS posting from acme; review pending.'


def item(key, score=0):
    job = {'key': key, 'title': 'Plant Engineer', 'company': 'Acme', 'url': f'https://boards.example.com/acme/{key}', 'description': 'Maintenance.', 'location': 'Pune, India'}
    qual = {'candidate_id': CAND, 'qualification_status': 'NEEDS_REVIEW', 'strategy_lane': 'UNASSIGNED', 'eligibility_status': 'UNKNOWN',
            'eligibility_reason': 'Unassessed', 'qualification_reason': UNASSESSED, 'qualified_at': '2026-11-02T00:00:00Z',
            'last_reverified_at': '2026-11-10T00:00:00Z', 'overall_score': score, 'score_breakdown': '{"state":"UNASSESSED"}'}
    return {'job': job, 'qualification': qual}


class StagingGuards(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        for m in MIGRATIONS:
            self.db.executescript(m.read_text(encoding='utf-8'))
        self.db.execute("INSERT OR IGNORE INTO candidates(id, full_name, current_location, qualification_threshold) VALUES (?,?,?,?)", (CAND, 'Test', 'India', 70))
        self.db.commit()

        def run(sql):
            self.db.executescript(sql)
            return [{'success': True}]
        self.bridge = D1StagingBridge(mode='remote', executor=run)

    def sync(self, *keys):
        self.bridge.import_batch(CAND, [item(k) for k in keys])

    def job_id(self, n):
        return self.db.execute("SELECT id FROM jobs ORDER BY rowid LIMIT 1 OFFSET ?", (n,)).fetchone()[0]

    def qual(self, jid):
        return self.db.execute("SELECT qualification_status, strategy_lane, eligibility_status, qualification_reason FROM candidate_qualifications WHERE job_id=?", (jid,)).fetchone()

    def score(self, jid):
        return self.db.execute("SELECT overall_score, strategy_lane FROM candidate_job_scores WHERE job_id=?", (jid,)).fetchone()

    def test_assessed_overridden_and_applied_rows_survive_the_next_sync(self):
        self.sync('a', 'b', 'c')
        a, b, c = self.job_id(0), self.job_id(1), self.job_id(2)
        self.assertEqual(self.qual(a)[3], UNASSESSED, 'an imported row starts unassessed')
        assessed = ('HOLD', 'UNASSIGNED', 'INELIGIBLE', 'Outside candidate target role family; retained for review.')
        # a: the Worker assessed it
        self.db.execute("UPDATE candidate_qualifications SET qualification_status=?, strategy_lane=?, eligibility_status=?, qualification_reason=? WHERE job_id=?", (*assessed, a))
        self.db.execute("UPDATE candidate_job_scores SET overall_score=55, strategy_lane='UNASSIGNED' WHERE job_id=?", (a,))
        # b: a person overrode it (the row still carries the collector's reason)
        self.db.execute("UPDATE candidate_qualifications SET manual_override_status='READY', manual_override_reason='mine' WHERE job_id=?", (b,))
        self.db.execute("UPDATE candidate_job_scores SET overall_score=88 WHERE job_id=?", (b,))
        # c: an application exists
        self.db.execute("INSERT INTO applications(id, candidate_id, job_id, status) VALUES ('app1',?,?,'APPLIED')", (CAND, c))
        self.db.execute("UPDATE candidate_job_scores SET overall_score=77 WHERE job_id=?", (c,))
        before_c = self.qual(c)
        self.db.commit()
        self.sync('a', 'b', 'c')   # the next collector run brings the same three, unassessed again
        self.assertEqual(self.qual(a), assessed, 'the Worker assessment must not be undone')
        self.assertEqual(self.score(a)[0], 55)
        self.assertEqual(self.score(b)[0], 88, 'a human-overridden row keeps its score')
        self.assertEqual(self.db.execute("SELECT manual_override_status FROM candidate_qualifications WHERE job_id=?", (b,)).fetchone()[0], 'READY')
        self.assertEqual(self.score(c)[0], 77, 'a row with an application keeps its score')
        self.assertEqual(self.qual(c), before_c, 'a row with an application keeps lane, eligibility and reason')

    def test_a_row_still_unassessed_is_refreshed(self):
        self.sync('a')
        a = self.job_id(0)
        self.bridge.import_batch(CAND, [{**item('a', score=12), 'qualification': {**item('a', score=12)['qualification'], 'qualification_reason': UNASSESSED + ' (refreshed)'}}])
        self.assertTrue(self.qual(a)[3].endswith('(refreshed)'))
        self.assertEqual(self.score(a)[0], 12)


if __name__ == '__main__':
    unittest.main()
