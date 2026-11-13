"""Plan A1: shortlist_pool() exports what the shortlist selector chooses from, and the still-open check verifies the pool first.
The pool query runs here on a scratch SQLite built from the dashboard migrations (d1() is replaced by a function that runs the same SQL locally)."""
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from engine import dataset_discovery as dd
from engine import liveness

MIGRATIONS = sorted((Path(__file__).resolve().parent.parent.parent / 'dashboard' / 'migrations').glob('*.sql'))
F, S = 'farhan_shaikh', 'sana_ansari'
MARK = 'Shortlisted automatically. Cloud discovery match.'
OLD = (datetime.now(timezone.utc) - timedelta(days=9)).strftime('%Y-%m-%dT%H:%M:%SZ')


class ShortlistPool(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        for m in MIGRATIONS:
            self.db.executescript(m.read_text(encoding='utf-8'))
        for c in (F, S):
            self.db.execute("INSERT OR IGNORE INTO candidates(id, full_name) VALUES (?, 'T')", (c,))
        self.db.execute("UPDATE candidates SET qualification_threshold = 60")

    def add(self, cid, jid, score, elig='ELIGIBLE', status='NEEDS_REVIEW', reason='Cloud discovery match.', skill=40, bd=None, override=None,
            app=False, active=1, title=None, company='Acme', url=None):
        bd = bd if bd is not None else json.dumps({'preliminary': True, dd.RULES_MARKER: True, 'target_exact': False}, separators=(',', ':'))
        self.db.execute("INSERT OR IGNORE INTO jobs(id,title,company,source_adapter,source_url,original_posting_url,is_active,description,location_restrictions,workplace_type,discovered_at,last_verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        (jid, title or 'Role ' + jid, company, 'greenhouse', url or 'https://jobs.example/' + jid, None, active, 'Text ' + jid, 'Remote', 'REMOTE', OLD, OLD))
        self.db.execute("INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,eligibility_status,qualification_reason,manual_override_status) VALUES (?,?,?,?,?,?)",
                        (cid, jid, status, elig, reason, override))
        self.db.execute("INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,score_breakdown) VALUES (?,?,?,?,?)", (cid, jid, score, skill, bd))
        if app:
            self.db.execute("INSERT INTO applications(id,candidate_id,job_id,status) VALUES (?,?,?,'SAVED')", ('ap' + cid + jid, cid, jid))

    def pool(self, **kw):
        def d1(sql, local=None):
            return [dict(r) for r in self.db.execute(sql).fetchall()]
        with mock.patch.object(dd, 'd1', d1):
            return dd.shortlist_pool(**kw)

    def test_pool_rows_auto_rows_and_held_rows(self):
        self.add(F, 'ready', 80)                                      # passes everything except (maybe) the 4-day check: in the pool
        self.add(F, 'stretch_unknown', 70, elig='UNKNOWN')            # Stretch rule: threshold with eligibility to confirm
        self.add(F, 'stretch_below', 52)                              # Stretch rule: ELIGIBLE, within 10 below
        self.add(F, 'low', 49)                                        # below both rules
        self.add(F, 'unknown_low', 55, elig='UNKNOWN')                # UNKNOWN below the threshold
        self.add(F, 'ineligible', 90, elig='INELIGIBLE')
        self.add(F, 'one_skill', 90, skill=20)                        # S4: one skill and not an exact target role
        self.add(F, 'one_skill_exact', 90, skill=20, bd=json.dumps({dd.RULES_MARKER: True, 'target_exact': True}, separators=(',', ':')))
        self.add(F, 'old_rules', 90, bd='{"preliminary":true}')        # not scored under the current rules
        self.add(F, 'closed', 90, active=0)
        self.add(F, 'hold', 90, status='HOLD')
        self.add(F, 'override', 90, override='NEEDS_REVIEW')
        self.add(F, 'applied', 90, app=True)
        self.add(F, 'auto_fell', 20, status='READY', reason=MARK)    # on the automatic shortlist, score fell: exported so it can be demoted
        self.add(F, 'auto_closed', 80, status='STRETCH_READY', reason=MARK, active=0)
        self.add(F, 'auto_decided', 80, status='READY', reason=MARK, override='READY')   # a person confirmed it: held, not ours
        self.add(F, 'person_ready', 80, status='READY', reason='Strongest Fit verified match (61%)')
        self.add(S, 'sana', 75)
        self.db.commit()
        rows = self.pool()
        by = {(r['candidate_id'], r['job_id']): r for r in rows}
        kinds = {k[1]: r['kind'] for k, r in by.items() if k[0] == F}
        self.assertEqual(kinds, {'ready': 'pool', 'stretch_unknown': 'pool', 'stretch_below': 'pool', 'one_skill_exact': 'pool',
                                 'auto_fell': 'auto', 'auto_closed': 'auto', 'auto_decided': 'held', 'person_ready': 'held'})
        self.assertEqual(by[(S, 'sana')]['kind'], 'pool')
        r = by[(F, 'ready')]
        for k in ('job_id', 'title', 'company', 'location', 'workplace', 'source', 'discovered_at', 'last_verified_at', 'score', 'skill_score',
                  'eligibility', 'status', 'reason', 'threshold', 'url', 'description', 'active', 'marked', 'target_exact'):
            self.assertIn(k, r, k)
        self.assertEqual((r['score'], r['skill_score'], r['eligibility'], r['threshold'], r['marked']), (80, 40, 'ELIGIBLE', 60, 1))
        self.assertEqual((by[(F, 'auto_closed')]['active'], by[(F, 'auto_fell')]['score']), (0, 20))
        self.assertEqual(by[(F, 'one_skill_exact')]['target_exact'], 1)

    def test_limit_keeps_the_best_and_every_auto_row(self):
        for i in range(12):
            self.add(F, f'p{i:02d}', 61 + i)
        for i in range(5):
            self.add(F, f'a{i}', 61, status='READY', reason=MARK)
        self.db.commit()
        rows = self.pool(per_candidate=4)
        self.assertEqual(sorted(r['job_id'] for r in rows if r['kind'] == 'pool'), ['p08', 'p09', 'p10', 'p11'])
        self.assertEqual(len([r for r in rows if r['kind'] == 'auto']), 5, 'every row on the automatic shortlist, whatever the limit')

    def test_still_open_targets_take_the_pool_first(self):
        for i in range(5):
            self.add(F, f'p{i}', 70 + i)
        self.add(F, 'auto', 61, status='READY', reason=MARK)
        self.add(F, 'auto_closed', 90, status='READY', reason=MARK, active=0)
        self.add(F, 'nolink', 99, url='http://insecure.example/x')
        self.add(S, 's1', 80)
        self.db.commit()
        pool = {'rows': self.pool()}
        t = liveness.pool_targets(pool, per_candidate=3)
        self.assertEqual([x['id'] for x in t], ['auto', 's1', 'p4', 'p3'], 'the shortlist first, then by score; closed rows and plain-http links skipped; capped per person')
        merged = liveness.merge_targets(t, [{'id': 'p4', 'url': 'https://jobs.example/p4'}, {'id': 'other', 'url': 'https://jobs.example/other'}])
        self.assertEqual([x['id'] for x in merged], ['auto', 's1', 'p4', 'p3', 'other'])

    def test_written_atomically(self):
        self.add(F, 'p', 70)
        self.db.commit()
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'pool.json'

            def d1(sql, local=None):
                return [dict(r) for r in self.db.execute(sql).fetchall()]
            with mock.patch.object(dd, 'd1', d1):
                counts = dd.write_pool(path)
            data = json.loads(path.read_text())
            self.assertEqual([r['job_id'] for r in data['rows']], ['p'])
            self.assertIn('generated_at', data)
            self.assertEqual(counts, {f'{F}:pool': 1})

            def broken(sql, local=None):
                raise dd.D1Error('no', False)
            path.unlink()
            with mock.patch.object(dd, 'd1', broken), self.assertRaises(dd.D1Error):
                dd.write_pool(path)
            self.assertFalse(path.exists(), 'a failed export leaves no pool file, so the selector does not run and the lists stay as they are')


if __name__ == '__main__':
    unittest.main()
