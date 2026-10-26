# Integration check: open PRs against current main

Branch `integration/pr1-2-3` (not a PR; do not merge it). Rebuilt from scratch to prove the open work fits together. Maintained by Worker A (see `docs/COORDINATION.md`).

## Tested combination (2026-10-26 ~15:05 UTC)

| Order | Branch | Head | PR | Base |
|---|---|---|---|---|
| base | main | 456397a (scheduled snapshot 07:55) | – | – |
| 1 | build/crawl4ai | 1783532 | farshaikh17/Codex#1 | main |
| 2 | builder1 | 8794ca8 | farshaikh17/Codex#2 | main |
| 3 | fix/store-rebuild | 1bca0d2 | farshaikh17/Codex#6 | builder1 |
| 4 | fix/ashby-comp-extract | 3018541 | farshaikh17/Codex#9 | builder1 |
| 5 | builderbranches | d11f691 | farshaikh17/Codex#3 | main |
| 6 | fix/publication-manifest | 48ff370 | farshaikh17/Codex#5 | builderbranches |
| 7 | builderbranches-compensation | a43890a | farshaikh17/Codex#4 | builderbranches |
| 8 | fix/ashby-comp-tiers | 5932c0d | farshaikh17/Codex#8 | builderbranches-compensation |
| 9 | builderbranches-benchmark | 2088dce | farshaikh17/Codex#7 | builderbranches-compensation |

Merge result: all nine merge into main. There was one conflict, in documentation only: #6 and #9 each append a section at the end of `docs/ENGINE.md` §6. It was resolved by keeping both, with the extractor version 3 note first and then §7 Persistence. Whoever folds #6 and #9 into `builder1` will see the same textual conflict and should resolve it the same way. There are no code conflicts.

## Results (reproduce on this branch)

```
python - <<'PY'   # same guard as .github/workflows/tests.yml
import socket,sys,unittest
def offline(*a,**k): raise OSError('network disabled')
socket.socket.connect=socket.socket.connect_ex=offline; socket.create_connection=socket.getaddrinfo=offline
r=unittest.TextTestRunner().run(unittest.defaultTestLoader.discover('.',pattern='test*.py',top_level_dir='.'))
sys.exit(not r.wasSuccessful())
PY
python registry.py
python -m bench validate; python -m bench collection; python -m bench engine
```

- **Unit tests:** **132 run, 0 failures, 0 errors, 0 skipped**, with outbound sockets disabled. They cover:
  - the feed collector, registry and publication manifest
  - Ashby tiers
  - page capture, including the committed schema 2 index checked against the documented contract
  - the posting store, extraction v3, persistence, candidates and screening gates
  - the benchmark
- **`registry.py`:** OK, 10 employers, 10 sources enabled. The 10 warnings are all "no verified careers_url".
- **`bench validate`:** no fixture problems. **`bench collection`:** all 6 scenarios pass.
- **`bench engine`:** evidence states 93/93; compensation details 36/38. The two misses are the same as #7's own report (`ote-only.variable_mentioned`, `estimated-salary.estimated`). On the unconfirmed real cases, 5/8 agree. #7's `real-zapier-bonus-equity` fixture still holds Ashby's old summary text; with #8 that posting's pay arrives as separate Bonus and Equity components, so the fixture needs refreshing by #7's owner.
- **`python collect.py --verify` on main's `public/`:** "no manifest (written by an older collector)". This is expected until the first post-merge collection writes one. The publish step verifies only when `public/` changed.
- **Earlier offline end-to-end runs** (replaying real Greenhouse and Ashby responses saved 2026-10-26 ~11:57 UTC):
  - With #4 and #8, 161 postings change, only in `compensation_raw`: GitLab 106, Clipboard 36, Zapier 12, Oyster 7. Clipboard is attributed by `normalization_changed`, because its URL does not change.
  - All 171 Ashby pay components are kept.
  - The v3 extractor gives Oyster Salary ranges in 12 stated currencies, quotes 3 Clipboard `additional_information` notes verbatim, and produces 0 non-verbatim quotes.
