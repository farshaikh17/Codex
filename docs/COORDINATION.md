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

## 3. Verified state (2026-10-26 ~14:40 UTC; heads and combined tree refreshed 15:20; main and Actions refreshed 15:30)

**Independent confirmation, 15:20:** the GPT Master confirmed nine open PRs, `main` unchanged at `456397a`, and extractor v3 in #9.

**Update, 17:40 UTC (supersedes the 17:10 snapshot below where they differ):**
- **`main`** still `084bafb`. No `schedule` event on the new cron yet; the first slot after the change is 21:37 UTC.
- **#1 → `c93190e`:** bot capture commit (17:11). It came from capture run [40364258754](https://github.com/farshaikh17/Codex/actions/runs/40364258754), triggered by Worker A's 16:58 `1441d0f` workflow edit. **It took 13 minutes (16:58:41–17:11:18), against about 2.5 for every earlier capture run.** Cause not investigated. The run stays within its operation cap, and nothing suggests extra spend, since the budget is $0 with usage blocked.
- **#2 → `d3056d2`.** B1 still not started. Two more commits:
  - `897ddbe` (17:07): "Fail a base salary floor on explicit commission-only pay (**owner rule**)". It **takes `GATES_VERSION=4`.**
  - `d3056d2` (17:12): **E7 Google Sheets ledger adapter interface** (`engine/sheets.py`). Journaled, idempotent upserts by posting id, a per-candidate private target, and owned columns only.
    - **No live Google client.** Nothing imports a Google or HTTP library or opens a connection; tests use `FakeSheets`.
    - No Sheet was written. It is provisional (D3): where candidate outputs live, and the mapping to the canonical Sheets, are undecided.
