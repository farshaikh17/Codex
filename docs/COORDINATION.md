# Claude coordination board

Single shared coordination record for Claude work on farshaikh17/Codex. Owned by the Claude Master chat; workers may only append to the handoff log (section 9) and update their own row in section 4; everything else is changed by the Master.

- **Requirements and priorities:** the GPT Master chat. Nothing here overrides it. Where this file needs a decision, it is listed in section 8 and waits.
- **Coordination is through the repository.** Chats cannot read each other. A handoff is a commit, a PR comment, or an edit to this file, quoted with its commit SHA.
- **Status labels** are the five defined in `docs/HANDOFF.md` (on `builderbranches`): *Implemented and tested offline*, *Live collection verified*, *Scheduled execution verified*, *Consumer access verified*, *End-to-end tracker ingestion verified*. Never substitute one for another.

Last verified by the Claude Master: 2026-10-26 ~14:40 UTC, against the remote branches, PRs and Actions runs listed below.

## 1. Goal

One job-research engine that does not cost anything:
1. **Collection.** Official public ATS feeds (stdlib collector) plus a bounded, manual Crawl4AI fallback for allowlisted career pages.
2. **Storage.** A shared SQLite posting store rebuilt from Git history, with evidence-based extraction records.
3. **Assessment and review** on top of the store: candidate isolation, evidence gates, review queue, consumer outputs and a Sheets adapter interface. Not started; requirements come from the GPT Master.

The collector never decides eligibility. Nothing in `public/` is READY evidence.

## 2. Hard constraints (all workers)

- $0. No paid APIs, proxies, LLM calls or hosting; no larger runners; no change to Actions spending limits.
- Do not merge PRs, add or change schedules, touch ChatGPT tasks or Google Sheets, or change candidate rules without an explicit owner instruction.
- No candidate information in Git. Synthetic fixtures only.
- Push only to your own branch. Never force-push someone else's branch.
- Before pushing, run the offline test guard from `docs/INTEGRATION.md` (sockets disabled) and say the result in the commit or PR.

## 3. Verified state (2026-10-26 ~14:40 UTC)