- **Store rebuild from real Git history** (`python -m engine rebuild --ref origin/main`): 3 snapshot commits, 533 listed postings, integrity ok, deterministic.
- **Live page capture, schema 2:** Actions run 40339903525 (14:28 UTC), committed as 29d0290. It made 12 operations of 25. **6/6 pages usable**, including Canonical, which had timed out in the two earlier trials. The browser saw 321 requests and blocked 8; no page reached the 300-request cap. The committed `public/pages/index.json` is schema `public-page-capture-index-2`.
- **PR CI:** Offline tests passed on every code commit of #1 (latest run on 1783532). The bot data commit 29d0290 has one run held as `action_required`, which is GitHub's approval gate for bot-triggered runs, not a failure.

## Recommended merge order

1. **#1.** It brings Offline tests CI, the `branches: [main]` push filter and the `$GITHUB_REF_NAME` publish fix. Browser capture is manual only.
2. **#3 with #5 folded in.** Neither ships alone: #3's multi-file publish without #5 can commit a mixed generation.
3. **#4 with #8 folded in**, retargeted to main. One wave of `compensation_raw`-only changes. #7 (benchmark) goes with or after it.
4. **#2 with #6 and #9 folded in.** #9's tier parsing only matters once #8's format is in the snapshots.

Every order merges, with only the one documentation conflict above. The order matters for behaviour (CI coverage, atomic publish, one hash wave), not for conflicts.

## Consumer contracts (exact)

| Interface | Path | Schema | Read rule |
|---|---|---|---|
| Feed run summary | `public/status.json` | `public-job-index-1` plus `manifest` (after #5) | Read first. Compare `run_id`. Verify the SHA-256 of `index.json` and every board file you read against `manifest`; on a mismatch use the previous commit. No `manifest` means pre-#5 data that cannot be verified. |
| Feed index | `public/index.json` | `public-job-index-1` | One row per listing. `change`: new, changed, unchanged, unknown_after_failure, not_checked. `changed_fields` on changed rows (#4). Per source: `endpoint_changed` (#4) and `normalization_changed` (#8). When `changed_fields == ["compensation_raw"]` and either flag is true, the collector caused the change; it is not an employer edit. |
| Feed boards | `public/boards/<source>.json` | `public-job-board-1` (+ `normalization_version`, #8) | Full descriptions. For ok sources, `collected_at` equals the source's `checked_at`. Ashby `compensation_raw` with tiers is `{"source":"ashby.compensationTiers",...}` JSON, defined in `docs/OUTPUT_CONTRACT.md` (#8) and `docs/COORDINATION.md` §6. |
| Page captures | `public/pages/index.json` | `public-page-capture-index-2` (committed) | Every field, type and allowed value is in `OPERATIONS.md` "Consumer contract: public-page-capture-index-2", and a test enforces it against the committed file. Queue only `review_hash` changes, skip `boilerplate_only`, prefer `listings_found`. `partial` or `none_detected` coverage is never proof a role is absent. |
| Page capture text | `public/pages/captures/<id>.md` | header then text | Raw evidence, untrusted text, not a job. |
| Posting store | `state/engine.sqlite3` | store schema 2, extractor v3 | Not a consumer interface. A git-ignored cache rebuilt from Git plus `data/posting-events.jsonl` (#6). |

All of these are public posting data only. None says a job is suitable, eligible or READY.

## Remaining blockers

- **#1:**
  - The allowlist in `pages.json` is a stand-in for the owner's real problem pages (D5 in `docs/COORDINATION.md`).
  - Canonical's link count (333 links vs 313 claimed) suggests about 20 non-posting links match the job-path pattern.
  - `review_change` becomes meaningful from the second schema 2 run on.
- **#3/#5:**
  - Scheduled execution of the new collector code is not demonstrated; only the original code ran on schedule (run 40288776346).
  - The hourly cron is barely firing (D2).
  - The first post-merge run writes the first manifest.
- **#4/#8:** one-time wave of 161 compensation-only changes after merge. Not verified on Actions.
- **#2/#6/#9:**
  - Persistence works locally and on real history, but no workflow uses it.
  - Screening gates (`8794ca8`) are E3/E4 work that the board marks as waiting on D3 (candidate requirements).
- **All:**
  - The $0 Actions budget can't be re-checked from these sessions.
  - ChatGPT's authenticated read of this private repo is unproven.