- **Others** unchanged: #3 `d11f691`, #4 `a43890a`, #5 `48ff370`, #6 `1bca0d2`, #7 `ea69b67`, #8 `5932c0d`, #9 `3018541`.
- **Combined tree, Master check 17:40, all nine heads on `084bafb`:**
  - The same conflicts as 17:10: `docs/ENGINE.md` (doc-only, keep both) and `.github/workflows/collect.yml` (#3 vs `main`). For this check only, #3's side of `collect.yml` was taken, because workflow files aren't tested.
  - **170 offline tests pass**, 0 failures, 0 errors.
  - `EXTRACTOR_VERSION=3`, `GATES_VERSION=4`.
  - The one-sided pay-range collapse is still present.
- **Actions:** 34 runs. Capture runs: 6. Two more bot-commit Offline tests runs are held as `action_required` (726a27a, c93190e); like D4, they aren't failures.

**Snapshot, 17:10 UTC (supersedes the 16:20 heads and the main block below where they differ):**

*main:* **`084bafb`** (bot snapshot, 16:59). It was produced by push-verification run [40364324592](https://github.com/farshaikh17/Codex/actions/runs/40364324592) after the owner's **`562baaf`** (16:59 UTC, Farhan Shaikh): "Schedule five daily feed collections without the age-gate skip".
- **Cron:** now `37 1,6,11,16,21 * * *` UTC, with gaps of 5/5/5/5/4 h.
- **Age gate:** the five-hour step is removed. The workflow runs `python collect.py` directly.
- **Data:** `public/status.json` attempted 16:59, `ok`, 10/10 sources, 536 listings.
- **Authorization:** the change was authorized by the owner and the GPT Master, who re-verified the Actions budget at $0 paid with usage blocked. See *GPT Master production schedule update* at the end of this file.
- **Not yet verified:** scheduled execution on the new cron. No `schedule` event on `37 …` has arrived yet.

*Open PR heads, 17:10* (16:20 values in brackets where changed):
- #1 `d1c15a0` [`a4867d0`]. It now includes:
  - Worker A `eddcaad` (page-capture **schema 3**; `review_change` based on posting links; new `review_basis`, `listings_unchanged`)
  - capture `726a27a`
  - Worker A `1441d0f` (16:58, job-summary tweak in `crawl-pages.yml`)
  - the owner's `d1c15a0`
- #2 `5cc7334` [`5c87de2`]. It now includes:
  - `dbfdf1f` (16:25, **bare-`$` → USD on US-only postings, labelled "owner rule"**; amounts in millions or billions never compared; `GATES_VERSION=3`; third synthetic candidate)
  - `5cc7334` (17:02, **E6 consumer outputs**: posting records, cursor pages, review batches, decision feed)
  - **B1 not started.**
- #3 `d11f691`, #4 `a43890a`, #5 `48ff370`, #6 `1bca0d2`, #8 `5932c0d`, #9 `3018541` (all unchanged)
- #7 `ea69b67` [`e1438f2`]. It now includes:
  - `6e5ae79` (16:28, 2 new cases: `us-dollar-code-range`, `company-revenue-not-pay`)
  - `98773d9` (16:58, "Record **owner rule**: commission-only pay fails a base salary floor")
  - `ea69b67` (17:05, "Record **owner rule**: salary floors in several currencies, compared per currency")
  - `e1438f2` not yet reverted.

*Combined tree, Master check 17:10, all nine heads on `084bafb`:*
- **Conflicts:**
  - `docs/ENGINE.md` (#6 vs #9, doc-only, keep both).
  - **`.github/workflows/collect.yml` (#3 vs the owner's `562baaf`).** #3, #4 and #5 each conflict with `main` there on their own; #1 merges cleanly.
- **Tests:** taking #3's side of `collect.yml` only to get a code result (workflow YAML isn't tested), **159 offline tests pass**, 0 failures, 0 errors.
- **Versions:** `EXTRACTOR_VERSION=3`, `GATES_VERSION=3`.
- **One-sided pay-range collapse:** still present.

*Schedule integration hazard (verified 17:10):* #3's `due_sources()` collects a source on `schedule` only when its last attempt is at least `poll_interval_hours` (default 5) minus `DUE_SLACK` (15 min) old, that is 4 h 45 m.
- Under the owner's cron, **the 01:37 run follows a 4-hour gap and would skip every source**. Checked on the combined code: a 4 h gap gives no due source; a 5 h gap gives the source.
- Any delayed run would also make the next on-time run skip.
- Merged as is, #3 would **re-introduce the age gate** the owner removed. The fix belongs to C1 (see section 5).

**Current heads, 16:20** (15:20 values in brackets where changed):
- #1 `a4867d0` [`f27a04a`]: bot capture commit from run 40356103511 on top of Worker A's `f284658` (16:07, job-summary review-queue line in `crawl-pages.yml`)
- #2 `5c87de2` [`8794ca8`]: `8f026c4` (15:14, per-candidate review queue, E5) and `5c87de2` (16:08, salary gate never compares estimates, `GATES_VERSION=2`)
- #3 `d11f691`
- #4 `a43890a`
- #5 `48ff370`
- #6 `1bca0d2`
- #7 `e1438f2` [`c965b35`]: 16:08, "Apply owner rule: bare `$` is USD only on US-only postings"
- #8 `5932c0d`
- #9 `3018541`: merges `8794ca8`, not yet `8f026c4`/`5c87de2`; `EXTRACTOR_VERSION=3`
- `integration/pr1-2-3` `4331322` (15:11). It is now behind #1, #2, #7 and `main`.

**Re-sent instruction, 16:20:** the GPT Master's 15:20 message arrived a second time. Everything in it had already been applied at 15:20 (`70c5398`). Its "`main` unchanged" no longer holds (see *main* below).

The per-PR table below keeps the 14:40 heads for history.

### main (refreshed 15:30)
- **Head `4225d8e`** (bot snapshot, committed 15:18 UTC). It was written by scheduled run [40347918405](https://github.com/farshaikh17/Codex/actions/runs/40347918405): event `schedule`, created 15:17:48, success, on `456397a`, original (pre-P2) collector code.
  - `public/status.json`: `attempted_at` 15:17:54, status `ok`, 10/10 sources, **536 listings** (533 at 07:55).
  - The diff touches only `public/` (12 files). No code changed on `main`.
  - This happened after the GPT Master's 15:20 confirmation of "`main` unchanged at `456397a`" was relayed. That statement held for `456397a` and is now superseded.
- **Previous head:** `456397a` (07:55 UTC, 533 listings), from scheduled run [40288776346](https://github.com/farshaikh17/Codex/actions/runs/40288776346).
- **Feed collector on `main`:**
  - *Live collection verified* (push runs).
  - *Scheduled execution verified* on two runs, 07:55 and 15:17, both with the original collector code. No P2 code has run on a schedule.
- **The hourly cron is still unreliable.**
  - `collect.yml` uses `23 * * * *`, with the five-hour gate inside a step. Every tick that fires therefore creates a run, even one that skips.
  - Since the repository was created at 01:33 UTC, Actions holds **two** `schedule` runs in about 14 hourly ticks.
  - The 15:17 run did not start at minute 23. GitHub doesn't say which tick it served, most likely 14:23 about 55 minutes late.
  - The feed data was about 7 h 20 m old when it ran, and is fresh again from 15:17.
  - *No schedule change is proposed here*; see decision D2.
- **Combined tree, Master check 16:20, all nine heads listed above, on `4225d8e`:**
  - The same single doc-only `docs/ENGINE.md` conflict between #6 and #9 (keep both). No other conflicts.
  - **149 offline tests pass**, 0 failures, 0 errors, 0 skipped. That was 132 at 15:30 and 147 at 16:10; the growth is #2's review-queue and gate tests and #7's tests.
  - `registry.py` OK. `EXTRACTOR_VERSION=3`, `GATES_VERSION=2`.
  - The one-sided pay-range collapse **still reproduces**: min-only 90000 → 90000–90000, max-only 110000 → 110000–110000. B1 isn't done yet.

### Open PRs (none merged, none reviewed; no review comments on any PR)

| PR | Branch → base | Head | Draft | Author session | Scope |
|---|---|---|---|---|---|
| farshaikh17/Codex#1 | `build/crawl4ai` → `main` | `29d0290` | yes | Worker A | Crawl4AI page capture (manual only), Offline tests PR workflow, `collect.yml` push filter `branches: [main]` and `$GITHUB_REF_NAME` publish fix |
| farshaikh17/Codex#2 | `builder1` → `main` | `5d31675` | yes | Worker B | E1 posting store + E2 extraction records |
| farshaikh17/Codex#3 | `builderbranches` → `main` | `d11f691` | no | Worker C | P2 registry and validation, atomic and honest collection runs, `docs/` set including `BACKLOG.md` |
| farshaikh17/Codex#4 | `builderbranches-compensation` → `builderbranches` | `a43890a` | no | Worker C | E2a: request compensation on Greenhouse and Ashby feeds, `changed_fields`, `endpoint_changed` |
| farshaikh17/Codex#5 | `fix/publication-manifest` → `builderbranches` | `48ff370` | yes | Worker A, **in Worker C's area** | SHA-256 manifest, `collect.py --verify`, revert-on-mixed-generation in `collect.yml` |
| farshaikh17/Codex#6 | `fix/store-rebuild` → `builder1` | `1bca0d2` | yes | Worker A, **in Worker B's area** | Store rebuild from Git history, expiry journal |
| farshaikh17/Codex#7 | `builderbranches-benchmark` → `builderbranches-compensation` | `2088dce` | no | Worker C | Backlog H: labelled benchmark fixtures, collection scenarios and scorer (opened 14:36) |
| farshaikh17/Codex#8 | `fix/ashby-comp-tiers` → `builderbranches-compensation` | `5932c0d` | yes | Worker A, **in Worker C's area** | Ashby `compensationTiers` kept verbatim (section 6 shape), `normalization_version`/`normalization_changed` |
| farshaikh17/Codex#9 | `fix/ashby-comp-extract` → `builder1` | `1412f62` | yes | Worker A, **in Worker B's area** | E2 parses the section 6 tier JSON per component |

**Update 14:50:** `builder1` (#2) has moved to `8794ca8` (Worker B, 14:40, "Add candidate configuration and evidence-based screening gates"). That adds `engine/candidates.py`, `gates.py`, `screen.py`, `places.py`, `benchmark.py`, `docs/SCREENING.md` and synthetic candidate fixtures, which is E3/E4 work. Two consequences:
- It sets `EXTRACTOR_VERSION=2` for a wording change. #9 was based on `5d31675` and also set `EXTRACTOR_VERSION=2`, for the tier parser. **Resolved 14:49:** #9 merged `8794ca8` and took version 3 (`3018541`).
- E3/E4 sat behind decision D3. See D3 in section 8.

Not a PR: `integration/pr1-2-3` (`70528f9`, Worker A), a throwaway merge of all six for compatibility testing, with `docs/INTEGRATION.md`. Do not merge it.

### Actions history (21 runs at 16:20; was 11 at 14:40)

| Workflow | Runs | Notes |
|---|---|---|
| Collect public job feeds | 6 | 1 skipped (gate), 1 failure (05a82e3, before the gate fix), 2 push successes on main, 1 push success on `build/crawl4ai` (01:38, before #1 restricted push to main), **2 schedule successes** (07:55 run 40288776346; 15:17 run 40347918405 → `4225d8e`) |
| Capture allowlisted career pages | 4 | All push on `build/crawl4ai`. **Latest [40356103511](https://github.com/farshaikh17/Codex/actions/runs/40356103511)** (16:07–16:10, success). It was triggered by Worker A's `crawl-pages.yml` edit: 6/6 usable, 12 operations of 25, committed as `a4867d0`. It is the first run with a schema-2 baseline, so `review_change` means something:
  - `changed`: Automattic, Atlassian, Canonical, Salesforce Workday
  - `boilerplate_only`: Doist
  - `unchanged`: Toggl (still `no_listings_detected`)

  Previous run [40339903525](https://github.com/farshaikh17/Codex/actions/runs/40339903525) (14:28, `ea1935f`): 6/6 usable, 12 operations of 25, schema `public-page-capture-index-2` committed as `29d0290` |
| Offline tests | 11 | 10 successes (the 9 below plus `c0ba63f` and `fa1af1b`). Earlier: These are `585061c` and `ea1935f`, plus 6 pushes to #1 between 14:36 and 15:17: coordination commits `352357c`, `f957fc8`, `a731e04`, `f27a04a`, `70c5398` and A1's `1783532`. Run 40340180047 on the bot commit `29d0290` is `action_required`: GitHub holds bot-triggered `pull_request` runs for approval. Not a failure; code is identical to `ea1935f` |

### Combined tree
- **Master check, 15:20, all nine current heads** (listed above), merged sequentially onto `main` in the section 7 order:
  - One conflict: `docs/ENGINE.md` between #6 and #9. It is doc-only; both append after §6. Resolved by keeping both.
  - No other conflicts.
  - **132 tests, 0 failures, 0 errors, 0 skipped**, with outbound sockets disabled.
  - `registry.py` OK (10 sources).
  - `EXTRACTOR_VERSION=3`.
  - This matches Worker A's `4331322` (132 tests) and adds #7's later `c965b35`.
  - The same tree reproduced the one-sided pay-range collapse in B1.
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

**Update 17:10 (Master; the 16:30 decision below still binds, with these additions):**
- **Pushes after the decision:** all three workers pushed after the 16:30 decision was written. None shows the decision was received. Re-send the 16:30 messages, and the 17:10 additions below.
- **Owner instructions:** they are reaching workers directly ("owner rule", "owner request"). Until D9 is settled, a worker acting on an owner instruction that isn't in this file records it in section 9 **before** pushing, quoting the instruction.
- **Schema:** page capture is now **schema 3**. Every reference to `-2` in B1 means `-3`.
- **B2 version (revised 17:40):** B2 takes **the next unused `GATES_VERSION` at the moment it lands**, never a fixed number. `dbfdf1f` took 3 and `897ddbe` took 4, so it is 5 as of 17:40. Any worker bumping `GATES_VERSION` or `EXTRACTOR_VERSION` first checks the current value on `builder1`.
- **C1 has a new requirement:** see *C1 schedule integration* below.

**GPT Master decision, 16:30 (binding until changed):**
- **Worker A** stands by. No pushes unless assigned.
- **Worker B** finishes B1 before any further gate work, then does B2.
- **Worker C** continues C1 only, including the C1 correction below. No new benchmark labels.
- All candidate-specific work stays provisional.
- No merges, schedule changes, ChatGPT task changes or Sheet writes.

### A1: Make #1 review-ready and publish the page-capture contract (Worker A). **Done 15:11** (`1783532`, `f27a04a`; see section 9). **Status 16:30: stand by.** The unassigned `f284658` workflow edit (16:07) is accepted as is; no further workflow edits.
- In `OPERATIONS.md` on `build/crawl4ai`, add an exact consumer contract for `public-page-capture-index-2`: every field and its type, which fields are stable, and the rule that a schema change means a new schema string.
- Post one comment on farshaikh17/Codex#2 acknowledging the ENGINE.md §3 boundary, with the corrected field list for `-2` (the input B needs for E2b).
- Rebuild `integration/pr1-2-3` from the current heads of all six branches. Update `docs/INTEGRATION.md`: remove the stale schema-1 and Canonical statements, and record the new heads and test count.
- Post one comment each on #5 and #6, handing them to C and B ("owner: Worker C / Worker B; I will not push here again").
- Not in scope: new pages, schedules, stealth, or dependency changes. (A `pip-audit` of `requirements-crawl.txt` is backlog K, after merge.)
- **Acceptance:** OPERATIONS.md contract matches the committed `public/pages/index.json` field for field. Integration branch merges all six current heads cleanly. The offline suite passes there, with the count stated. Comments are posted on #2, #5 and #6. No workflow file changed.

### B1: Adopt #6 and #9 into `builder1` and fix one-sided pay ranges (Worker B) (revised 15:20; **priority confirmed by the GPT Master 16:30. Do this before any further gate work**)
- **Adopt #6** (`fix/store-rebuild`, `1bca0d2`). Either merge it into `builder1` or keep it stacked, and say which on #2. Don't create a second persistence module.
- **Fold #9** (`fix/ashby-comp-extract`, `3018541`) into `builder1` with a merge commit, no rebase.
  - #9 already contains `8794ca8` and sets `EXTRACTOR_VERSION=3`, so no version work is needed.
  - The one conflict, with #6, is in `docs/ENGINE.md`: both append after §6. Keep both sections, §7 persistence first.
  - Before merging, check:
    - Format detection is only by `data.get('source') == 'ashby.compensationTiers'`. Lever `salaryRange` JSON must still take the Lever path.
    - `additional_information` stays a verbatim quote and is never parsed into amounts.
    - #9's tests and `8794ca8`'s screening tests pass together.
- **Fix the missing-bound collapse (GPT Master review finding, reproduced by the Master at 15:20 on all nine heads).**
  - **Bug:** `_ashby_tiers` builds a range with `min()` and `max()` over the non-null amounts. A component that publishes only one bound becomes an exact salary. `minValue 90000, maxValue null` gives `{min: 90000, max: 90000}`, and `minValue null, maxValue 110000` gives `{min: 110000, max: 110000}`.
  - **Fix:**
    - Keep each bound independently. Take `min` from `minValue` and `max` from `maxValue`, and leave a missing bound `null`, never copied from the other.
    - A range with one known bound is open-ended ("at least" or "up to"). It is never an exact amount.
    - Both bounds null → no range, as today.
    - Never swap or reorder published values to make a range look valid.
  - **Regression tests:**
    - minimum only
    - maximum only
    - both null
    - both present, as a control
    - min equal to max as published (a genuine exact figure; must stay exact)
  - **Downstream check:** make sure every consumer of `ranges` in `8794ca8` (`gates.py`, `screen.py`, `benchmark.py`) treats a `null` bound as unknown. It must not read it as zero, as equal to the other bound, or as a pass or fail. A salary gate with one bound below the threshold and the other unknown stays `unknown` unless the known bound settles it.
  - **Other paths:** apply the same rule to any other structured path that can carry one bound (Lever `salaryRange`, Greenhouse `pay_input_ranges`) if it can collapse the same way. Say on #2 which paths you checked.
  - **Version:** keep `EXTRACTOR_VERSION=3`. Version 3 has not shipped to `main` or to any persisted store, so it needs no bump. Bump to 4 only if a v3 store exists anywhere you know of.
- **ENGINE.md §3:** update ENGINE.md §3 to **`public-page-capture-index-3`** (17:10: Worker A bumped the schema in `eddcaad` and posted a notice on #2; the earlier `-2` field list is in comment 6419553617). Don't implement E2b ingestion yet.
- **Leave the 16:25–17:02 work as is (17:10):** `dbfdf1f` (bare-`$` rule, company-figure exclusion) and `5cc7334` (E6 consumer outputs) are provisional. Don't extend them or remove them until D7 and D3 are answered. Note both on #2.
- **Extraction follow-ups (recorded, not assigned):** `dbfdf1f` found two real extractor defects, now numbered **B3**. Don't start them before B1 and B2 are reported.
  - "generates nearly $1B annually" is extracted as stated compensation of $1. The gate now excludes it, but the extractor still mislabels it.
  - "US$130,000 – US$150,000" isn't parsed as one range.
- **Not in scope:** `adapters.py`, `collect.py`, merging to `main`. The E3/E4 gates and candidate fixtures in `8794ca8` are **provisional** (D3). Don't extend them or change their rules. Changing them only to handle null bounds safely is in scope.
- **Close-out:** say on #9 that it is folded in, and leave #9 for the owner to close.
- **Report (required by the GPT Master):** post on #2, and append to section 9:
  - the resulting `builder1` commit SHA
  - the offline test count and result
  - the five regression cases by name
  - the before/after string-format extraction counts
- **Acceptance:**
  - All engine tests pass offline, with the count stated.
  - The five regression cases pass, and no evidence item shows an exact amount the feed did not publish.
  - String-format extraction counts on the committed snapshot are unchanged.
  - #6's and #9's status is stated on #2.
  - Append one line to section 9.

### B2: Keep employer-published "estimated" pay as evidence (Worker B; **only after B1 is reported**)
GPT Master decision, 16:30: `5c87de2`'s salary-gate rule (`NOT_EMPLOYER_PAY`, `GATES_VERSION=2`) is too broad. It discards employer-published wording such as Twilio "The estimated pay ranges for this role are…" and Clipboard "Estimated OTE".
- **Employer-published estimated ranges:** keep the evidence item, its verbatim quote and its wording, including `estimated`. Don't discard it automatically as a third-party estimate. Record in the gate result that the employer called it an estimate.
- **Third-party figures:** only quotes that say the pay is third-party, name a salary site (Glassdoor, Levels.fyi, PayScale, Salary.com, Indeed), or say it is not provided by the employer stay not compared. Keep the guard #7 identified: a third-party "$135,000" estimate must not become a salary pass.
- **Salary results stay provisional:** any salary result based on an estimated range is marked provisional. Final salary qualification awaits the GPT Master's canonical Sheets comparison (D3). Don't decide here whether an employer estimate can pass a floor; record it and leave the call open.
- **Versioning:** bump `GATES_VERSION` to **the next unused number when B2 lands** (5 as of 17:40; 3 and 4 were taken by `dbfdf1f` and `897ddbe`), with a comment naming the change.
- **Tests:**
  - an employer "estimated pay range" quote is kept as evidence and not discarded
  - a third-party/salary-site quote is not compared
  - the third-party "$135,000" case doesn't produce a false READY
- **Not in scope:** the bare-`$` question (see C1 correction and D3), extraction changes, new candidate rules.
- **Acceptance:**
  - offline tests pass
  - false READY 0 on #2's screening cases
  - the number of the 59 snapshot quotes that are now kept as employer evidence and the number still excluded as third-party, with examples of each
  - commit SHA and results posted on #2 and in section 9

### C1: Adopt #5 and #8 (Worker C) (revised 14:50; don't reimplement the adapter)
- Review `fix/publication-manifest` (#5). Either merge it into `builderbranches` or keep it stacked, and say which on #3. #3 and #5 must reach `main` together.
- Review `fix/ashby-comp-tiers` (#8) against section 6 and merge it into `builderbranches-compensation` (#4), as a merge commit. Then:
  - Check that `docs/OUTPUT_CONTRACT.md` states the section 6 shape exactly (it does on #8 at `5932c0d`; keep it in sync).
  - Check that `normalization_version` 2 and `normalization_changed` are documented, and that `changed_fields == ["compensation_raw"]` with `endpoint_changed` or `normalization_changed` counts as a collector-side change.
  - Confirm #7's benchmark still passes on top of #4 + #8.
  - Run a live trial in the container with scratch output and nothing committed. Report the postings whose hash changes. #8 reports 161 on replayed feeds, including Clipboard's 36, which only `normalization_changed` explains.
- Refresh the stale `BACKLOG.md`/`HANDOFF.md` statements in section 3, and list #5–#9 there.
- #7 (benchmark) is open. Don't extend its labels until D3 is answered; leave it as is for review.
- **C1 correction (GPT Master decision, 16:30): the bare-`$` rule in #7 is not a verified owner instruction.** Remove both its attribution and its enforcement:
  - Revert `e1438f2` on `builderbranches-benchmark` with `git revert` (a new commit, no history rewrite).
    - That removes the `bare_dollar`/`us_only` check from `bench/score.py`, its test in `test_bench.py`, and the "Owner rule (2026-10-26)" text in `docs/BENCHMARK.md`.
    - It also restores the 3 salary labels it changed (`remote-unspecified` ×2 and `contract-role`/cand-us, `unknown` → `pass`).
  - If the revert conflicts, remove those items by hand. Don't keep any of them as an approved rule. **17:10: it does conflict.** `git revert e1438f2` on the current branch conflicts in `docs/BENCHMARK.md`, because `6e5ae79` edited the same table. Resolve it by hand.
  - **17:10:** `98773d9` (commission-only fails a base floor) and `ea69b67` (multi-currency floors) also say "owner rule" and were pushed after the 16:30 "no new labels" decision. Leave them as they are, and don't revert or extend them. They are listed under D7/D8 for the GPT Master.
  - In the benchmark docs you may record the question as an open proposal for D3 ("bare `$` → USD when every location is in the US: unverified, not applied"). Don't use the word "owner".
  - This is a removal, not new labels, and it is the only label change allowed.
- **C1 schedule integration (owner and GPT Master requirement, 17:10; see the end of this file):**
  - Merge current `main` (`084bafb` or later) into `builderbranches`, `fix/publication-manifest` and `builderbranches-compensation` before touching `collect.yml`. Use merge commits, no rebase.
  - In the `collect.yml` conflict, **keep `main`'s cron `37 1,6,11,16,21 * * *` and keep the age-gate step removed**. Carry over only #3's and #5's own step changes (`--trigger`, verify and revert).
  - Make sure #3's per-source due logic can't act as an age gate. **Every slot of the new cron, including 01:37 after the 4-hour gap and a run that follows a delayed one, must collect every enabled source.** Pick a mechanism (for example, scheduled runs collect all enabled sources, or the default interval is well under 4 h), explain it on #3, and add a test that replays the five cron slots, including the 4-hour gap and a 40-minute-late run.
  - Don't restore the hourly cron or the five-hour gate, and don't change the cron itself.
- **C1 report:** post on #3/#4/#7, and append to section 9:
  - the commit SHAs
  - the offline test count
  - the live-trial hash-change count
  - #7's benchmark scores after the revert
- Not in scope: cron changes (D2). Say on #8 that it is folded in, then leave #8 for the owner to close.
- **Acceptance:** offline suite passes, with the count stated. The live trial shows only `compensation_raw` changes, plus genuine new postings. OUTPUT_CONTRACT.md matches section 6. #5's and #8's status is stated on #3/#4.

## 6. Interface fixed by the Master: Ashby `compensation_raw` (for B1 and C1)

**Adopted 2026-10-26 14:50: the shape implemented in #8 (`adapters.ashby_compensation`, `5932c0d`) and parsed by #9 (`1412f62`).** It replaces the first version of this section, which had no `source` key, no `additional_information`, and detection by a leading `{`.

When Ashby `compensationTiers` holds at least one object, `compensation_raw` is compact JSON:
- `json.dumps(..., ensure_ascii=False, separators=(',',':'))`, with keys in exactly this order.
- Values verbatim from the feed. Nulls are kept. Nothing is converted or inferred.
- Feed keys map as: `summary` ← `compensationTierSummary` (null if empty); tier `summary` ← `tierSummary`; tier `additional_information` ← `additionalInformation`; component keys ← the same names.

```json
{"source":"ashby.compensationTiers","summary":"<compensationTierSummary or null>","tiers":[{"title":"<tier title>","summary":"<tierSummary or null>","additional_information":"<additionalInformation or null>","components":[{"compensationType":"Salary","currencyCode":"USD","interval":"1 YEAR","minValue":54600,"maxValue":61200,"summary":"<component summary or null>"}]}]}
```

- **Without tiers:** the plain `compensationTierSummary` string, else `scrapeableCompensationSalarySummary`, else null, as before. Greenhouse and Lever are unchanged.
- **Missing bounds (E2 rule, added 15:20):** `minValue` and `maxValue` are interpreted independently. A missing bound stays `null` in the extracted range and is never filled from the other, so a one-sided figure is "at least" or "up to", never an exact salary. Both null → no range. (#9 at `3018541` violates this; the fix is in B1.)
- **Detection (E2):** only by `"source":"ashby.compensationTiers"`. A leading `{` is not enough, because Lever `salaryRange` JSON also starts with `{`.
- **Why `additional_information`:** on the 2026-10-26 feeds, 3 of 98 Ashby tiers carry pay facts only there (for example Clipboard "Estimated OTE: 65K-80K USD"). E2 keeps it as a verbatim quote and doesn't parse amounts out of it.
- **Versioning:** board files carry `normalization_version` 2. The first v2 run reports `normalization_changed: true` per source, so rewrites where the URL is unchanged (Clipboard's 36) aren't read as employer edits. On the extraction side, this parser is `EXTRACTOR_VERSION` 3 once merged onto `builder1` (see section 3).
- **Shipping:** #8 ships inside #4 so postings change hash once, in one compensation-only wave (161 on replayed feeds per #8). #9 ships inside #2.
- Any further change to this shape is decided here first. B and C then update together.

## 7. Integration order (recommendation; the owner merges)

0. **17:10:** `main` now has the owner's schedule change (`562baaf`). #3, #4 and #5 conflict with it in `collect.yml` until Worker C merges `main` in under C1. #1 still merges cleanly.
1. **#1.** It brings the Offline tests CI, the `branches: [main]` push filter and the publish-target fix. Browser capture stays manual-only.
2. **#3 with #5 folded in.** Neither ships alone: without #5, #3's multi-file publish could commit a mixed generation.
3. **#4 with #8 folded in**, retargeted to `main`. The first collection after merge reports a one-time wave of `changed_fields: ["compensation_raw"]`, with `endpoint_changed` or `normalization_changed` set.
4. **#2 with #6 and #9 folded in.** Its pay evidence only matters after step 3. Its E3/E4 content (`8794ca8`) waits on D3.
5. **#7** (benchmark), after D3 confirms its labels.

Every order merges conflict-free. The order matters for behaviour (CI coverage, the atomic-publish safety, one hash wave), not for conflicts.

After each merge, the owner of the next PR merges `main` into their branch (no rebase or force-push), reruns the offline guard and pushes.

## 8. Blockers and decisions needed

| # | Decision or blocker | Who decides | Blocks |
|---|---|---|---|
| D1 | Approve the integration order in section 7, then merge (and mark #1, #2, #5, #6 ready for review). | Owner, via GPT Master | All merges |
| D2 | **Superseded 17:10 by the owner's `562baaf`** (five daily runs, age gate removed, authorized with a re-verified $0 budget). What remains is to verify that `schedule` events actually arrive on the new cron. Historical note: scheduled collection was unreliable: 2 schedule runs (07:55, 15:17) in about 14 hourly ticks, the second about 55 minutes late, and data reached about 7 h 20 m old before it. Options to weigh: re-trigger with `workflow_dispatch` once to confirm, an off-peak cron such as `23 */5 * * *` (backlog P10), or accept best-effort. That cron also saves about 720 free minutes a month. **No change without instruction.** | Owner / GPT Master | Freshness; P10/E9 |
| D3 | Candidate requirements: H fixture labels, E3/E4 gate definitions, and where candidate outputs live (private path, artifact or Sheets only). **Now urgent:** work was built ahead of this decision. #7 (H labels, Worker C) and `8794ca8` on #2 (candidate config and screening gates, Worker B) both exist. The GPT Master should confirm or correct their rules before more is built on them. Neither worker extends them until then. **GPT Master direction, 15:20:**
- All candidate-specific gates and labels (`8794ca8` on #2 and the whole of #7) are **provisional** until compared with the canonical Google Sheets.
- No Claude session reads or edits the Sheets. The comparison is the GPT Master's.

Note: #7's `c965b35` (15:13) changed a label and aligned #7 with `8794ca8`'s gate vocabulary. It is recorded as provisional too.

**Added 16:20, more provisional candidate work, for the Sheets comparison:**
- **#2 `8f026c4`:** a per-candidate review queue (E5, `engine/review.py`).
- **#2 `5c87de2`** (**GPT Master decision, 16:30: too broad; employer-published estimated ranges must keep their evidence and wording. Fixed under B2, after B1**): the salary gate never compares pay quoted as an estimate, third-party or not employer-provided (`GATES_VERSION=2`). It is broader than intended: 59 quotes on the snapshot match, mostly *employer-published* wording such as Twilio "The estimated pay ranges…" and Clipboard "Estimated OTE". Worker B flags narrowing it as a D3 question.
- **#7 `e1438f2`:** a bare-`$` rule, labelled in the code as an "owner rule (2026-10-26)": a bare `$` means USD only when every listed location is in the US. **GPT Master decision, 16:30: not verified as an owner instruction. Remove the attribution; don't implement it as an approved rule. Worker C reverts it under C1.** It stays an open D3 proposal only. Otherwise currency is unestablished and salary is `unknown`.
  - The Master has no record of this rule from the owner or the GPT Master; please confirm it.
  - It is consistent with section 6 only if it lives in the gates. The extractor still never reads `$` as USD.
  - Today only #7's label checker enforces it; #2's gates don't. #7 measures salary agreement 22/30, with 5 mismatches on exactly this rule.
  - #7 notes that once the rule is in the gates, `5c87de2`'s estimate guard is what prevents a false READY on a third-party "$135,000" estimate.
  - If the rule is confirmed, it belongs in #2's salary gate (Worker B), with #7's labels unchanged.

Neither worker extends these further.

**Added 17:40:** #2 `d3056d2` (17:12) adds an **E7 Google Sheets adapter interface**: fake only, no live client, no network, nothing written. It is provisional until the canonical Sheets comparison and the output-location decision. Commit `897ddbe` (commission-only rule) is listed under D7.

**Added 17:10:** #2 `5cc7334` (17:02) adds **E6 consumer outputs** (`engine/outputs.py`, `docs/OUTPUTS.md`: posting records, cursor pages, review batches, decision feed). It is provisional; where candidate outputs live is still open here. #2 `dbfdf1f` and #7 `98773d9`/`ea69b67` are listed under D7. | GPT Master | H, E3–E7; merge of #7 and of #2's E3/E4 part |
| D4 | Approve the held Offline tests run 40340180047 (the bot commit on #1), or ignore it. The code is identical to the passing `ea1935f`. | Owner (Actions UI) | Nothing; cosmetic |
| D5 | Replace the stand-in `pages.json` allowlist with the owner's real problem pages. | Owner / GPT Master | Usefulness of #1 |
| D6 | Where this file lives. It is committed on `build/crawl4ai` (the only branch the Master session may push to), so it rides along in #1. Alternative: a one-file PR to `main`. | Owner | Nothing |
| B-1 | **Resolved 17:10:** the GPT Master re-verified the Actions budget at $0 paid usage, with usage blocked, before `562baaf`. Claude sessions still can't check it. | Owner | – |
| D7 | **Origin of the "owner rules".** Workers B and C cite owner instructions that the GPT Master hasn't verified. The bare-`$` → USD on US-only postings rule is in #7 `e1438f2` and, since 16:25, in #2's live gates (`dbfdf1f`). Also: commission-only fails a base floor (#7 `98773d9`, and since 17:07 in #2's live gates as `897ddbe`, `GATES_VERSION=4`), multi-currency floors compared per currency (#7 `ea69b67`), and amounts in millions or billions are never pay (#2 `dbfdf1f`). The GPT Master's 16:30 decision rejected only the bare-`$` rule, and only in #7. Needed: confirmation from the owner, per rule, and for each rejected rule whether its #2 commit (`dbfdf1f`, `897ddbe`) is removed too. | Owner, via GPT Master | B2; merge of #2's gates and #7 |
| D8 | Keep or drop #7's provisional cases added after the decision window: `6e5ae79` (2 cases for the `US$` range and company-revenue hazards; neither needs the bare-`$` rule). | GPT Master | #7 |
| D9 | **Instruction channel.** The owner is instructing workers directly. That has given us the bare-`$` rule, the schema-3 bump and the "owner rule" labels, while the coordination plan assumed the GPT Master channel. Choose one: (a) the owner routes worker instructions through the GPT Master, or (b) workers log any direct owner instruction in section 9 before acting on it (the interim rule in section 5). | Owner / GPT Master | Coordination reliability |
| B-2 | **Partly resolved, 15:20:** authenticated reading of this private repo works in the GPT Master chat (interactive). **Automated consumer access** (the scheduled ChatGPT task reading it unattended, per `docs/CONSUMER_TEST.md`) **remains unverified.** Until it is, don't use the *Consumer access verified* label. | GPT Master | Consumer access verified |

## 9. Handoff log

Append one line per handoff: date, worker, commit or comment link, what changed. Newest last.

- 2026-10-26 Master: created this file; assigned A1, B1, C1; fixed the Ashby `compensation_raw` shape (section 6).
- 2026-10-26 Worker A (on the owner's direct request "implement the Ashby compensation tier fix"): opened farshaikh17/Codex#8 (adapter, stacked on #4) and farshaikh17/Codex#9 (extractor v2, stacked on #2) before this board was read; offered to C and B to adopt or replace. Their shape differs from section 6 in two keys, for evidence-based reasons, for the Master to decide: (1) it keeps `additional_information` per tier, because on the 2026-10-26 feeds 3 of 98 Ashby tiers carry pay facts only there (Clipboard: "Estimated OTE:  65K-80K USD", "Uncapped commissions. Base salary range is $90,000-$110,000.", "Uncapped Commission + Base Salary"); (2) it adds `"source":"ashby.compensationTiers"` and E2 detects the format by that key, because Lever `salaryRange` JSON also starts with `{`, so a leading `{` cannot identify it. #8 also adds `normalization_version`/`normalization_changed` so Clipboard's 36 rewrites (URL unchanged) are not read as employer edits. Verified: 161 compensation-only changes on replayed real feeds, 171/171 components kept, 0 non-verbatim quotes; #7+#8+#9 together 83 tests OK, bench scores unchanged.
- 2026-10-26 14:50 Master (on owner instruction): adopted the #8/#9 shape as section 6. Revised B1 to "adopt #6 and #9" and C1 to "adopt #5 and #8". Recorded #7–#9, `builder1` at `8794ca8`, the `EXTRACTOR_VERSION=2` clash (tier parser becomes 3), and D3's new urgency.
- 2026-10-26 Worker A: A1 done. Contract for `public-page-capture-index-2` in OPERATIONS.md, test-enforced against the committed index (1783532). Field list posted on farshaikh17/Codex#2 (comment 6419553617). `integration/pr1-2-3` rebuilt from all nine open heads (4331322): 132 offline tests, 0 failures; one doc-only conflict between #6 and #9 in ENGINE.md (keep both); stale schema-1/Canonical statements removed from docs/INTEGRATION.md. Handoff comments posted: #5 and #8 to Worker C, #6 to Worker B (#9 handed to B earlier, comment 6419022846). Worker A no longer pushes to #5, #6, #8 or #9. No workflow file changed.
- 2026-10-26 15:20 Master:
  - Recorded the GPT Master's independent confirmation: nine PRs, `main` unchanged, extractor v3 in #9.
  - Recorded that interactive private-repo reading works; automated consumer access is still unverified (B-2).
  - Recorded that candidate gates and labels are provisional pending the canonical Sheets comparison (D3).
  - Revised B1: no version step (#9 already took v3), plus the fix for the one-sided pay-range collapse in `_ashby_tiers`, reproduced in both directions.
  - Re-validated all nine current heads: 132 offline tests OK, one doc-only ENGINE.md conflict between #6 and #9.
  - Marked A1 done. A1, B1 and C1 continue; no merges or schedule changes.
- 2026-10-26 15:30 Master: section 3 refreshed. `main` is now `4225d8e`, from scheduled run 40347918405 (15:17, 10/10 sources, 536 listings, `public/` only). That is the second schedule run in about 14 ticks. Actions now has 18 runs. All nine heads re-validated on the new `main`: 132 offline tests OK. D2 wording updated; still no schedule change.
- 2026-10-26 16:20 Master:
  - Re-sent GPT Master instruction received. Already applied at 15:20; its "`main` unchanged" is superseded by `4225d8e`.
  - Re-validated all nine heads (#1 `a4867d0`, #2 `5c87de2`, #7 `e1438f2`, others unchanged) on `main` `4225d8e`: 149 offline tests OK. The one-sided pay-range bug still reproduces (B1 pending).
  - Recorded capture run 40356103511 (6/6 usable; first meaningful `review_change`).
  - Recorded new provisional candidate work under D3: E5 queue, the estimate guard, and the reported bare-`$` owner rule.
  - A1/B1/C1 continue unchanged. No merges or schedule changes.
- 2026-10-26 16:30 Master (GPT Master decision):
  - B finishes B1 first, and reports the commit and offline test results; B2 (keep employer-published estimated pay as evidence, results provisional) comes after.
  - The bare-`$` rule in #7 is unverified: C reverts `e1438f2` under C1, with no "owner" attribution.
  - C does C1 only, with no new labels. A stands by.
  - All candidate work stays provisional. No merges, schedule, task or Sheet changes.
- 2026-10-26 Worker A (owner request "implement the review_change noise fix"): page-capture schema bumped to `public-page-capture-index-3` (eddcaad, published by the 16:25 capture as 726a27a). review_hash now hashes posting links + claimed_total when links exist (else text minus cookie/consent/tracking/image-only lines); new field review_basis; new review_change value listings_unchanged; earlier-schema evidence kept, review fields re-baselined once. Live 16:08→16:25: raw changed on 5 pages, review_change flags only Salesforce Workday (+1/-1 postings). Notice posted on farshaikh17/Codex#2 for ENGINE.md §3 (E2b input is now -3).

- 2026-10-26 17:40 Master:
  - Recorded #2 `897ddbe` (commission-only "owner rule", `GATES_VERSION=4`) and `d3056d2` (E7 Sheets adapter interface, fake only, no live client or network).
  - Recorded #1 `c93190e` from the 13-minute capture run 40364258754 (cause not investigated).
  - B2 now takes the next unused gate version (5 as of 17:40), and version bumps check `builder1` first. D7 extended to the #2 commits.
  - Combined tree: 170 offline tests OK, same two conflicts, pay-range collapse still present.
  - From now on Master log lines are kept in section 9, above the owner's appended section.

## GPT Master production schedule update — 2026-10-26

Owner requested immediate completion and schedule repair. GPT Master reverified the Actions account budget: $0 paid usage, Usage blocked. Production-only workflow commit `562baaf` on main now schedules `37 1,6,11,16,21 * * *` UTC (five daily collections; 5/5/5/5/4-hour gaps) and removes the five-hour age gate. Push verification run: https://github.com/farshaikh17/Codex/actions/runs/40364324592 . Future cron reliability remains unverified until actual schedule events arrive. No development PR was merged.

Worker C must preserve this new cron and removal of the age gate when integrating #3/#5; merge current main before editing the workflow. This supersedes D2's no-change status and old hourly schedule proposals. Do not restore the age gate or hourly cron inadvertently.

Farhan and Sana ChatGPT tasks were independently read: both enabled, RRULE hourly interval 5, with completed recorded runs scheduled around 09:48 America/New_York on 26 October. Their schedules and candidate rules were not changed. Consumer task access still requires separate end-to-end verification.
- 2026-10-26 17:10 Master:
  - Recorded the owner's production schedule change `562baaf` and `main` `084bafb` (D2 superseded, B-1 resolved).
  - Verified that #3/#4/#5 now conflict with `main` in `collect.yml`, and that #3's due logic would skip every source at the 01:37 slot (4-hour gap). C1 now requires preserving the cron and proving every slot collects.
  - Recorded schema 3 (B1 targets `-3`), B2 at gate version 4, the `e1438f2` revert conflict, and the new provisional work (`dbfdf1f`, `5cc7334`, `98773d9`, `ea69b67`, `6e5ae79`, `1441d0f`).
  - Combined tree: 159 code tests OK.
  - Opened D7 (origin of the "owner rules"), D8 (#7's new cases) and D9 (instruction channel).
  - Placement note: the owner's *GPT Master production schedule update* section follows this log and is kept as written.
