"""legacy_rows(): which undecided, never-scored rows the daily run hands to the screen. The query itself runs here, on a scratch SQLite
built from the dashboard migrations (d1() is replaced by a function that executes the same SQL locally)."""
import sqlite3
import unittest
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd

MIGRATIONS = sorted((Path(__file__).resolve().parent.parent.parent / 'dashboard' / 'migrations').glob('*.sql'))
C = 'farhan_shaikh'


class LegacyRows(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        for m in MIGRATIONS:
            self.db.executescript(m.read_text(encoding='utf-8'))
        self.db.execute("INSERT OR IGNORE INTO candidates(id, full_name) VALUES (?, 'T')", (C,))

    def add(self, jid, status='NEEDS_REVIEW', reason='Preserved verified Farhan status with strategy lane mapping', score=None, breakdown=None, override=None, app=False, active=1):
        self.db.execute("INSERT INTO jobs(id,title,company,source_adapter,source_url,is_active,description,workplace_type,provenance,discovered_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (jid, 'Role ' + jid, 'Acme', 'ashby', 'https://x.example/' + jid, active, 'text', 'REMOTE', 'LIVE_PUBLIC', '2026-10-26T00:00:00Z'))
        self.db.execute("INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?)", (C, jid, status, reason, override))
        if score is not None:
            self.db.execute("INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,score_breakdown) VALUES (?,?,?,?)", (C, jid, score, breakdown))
        if app:
            self.db.execute("INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'SAVED')", ('ap' + jid, C, jid))

    def test_only_undecided_never_scored_rows_are_exported(self):
        self.add('a_noscore')                                             # no score row at all: exported
        self.add('b_empty', score=0, breakdown='{}')                      # empty score row: exported
        self.add('c_screened', score=0, breakdown='{"preliminary":true}') # the current screen gave it 0: not legacy
        self.add('d_scored', score=61, breakdown='{"old":1}')             # an earlier engine's real score: left alone
        self.add('e_override', override='NEEDS_REVIEW')
        self.add('f_applied', app=True)
        self.add('g_ready', status='READY', score=61, breakdown='{"old":1}')   # first-import Ready, never re-checked: exported
        self.add('g2_auto', status='READY', score=70, breakdown='{"preliminary":true,"profile_v8":true}')   # shortlisted by the current screen: not legacy
        self.add('g3_decided', status='READY', score=61, breakdown='{"old":1}', override='READY')            # a person's Ready: never
        self.add('h_collector', reason='[GITHUB_COLLECTOR] Unassessed public ATS posting from acme; review pending.', score=0, breakdown='{"state":"UNASSESSED"}')
        self.add('i_closed', active=0)
        self.add('j_noreason', reason=None)                               # no stored reason: still a never-scored row, exported
        self.db.commit()

        def d1(sql, local=None):
            return [dict(r) for r in self.db.execute(sql).fetchall()]
        with mock.patch.object(dd, 'd1', d1):
            rows = dd.legacy_rows([C], page=1)        # page of 1: the paging by job id must still return every row once
        self.assertEqual([r['job_id'] for r in rows], ['a_noscore', 'b_empty', 'g_ready', 'j_noreason'])
        self.assertTrue(all(r['legacy'] == 1 and r['description'] == 'text' and r['provenance'] == 'LIVE_PUBLIC' for r in rows))
        with mock.patch.object(dd, 'd1', d1):
            self.assertEqual(len(dd.legacy_rows([C], per_candidate=1)), 1, 'bounded per person per run')


if __name__ == '__main__':
    unittest.main()