### main
- Head `456397a` (bot snapshot, 07:55 UTC). 10 feeds, 533 listings, status `ok`, 10/10 sources.
- Feed collector on `main`: *Live collection verified* (push runs) and *Scheduled execution verified once*: run [40288776346](https://github.com/farshaikh17/Codex/actions/runs/40288776346), event `schedule`, 07:55 UTC.
- **The hourly cron is effectively not firing.** `collect.yml` uses `23 * * * *` with the five-hour gate inside a step, so every tick that fires creates a run, even one that skips. Actions history holds exactly one `schedule` run since the repository was created (01:33 UTC). The 12:23, 13:23 and 14:23 ticks would each have collected. They created no run. At 14:40 the feed data is about 6¾ hours old. *No schedule change is proposed here*; see decision D2.

### Open PRs (none merged, none reviewed; no review comments on any PR)

| PR | Branch → base | Head | Draft | Author session | Scope |
|---|---|---|---|---|---|
| farshaikh17/Codex#1 | `build/crawl4ai` → `main` | `29d0290` | yes | Worker A | Crawl4AI page capture (manual only), Offline tests PR workflow, `collect.yml` push filter `branches: [main]` and `$GITHUB_REF_NAME` publish fix |
| farshaikh17/Codex#2 | `builder1` → `main` | `5d31675` | yes | Worker B | E1 posting store + E2 extraction records |
| farshaikh17/Codex#3 | `builderbranches` → `main` | `d11f691` | no | Worker C | P2 registry and validation, atomic and honest collection runs, `docs/` set including `BACKLOG.md` |
| farshaikh17/Codex#4 | `builderbranches-compensation` → `builderbranches` | `a43890a` | no | Worker C | E2a: request compensation on Greenhouse and Ashby feeds, `changed_fields`, `endpoint_changed` |
| farshaikh17/Codex#5 | `fix/publication-manifest` → `builderbranches` | `48ff370` | yes | Worker A, **in Worker C's area** | SHA-256 manifest, `collect.py --verify`, revert-on-mixed-generation in `collect.yml` |
| farshaikh17/Codex#6 | `fix/store-rebuild` → `builder1` | `1bca0d2` | yes | Worker A, **in Worker B's area** | Store rebuild from Git history, expiry journal |

Not a PR: `integration/pr1-2-3` (`70528f9`, Worker A), a throwaway merge of all six for compatibility testing, with `docs/INTEGRATION.md`. Do not merge it.

### Actions history (all 11 runs)

| Workflow | Runs | Notes |
|---|---|---|
| Collect public job feeds | 5 | 1 skipped (gate), 1 failure (05a82e3, before the gate fix), 2 push successes on main, 1 push success on `build/crawl4ai` (01:38, before #1 restricted push to main), 1 schedule success (07:55) |
| Capture allowlisted career pages | 3 | All push on `build/crawl4ai`. Latest [40339903525](https://github.com/farshaikh17/Codex/actions/runs/40339903525) (14:28, `ea1935f`): 6/6 usable, 12 operations of 25, schema `public-page-capture-index-2` committed as `29d0290` |
| Offline tests | 3 | Success on `585061c` and `ea1935f`. Run 40340180047 on the bot commit `29d0290` is `action_required`: GitHub holds bot-triggered `pull_request` runs for approval. Not a failure; code is identical to `ea1935f` |

### Combined tree
- Master check, 14:40: `integration/pr1-2-3` plus the current #1 head (`29d0290`, which integration does not include yet) merges with no conflicts. **97 tests, 0 failures, 0 errors** with outbound sockets disabled. `registry.py`: OK, 10 sources, 10 warnings that are all "no verified careers_url".
- All six PRs merge into `main` conflict-free in any order (Worker A's integration run at 12:05, re-confirmed above for #1's new head).

### Stale statements found (fix in the owner's next push, no separate PR)
- `docs/INTEGRATION.md`: says the committed page index is still schema 1, and that Canonical times out. Both are superseded by run 40339903525 (schema 2; Canonical usable). It also lists #1 at `585061c`. Owner: Worker A.
- `docs/BACKLOG.md` and `docs/HANDOFF.md` on `builderbranches`: E2 is "being built" (it is implemented in #2), #1 "5 usable, 1 failed" (now 6/6), and #5 and #6 are not listed. Owner: Worker C.
- `docs/ENGINE.md` §3 on `builder1`: the Crawl4AI interface names schema `public-page-capture-index-1`. Current is `-2`, which adds `review_hash`, `review_change`, `listing_quality`, `coverage` and `flags`. Owner: Worker B, after Worker A confirms the field list (task A1).

## 4. Workstreams

| ID | Workstream | Worker chat | Session | Branches / PRs | Owns (files) | Depends on |
|---|---|---|---|---|---|---|
| A | Crawl4AI page capture, PR CI, integration testing | Claude Worker A | `session_01WCd9wwgzPgNAHU6F2kv6QK` | `build/crawl4ai` (#1), `integration/pr1-2-3`; authored #5 and #6 (hand off, see below) | `crawl_pages.py`, `pages.json`, `test_crawl_pages.py`, `requirements-crawl.txt`, `.github/workflows/crawl-pages.yml`, `.github/workflows/tests.yml`, `public/pages/**`, root `OPERATIONS.md`/`README.md`/`MIGRATION.md`, `docs/INTEGRATION.md` | – |
| B | Shared posting store, extraction (engine E-steps) | Claude Worker B | `session_01FQorivZRVyv3ggSUDwDoq6` | `builder1` (#2); adopts `fix/store-rebuild` (#6) | `engine/**`, `docs/ENGINE.md`, `data/posting-events.jsonl` | #4 for pay inputs; A for the page-capture contract (E2b) |
| C | Source registry and collection reliability | Claude Worker C | `session_019pVgcPhTsH8cCJJZcQQ7Vd` | `builderbranches` (#3), `builderbranches-compensation` (#4); adopts `fix/publication-manifest` (#5) | `registry.py`, `test_registry.py`, `employers.json`, `sources.json`, `collect.py`, `adapters.py`, `test_collect.py`, `docs/` except `ENGINE.md`, `INTEGRATION.md` and this file | #1 lands first (shared `collect.yml` hunk) |
| M | Coordination | Claude Master | this chat | this file only | `docs/COORDINATION.md` | – |

Shared-file rules:
- `.github/workflows/collect.yml` is edited by #1 (push filter, publish target), #3 (copies #1's hunks verbatim, replaces the gate step) and #5 (manifest verify and revert). Only C edits it from now on. A doesn't touch it again unless #1 needs a rebase fix.
- `collect.read`/`collect.write` signatures stay stable. `crawl_pages.py` imports them.
- Cross-ownership correction: #5 (collector) and #6 (engine) were written by A in C's and B's areas. A stops pushing to them. C and B each review and adopt theirs: fold into their own branch or keep it stacked and say so. Neither is merged on its own.

## 5. Next bounded task per worker

Each task is one push or a small number of pushes to the worker's own branch. None overlaps another, and none needs a merge, a schedule change or a decision from section 8.

### A1: Make #1 review-ready and publish the page-capture contract (Worker A)
- In `OPERATIONS.md` on `build/crawl4ai`, add an exact consumer contract for `public-page-capture-index-2`: every field and its type, which fields are stable, and the rule that a schema change means a new schema string.
- Post one comment on farshaikh17/Codex#2 acknowledging the ENGINE.md §3 boundary, with the corrected field list for `-2` (the input B needs for E2b).
- Rebuild `integration/pr1-2-3` from the current heads of all six branches. Update `docs/INTEGRATION.md`: remove the stale schema-1 and Canonical statements, and record the new heads and test count.
- Post one comment each on #5 and #6, handing them to C and B ("owner: Worker C / Worker B; I will not push here again").
- Not in scope: new pages, schedules, stealth, or dependency changes. (A `pip-audit` of `requirements-crawl.txt` is backlog K, after merge.)
- **Acceptance:** OPERATIONS.md contract matches the committed `public/pages/index.json` field for field. Integration branch merges all six current heads cleanly. The offline suite passes there, with the count stated. Comments are posted on #2, #5 and #6. No workflow file changed.

### B1: Adopt #6 and parse structured Ashby pay in E2 (Worker B)
- Review `fix/store-rebuild` (#6). Either merge it into `builder1` or keep it stacked, and say which on #2. Don't create a second persistence module.
- In `engine/extract.py`, accept the Ashby `compensation_raw` JSON shape fixed in section 6, and keep accepting the old summary string:
  - one range per tier and component
  - currency from `currencyCode`, never from `$`
  - period from `interval` (`1 YEAR` → year; `NONE` or missing → `not_stated`)
  - basis from `compensationType` (Salary → base; Bonus and Commission → variable; Equity* → equity)
  - null min or max → `not_stated`
  - no conversion, no annualizing, no merging of tiers
- Bump `EXTRACTOR_VERSION`.
- Fixtures: build them from the shape in section 6 (Oyster USD+CAD, Zapier multi-component, a null currency, a Greenhouse range with no period). Don't wait for C's push.
- After A1's comment, update `docs/ENGINE.md` §3 to schema `-2`. Don't implement E2b ingestion yet.
- Not in scope: `adapters.py`, `collect.py`, E3 or later (candidate config and gates wait for D3).
- **Acceptance:** all engine tests pass offline. Existing string-format extraction is unchanged (state the before/after counts on the committed snapshot). New fixture tests cover the four cases. #6's status is stated on #2.

### C1: Adopt #5 and emit structured Ashby pay in the collector (Worker C)
- Review `fix/publication-manifest` (#5). Either merge it into `builderbranches` or keep it stacked, and say which on #3. #3 and #5 must reach `main` together.
- In `adapters.py` on `builderbranches-compensation` (#4): when Ashby `compensationTiers` is present, set `compensation_raw` to the exact JSON shape in section 6. Without tiers, keep today's summary string. Greenhouse and Lever stay unchanged.
- Tests: use saved real responses with the same four cases as B1. Add a live trial in the container with scratch output and nothing committed, and report the count of postings whose hash changes. That count must include Clipboard, which already had compensation on.
- Document the shape in `docs/OUTPUT_CONTRACT.md`.
- Refresh the stale `BACKLOG.md`/`HANDOFF.md` statements in section 3, and list #5 and #6 there.
- Not in scope: H benchmark fixtures and anything touching candidate rules (wait for D3), and cron changes (D2).
- **Acceptance:** offline suite passes. The live trial shows only `compensation_raw` changes (plus genuine new postings). `changed_fields` and `endpoint_changed` are correct for the new format. OUTPUT_CONTRACT.md matches section 6 byte for byte. #5's status is stated on #3.

## 6. Interface fixed by the Master: Ashby `compensation_raw` (for B1 and C1)

Taken from the proposal in `docs/INTEGRATION.md` (Worker A, verified against live feeds 11:57 UTC):
- When `compensationTiers` is present, the field is compact JSON (`separators=(',',':')`, keys in this order, values verbatim from the feed, nulls kept).
- When it is absent, the field is the plain `compensationTierSummary` string, as today.

```json
{"summary":"<compensationTierSummary or null>","tiers":[{"title":"<tier title>","summary":"<tier summary or null>","components":[{"compensationType":"Salary","currencyCode":"USD","interval":"1 YEAR","minValue":54600,"maxValue":61200,"summary":"<component summary or null>"}]}]}
```

- E2 detects the format by a leading `{`. Any change to this shape is decided here first, and B and C then update together.
- It changes `compensation_raw` for the same postings as #4, so C1 ships inside #4. That way they change hash once, with one compensation-only wave.

## 7. Integration order (recommendation; the owner merges)

1. **#1.** It brings the Offline tests CI, the `branches: [main]` push filter and the publish-target fix. Browser capture stays manual-only.
2. **#3 with #5 folded in.** Neither ships alone: without #5, #3's multi-file publish could commit a mixed generation.
3. **#4 with C1 included**, retargeted to `main`. The first collection after merge reports a one-time wave of `changed_fields: ["compensation_raw"]`.
4. **#2 with #6 folded in and B1 included.** Its pay evidence only matters after step 3.

Every order merges conflict-free. The order matters for behaviour (CI coverage, the atomic-publish safety, one hash wave), not for conflicts.

After each merge, the owner of the next PR merges `main` into their branch (no rebase or force-push), reruns the offline guard and pushes.

## 8. Blockers and decisions needed

| # | Decision or blocker | Who decides | Blocks |
|---|---|---|---|
| D1 | Approve the integration order in section 7, then merge (and mark #1, #2, #5, #6 ready for review). | Owner, via GPT Master | All merges |
| D2 | Scheduled collection is not firing: 1 schedule run in about 13 hourly ticks, and data is about 6¾ h old. Options to weigh: re-trigger with `workflow_dispatch` once to confirm, an off-peak cron such as `23 */5 * * *` (backlog P10), or accept best-effort. That cron also saves about 720 free minutes a month. **No change without instruction.** | Owner / GPT Master | Freshness; P10/E9 |
| D3 | Candidate requirements: H fixture labels, E3/E4 gate definitions, and where candidate outputs live (private path, artifact or Sheets only). | GPT Master | H, E3–E7 |
| D4 | Approve the held Offline tests run 40340180047 (the bot commit on #1), or ignore it. The code is identical to the passing `ea1935f`. | Owner (Actions UI) | Nothing; cosmetic |
| D5 | Replace the stand-in `pages.json` allowlist with the owner's real problem pages. | Owner / GPT Master | Usefulness of #1 |
| D6 | Where this file lives. It is committed on `build/crawl4ai` (the only branch the Master session may push to), so it rides along in #1. Alternative: a one-file PR to `main`. | Owner | Nothing |
| B-1 | The $0 Actions budget (MIGRATION.md) can't be re-checked from any Claude session. It needs one look at the billing UI before any schedule change. | Owner | D2 |
| B-2 | ChatGPT's authenticated read of this private repo is unproven (`docs/CONSUMER_TEST.md`). | GPT Master | Consumer access verified |

## 9. Handoff log

Append one line per handoff: date, worker, commit or comment link, what changed. Newest last.

- 2026-10-26 Master: created this file; assigned A1, B1, C1; fixed the Ashby `compensation_raw` shape (section 6).
