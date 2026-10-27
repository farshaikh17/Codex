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

**Update, 19:20 UTC (supersedes the 18:55, 17:40 and 17:10 blocks below where they differ):**

**State:**
- `main` still `084bafb`. No `schedule` run on the new cron yet; the first slot is 21:37 UTC.
- **No further off-`main` collections.** The only one is still run 40377774005. Worker C's merges of `main` into #3/#4/#7/#10 (18:52–18:56) carried `branches: [main]` and triggered no collection. **D10 is still open**: `main` itself still lacks the filter.
- **Eleven PRs are open.** New: farshaikh17/Codex#11.

| PR | Head | Change since 18:55 |
|---|---|---|
| #1 | `e482c00` | Worker A's section 9 entry (18:56), **the first use of the interim "log the owner instruction" rule**: every Worker A push after A1 was a direct owner request. The 13-minute capture run 40364258754 is explained (see below). On owner request, #5 and #6 are marked ready for review, still stacked. |
| #2 | `fc68672` | Worker B, `fc68672` (19:08): **engine step 8, engine side** (`engine/lock.py`, `engine/run.py`, run history, freshness and partial-run reporting; edits `engine/store.py`). **B1 still not done:** #6 (`1bca0d2`) and #9 (`3018541`) aren't in `builder1`, and the pay-range collapse remains. Each further `engine/store.py` change makes folding #6 and #9 harder. `GATES_VERSION=5`. |
| #3 | `4f26692` | Worker C, `4f26692` (18:55): adopts #2's `collect.yml` lines, which Worker C's commit message calls "owner-requested" (branch filter; workflow tests limited to `test_collect`), and leaves the `DUE_SLACK` line unchanged. `collect.yml` vs `main` now: owner's cron kept, age gate stays removed, plus `branches: [main]`, `test_collect` only, `registry.py` before any request, `--trigger "$EVENT"`, branch-relative publish. |
| #4, #7, #10 | `6527a5f`, `bd8eb53`, `de656d4` | Worker C merged #3 (with `main`) up the stack: #3 → #4 → #7 → #10. #10 also has `cedc767`, "P10 done by the owner". |
| #5 | `48ff370` | Unchanged. **`main` not merged in yet** (C1). |
| **#11** | `2c4b3ba` | **New, Worker C (opened 19:02):** "Collector backoff and request/time budgets" (backlog E8), stacked on #10. **Not part of C1.** Details below. |
| #6, #8, #9 | unchanged | |

**Worker A's finding on the 13-minute capture run:** `playwright install --with-deps` spent 10 min 16 s fetching 21.1 MB of fonts and system libraries over apt, at about 34 kB/s; pip took 36 s. It is fixed in `5d652b3`: pip and Playwright caches, with apt only if a Chromium launch check fails. Capture run 40374013855 (18:02) hit both caches, skipped apt, and took 1 min 42 s in total. Worker A also re-tested #6 merged onto `builder1` at `5d420e9`: 115 tests, 0 failures.

**PR #11 (backoff and budgets): what it does and what's undecided.**
- **Backoff:** on `schedule` runs only, a *failing* source is skipped until its `backoff_until`.
  - The first failure is retried on the next run. After that the wait is 10 h, doubling up to 7 days.
  - A 404/410 waits from 24 h, doubling. A 429 waits at least 24 h, or `Retry-After` if longer.
  - Manual, push and `--ids` runs ignore backoff. A success clears it.
  - **Healthy sources are collected on every scheduled run, so this isn't an age gate** (Master review of `collect.py`).
- **Budgets:** at most 40 feed requests per run, never-attempted sources first, then the least recently checked. No new request starts after 8 minutes. A skipped source republishes its unchanged last attempt with `not_attempted_reason` (`not_due`, `backoff`, `request_budget`, `time_budget`).
- **Policy question (D11):** after a second failure, a source sits out about two of the five daily runs. Confirm, or set a shorter first wait.
- **Live-run claim:** the commit says "a live scheduled run collected 10/10". Actions shows no such `schedule` run, so it must have been a container trial with `--trigger schedule`.
- **Conflict (verified 19:10):** #11 conflicts with **#5** in `collect.py`, `test_collect.py` and `docs/OUTPUT_CONTRACT.md` (3 hunks; #11 isn't stacked on #5). Both are Worker C's. Resolve it when folding #5 into #3, keeping #5's manifest/`--verify` logic **and** #11's backoff and budgets.

**Combined tree, Master check 19:10, all eleven heads on `084bafb`:**
- Conflicts:
  - `docs/ENGINE.md` (#6 vs #9, keep both)
  - `collect.yml` (#2 and #3 vs #1/`main`)
  - `collect.py`, `test_collect.py`, `docs/OUTPUT_CONTRACT.md` (#5 vs #11)
- With the branch side taken for each, **205 tests pass**.
- **This isn't a true combined validation:** taking #11's side replaced #5's manifest code in those three files. A real result needs Worker C's #5/#11 resolution.
- The resulting `collect.yml` keeps `37 1,6,11,16,21 * * *` and `branches: [main]`. `registry.py` OK.
- `fc68672` (19:08) came after this check.

**C1 progress:** the schedule integration is done on #3 and carried to #4/#7/#10. Still open:
- merge `main` into #5, and resolve #5 against #11
- revert `e1438f2`
- fold #5 and #8 in
- the live trial
- the C1 report

**Update, 18:55 UTC (supersedes the 17:40 and 17:10 blocks below where they differ):**

**Urgent: a live employer collection ran from a development branch.**
- Run [40377774005](https://github.com/farshaikh17/Codex/actions/runs/40377774005) (18:26, event `push`, branch `builder1`, commit `021f2af`) collected all 10 feeds live. Its publish step then failed (`git pull --rebase origin main` / `git push` on a feature branch), so **nothing was published**. It used free minutes only; the budget is $0 with usage blocked.
- **Cause:** `main`'s `collect.yml` push trigger has no branch filter. Any branch that merges `main` and then pushes a change to root `*.py`, `sources.json` or `collect.yml` starts a live collection. Worker B triggered it by merging `main` into `builder1` (`f1ac98d`) and then pushing.
- **The fix is one line on `main`:** `branches: [main]` under `push:`, with the cron untouched. It is carried by #1, #2 (`5d420e9`) and #3 (`c01163a`), none of them merged. See D10.
- **Interim rule (all workers):** on a branch whose `collect.yml` lacks `branches: [main]`, don't push changes to root `*.py`, `sources.json` or `collect.yml`. Add the filter in the same push, as #3 did.

**State:**
- `main` is still `084bafb` (16:59). No `schedule` run on the new cron yet; the first slot is 21:37 UTC.
- **Ten PRs are open.** New: farshaikh17/Codex#10.

| PR | Head | Change since 17:40 |
|---|---|---|
| #1 | `54b2707` | Worker A, meant to be standing by: `5d652b3` (17:43) caches pip and Playwright in `crawl-pages.yml`, and installs system packages only if Chromium can't start; `728e7c7` (18:01) reports cache hits. Two more capture runs (17:45, 18:03), committed `ec4b743` and `54b2707`. |
| #2 | `5d420e9` | Worker B. **B1 still not done:** #6 and #9 aren't in `builder1`, `EXTRACTOR_VERSION` there is still 2, and the one-sided pay-range collapse still reproduces. New: `877b6aa` (17:43, multi-currency floors and residents-only pay skipped for candidates elsewhere, **"owner rule"**, `GATES_VERSION=5`); `1778744` (18:05, step 2b: page captures ingested as source pages and leads); `f1ac98d` (18:22, merge of `main`); `021f2af` (18:25, step 9: offline acceptance on the committed snapshot with synthetic candidates, plus `engine.yml`, `workflow_dispatch` only, `contents: read`); `cf86ff4` (docs on the stray run); `5d420e9` (18:50, edits **Worker C's** `collect.yml`: adds `branches: [main]` and narrows the workflow's tests to `test_collect`; keeps the owner's cron and the removed age gate). |
| #3 | `c01163a` | Worker C, **C1 schedule integration done on #3**: `3fb6dd7` (18:52) merges `main`; `c01163a` (18:53) makes `poll_interval_hours` opt-in, so a source without one is collected on **every** scheduled run, and keeps the owner's cron plus `branches: [main]`, `registry.py`, `--trigger` and branch-relative publishing. Master check: a 4 h gap, a 4.3 h gap and a 5 h gap all collect a source without an interval, and a 24 h opt-in source still waits. The new test covers the 01:37 slot. #3 alone: 29 tests OK. No collection was triggered. |
| #4, #5 | unchanged | Still need `main` merged in (C1). |
| #6, #8, #9 | unchanged | |
| #7 | `c5a65c2` | Worker C: `e63d3fa` (17:43) "Mark the GitLab and Zapier cases **confirmed by the repository owner**"; `c5a65c2` (17:46) passes every salary floor to #2's gates. `e1438f2` still not reverted. |
| **#10** | `34c4157` | **New, Worker C (opened 18:09):** "Bounded source discovery: propose official ATS boards for review" (backlog B), stacked on #7. `discover.py` checks robots (also per redirect host), stops on denial, login, CAPTCHA or a 429, makes no retries, and is capped at 15 requests by default (40 maximum), 5 pages and depth 1. It adds `discovery_targets.json`, `test_discover.py`, and `055c390`, which applies **"owner-approved" careers URLs** for Oyster, Zapier and Weave in `employers.json`. It proposes boards for review; nothing joins recurring collection without a reviewed PR. **Not part of C1.** |

**Combined tree, Master check 18:50, all ten heads on `084bafb` (before `c01163a`):**
- Conflicts: `docs/ENGINE.md` (#6 vs #9, keep both) and `collect.yml` (#2 and #3 vs #1/`main`). The branch side was taken for the check only.
- **201 offline tests pass**, 0 failures, 0 errors. `registry.py` OK.
- The pay-range collapse is still present.

**Versions on `builder1`:** `GATES_VERSION=5`, `EXTRACTOR_VERSION=2` (it becomes 3 when #9 is folded in). B2 takes the next unused gate version, **6 as of 18:55**.

**The instruction channel has broken down (D9).** Since 16:30, each worker has worked outside its assignment, citing direct owner instructions:
- Worker A: workflow changes while meant to be standing by.
- Worker B: steps 2b and 9 and another rule, instead of B1.
- Worker C: #10 and "owner-confirmed" labels before finishing C1.

The interim "log the owner instruction first" rule has not been used once. **The assignments in section 5 are this file's plan, not a description of what the workers are doing.**

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
| C | Source registry and collection reliability | Claude Worker C | `session_019pVgcPhTsH8cCJJZcQQ7Vd` | `builderbranches` (#3), `builderbranches-compensation` (#4), `builderbranches-benchmark` (#7), `builderbranches-discovery` (#10, from 18:09), `builderbranches-reliability` (#11, from 19:02); adopts `fix/publication-manifest` (#5) and `fix/ashby-comp-tiers` (#8) | `registry.py`, `test_registry.py`, `employers.json`, `sources.json`, `collect.py`, `adapters.py`, `test_collect.py`, `docs/` except `ENGINE.md`, `INTEGRATION.md` and this file | #1 lands first (shared `collect.yml` hunk) |
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
- **B2 version (revised 17:40; 18:55: now 6):** B2 takes **the next unused `GATES_VERSION` at the moment it lands**, never a fixed number. `dbfdf1f` took 3, `897ddbe` took 4 and `877b6aa` took 5, so it is 6 as of 18:55. Any worker bumping `GATES_VERSION` or `EXTRACTOR_VERSION` first checks the current value on `builder1`.
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
- **Versioning:** bump `GATES_VERSION` to **the next unused number when B2 lands** (6 as of 18:55; 3, 4 and 5 were taken by `dbfdf1f`, `897ddbe` and `877b6aa`), with a comment naming the change.
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
6. **#10** (discovery, stacked on #7), after #7 and D11.
7. **#11** (backoff and budgets, stacked on #10), after #10 and D11. Its conflict with #5 must be resolved by Worker C first (see section 3, 19:20).

**18:55:** before any of 1–6, D10 (the one-line branch filter on `main`) closes the stray-collection risk. #2's `5d420e9` and #3's `c01163a` both edit `collect.yml` and will conflict with #1's hunk. Whoever merges second keeps `main`'s cron, keeps the age gate removed, keeps `branches: [main]`, and takes #3's `registry.py`/`--trigger`/branch-relative publish steps. #2's narrowing of the test step to `test_collect` is a separate choice for Worker C to accept or drop.

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
| D7 | **Origin of the "owner rules".** Workers B and C cite owner instructions that the GPT Master hasn't verified. The bare-`$` → USD on US-only postings rule is in #7 `e1438f2` and, since 16:25, in #2's live gates (`dbfdf1f`). Also: commission-only fails a base floor (#7 `98773d9`, and since 17:07 in #2's live gates as `897ddbe`, `GATES_VERSION=4`), multi-currency floors compared per currency (#7 `ea69b67`), and amounts in millions or billions are never pay (#2 `dbfdf1f`). The GPT Master's 16:30 decision rejected only the bare-`$` rule, and only in #7. Needed: confirmation from the owner, per rule, and for each rejected rule whether its #2 commit (`dbfdf1f`, `897ddbe`) is removed too. **Added 18:55:**
- multi-currency floors and residents-only pay skipped for candidates elsewhere (#2 `877b6aa`, `GATES_VERSION=5`)
- #7 `e63d3fa`: GitLab and Zapier cases "confirmed by the repository owner"
- #10 `055c390`: "owner-approved" careers URLs | Owner, via GPT Master | B2; merge of #2's gates and #7 |
| D10 | **Branch filter on `main`'s `collect.yml` (new 18:55, urgent).** The stray live collection (run 40377774005) can recur from any branch that merges `main` and pushes `*.py`, `sources.json` or `collect.yml`, and C1 requires such merges. Proposal: the owner adds `branches: [main]` under `push:` on `main` now, as a production-only change like `562baaf`, with the cron untouched. Until then, the interim rule at the top of section 3 applies. | Owner / GPT Master | Safe C1/B1 merges of `main` |
| D11 | **PR #10 (bounded source discovery, new 18:09) and PR #11 (backoff and budgets, new 19:02).** Keep each as provisional review material, or park it until C1 is reported. For #10, verify the "owner-approved" careers URLs in `055c390` (Oyster, Zapier, Weave). For #11, decide the backoff policy: 10 h after a second failure, doubling to 7 days, which is about two missed runs of five daily; budgets are 40 requests and 8 minutes. | GPT Master | #10 |
| D8 | Keep or drop #7's provisional cases added after the decision window: `6e5ae79` (2 cases for the `US$` range and company-revenue hazards; neither needs the bare-`$` rule). | GPT Master | #7 |
| D9 | **Instruction channel (18:55: now the main blocker; see section 3).** The owner is instructing workers directly. That has given us the bare-`$` rule, the schema-3 bump and the "owner rule" labels, while the coordination plan assumed the GPT Master channel. Choose one: (a) the owner routes worker instructions through the GPT Master, or (b) workers log any direct owner instruction in section 9 before acting on it (the interim rule in section 5). | Owner / GPT Master | Coordination reliability |
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

- 2026-10-26 18:55 Master:
  - Recorded the stray live collection run 40377774005 from `builder1` (nothing published) and its cause. Opened D10 (one-line branch filter on `main`) and the interim push rule.
  - Recorded new PR #10 (discovery) and D11.
  - #3 `c01163a`: C1 schedule integration done on #3, verified by the Master (every slot collects; 29 tests). #4/#5 still to merge `main`.
  - B1 still not done; `GATES_VERSION=5`, so B2 is at 6.
  - New "owner rule" or "owner-approved" items added to D7.
  - Worker A's caching changes and two capture runs recorded.
  - Combined tree of ten heads: 201 tests OK.
  - D9 escalated: section 5 is the plan, not the workers' actual work.

- 2026-10-26 20:10 Master: executed B1, B2, the bare-`$` removal, C1 and the combined validation on owner instruction; fast-forwarded #2, #3, #4 and #7, pushed `completion/integration`; report at the end of this file.
- 2026-10-26 19:20 Master:
  - Recorded new PR #11 (backoff and budgets) and its verified code conflict with #5. Extended D11 to #11's backoff policy.
  - Recorded C1 progress: the schedule fix on #3 carried to #4/#7/#10. Still open: #5 main merge, the #5/#11 resolution, the `e1438f2` revert, folding #5/#8, the live trial.
  - Recorded #3's current `collect.yml` and Worker A's interim-rule log entry, including the cause of and fix for the 13-minute capture run.
  - Recorded #2 `fc68672` (engine step 8; B1 still not done).
  - No further off-`main` collections.
  - Combined tree of eleven heads: 205 tests OK, but not a true combined result because of the #5/#11 conflict.

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
- 2026-10-26 Worker A: every Worker A push after A1 was a direct owner request in this chat (captures to check review_change, the schema 3 review fix, pip caching, cache-hit confirmation, PR #1/#5/#6 ready for review). Cause of the 13-minute capture run 40364258754 (§ #1 c93190e) was investigated: `playwright install --with-deps` spent 10 min 16 s fetching 21.1 MB of fonts and system libraries via apt at 34 kB/s; pip took 36 s. Fixed in 5d652b3 (pip and Playwright caches, apt only if a Chromium launch check fails). Run 40374013855 (18:02): both caches hit, apt skipped, whole job 1 min 42 s. #6 re-tested merged onto builder1 5d420e9: 115 tests, 0 failures; #5 and #6 marked ready for review on owner request (still stacked; fold into #3 and #2).


## GPT Master completion priority — 26 October 2026 (after a2a4e0f)

Owner now requests completion of Claude work before further manual job-search tests. Consolidate the existing engine; no new engine, feature steps or PR expansion until the blockers below are closed. Direct later owner instructions still take precedence; record their exact scope before acting.

D10 resolved in production: main commit 709948e adds only push.branches: [main] to collect.yml. The five daily cron slots and no-age-gate collection remain unchanged. All worker branches must preserve this on integration.

Completion assignments:
- B: B1 FIRST. Adopt #6 and #9 onto current builder1, resolve store/docs conflicts without losing either feature, fix independent nullable pay bounds and add regression coverage. Prove the combined persistence/recovery + extractor behavior and report final SHA. No additional engine steps before this report. Then fix the overly broad estimated-pay guard: employer-published estimates retain source/qualifier; no automatic salary qualification.
- C: finish C1: adopt #5 and #8, preserve current main workflow, remove the unverified bare-$ owner attribution/approved behavior in both benchmark and gate coordination with B. Run scratch-only live collection and report normalization changes. Do not add labels or discovery sources.
- #10 and #11 are parked outside the minimum release for now. Do not merge their behavior merely because they have tests. In particular no #11-side resolution may discard #5 manifest safety. Backoff policy remains unapproved.
- A: after B/C final heads, build ONE integration tree against current main with #1 + consolidated #3/#4/#2. Record exact SHAs, resolve conflicts preserving both behaviors, run outbound-network-disabled tests. Explicitly test mixed-generation rejection/recovery, missing pay bounds, extractor cache invalidation, rebuild idempotency and candidate isolation. Candidate-specific gates/outputs and fake Sheets interface remain provisional; demonstrate neutral synthetic behavior only.
- Master: produce one completion report: blocker -> fix SHA -> verification evidence -> remaining limitation. A passing test count with replaced/dropped functionality is not combined acceptance.

Candidate information and decisions stay in their existing separate canonical Sheets; do not commit real profiles/history/decision exports. Live Sheets writes and candidate-rule deployment remain outside this software consolidation. No PR merges authorized by this note. No new schedule changes, paid services or manual job-search runs requested.

## Completion report (Claude Master, 2026-10-26 ~20:10 UTC)

Executed by the Master session, on owner instruction, following the GPT Master completion priority above (`bc6cb8a`). It fast-forwards the PR branches with no force-push. Nothing is merged, and no schedule, ChatGPT task or Sheet was changed. #10 and #11 are parked and untouched.

**Branch heads after this work:**
- `builder1` (#2): `fc68672` → **`2fab32a`**
- `builderbranches` (#3): `4f26692` → **`0c76b85`**
- `builderbranches-compensation` (#4): `6527a5f` → **`c4e38fc`**
- `builderbranches-benchmark` (#7): `bd8eb53` → **`2bae921`**
- new **`completion/integration`**: **`f1d31c8`**. Not a PR; do not merge. It is `main` `e812b42` + #1 `bc6cb8a` + #3/#4 `c4e38fc` + #2 `2fab32a`.

**Workers B and C must `git pull` before their next push.** #5, #6, #8 and #9 are now folded into #3, #2, #4 and #2 respectively. The owner may close them as superseded.

**Production workflow preserved:** the integrated `collect.yml` keeps `main`'s `branches: [main]` (`709948e`), the cron `37 1,6,11,16,21 * * *`, and no age gate. On top of that it adds only #3's registry, `--trigger` and branch-relative publish steps, #5's verify-and-revert, and #2's collector-only test step. It is byte-identical on the #4 branch and in the integration tree. No other workflow has a schedule: `crawl-pages.yml` and `engine.yml` are manual or branch-limited.

| # | Blocker | Fix commit(s) | Verification evidence | Remaining limitation |
|---|---|---|---|---|
| 1 | #6 (store rebuild) and #9 (tier parser) not in #2 | `3a4acb7`, `e679b03` (merges; `docs/ENGINE.md`: both sections kept, §6 before §7) | B branch: 138 → 140 offline tests OK. Rebuild from real history twice: 13/13 tables identical; `extractions` differ only in `extracted_at` (wall-clock run time); integrity ok; ~2.7 s; 534 listed postings | `extracted_at` is run time, so whole-store dumps after `extract` are not byte-identical. Rebuild itself is |
| 2 | One-sided pay collapsed to an exact salary. Also present in Greenhouse `max_cents or min_cents`; and a null bound would have crashed the gate | `3595af8` (`EXTRACTOR_VERSION` stays 3, unshipped; `GATES_VERSION=6`) | 8 new tests: Ashby min-only, max-only, both null, both present, published min==max; Greenhouse and Lever one-sided and empty; 6 labelled gate cases. **Against the old code, 5 of 8 fail, including an incorrect exclusion.** Extraction of main's 534 board postings unchanged (0 differ) | Today's live feeds contain **0** one-sided components in 171 Ashby tier components (2 genuine min==max, kept exact). The fix is preventive, proven synthetically |
| 3 | Estimate guard too broad | `640a8fb` (`GATES_VERSION=7`) | Only third-party, salary-site or "not provided by the employer" quotes are excluded. Employer estimates are compared and kept with verbatim quote, `qualifier: employer-published estimate` and `provisional_result`, but never decide the gate. On main's snapshot all **60** previously excluded quotes (Twilio 57, Clipboard 3) are employer estimates and are now kept as evidence; 0 are third-party. The third-party "$135,000" case still never compares | Whether an employer estimate may ever qualify a candidate is open (D3, Sheets comparison) |
| 4 | Unverified bare-`$` owner rule in #2's gates | `4cc3fce` | `us_only`, `OTHER_DOLLARS` and the US-only branch removed. 2 labelled cases now expect salary `unknown`. Commission-only, multi-currency, residents-only and the millions/billions rule are untouched (separate D7 items) | **End-to-end acceptance loses its READY path on the real snapshot.** The only postings that could become READY for the synthetic US candidate had bare-`$` pay. Acceptance reports it `not_run`, never pass. Not restored via a fixture opt-in, which would re-add the rejected rule |
| 5 | Unverified bare-`$` owner rule in #7's benchmark | `2bae921` (a correction, not a plain revert of `e1438f2`: labels before `e1438f2` read bare `$` as USD everywhere) | `validate()` flags any salary label resting on a bare `$`. 5 labels `pass`→`unknown`; only `remote-us-only`/cand-us verdict changes (ready→conditional). No case added. Scored against #2 at gates v7: false READY 0, incorrect exclusions 0, missed exclusions 0, missed ready 1 (`US$` parsing), salary 32/34. #7 alone: 48 tests OK | Other "owner" items in #7 (multi-currency floors, GitLab/Zapier `human_confirmed`) are unchanged pending D7 |
| 6 | Acceptance failed on main's 19:23 snapshot, also on unmodified `builder1` | `2fab32a` | The follow-up simulation edited a posting with no ledger row. It now prefers one with a row. Acceptance: 42/0 on the B branch; **44 passed / 0 failed / 1 not run in the integration tree** | — |
| 7 | #5 (manifest) not in #3, and #3/#4/#5 not on current `main` | `f11dd5f`, `0c76b85` (#3); `c4e38fc` (#4, includes #8) | #3+#5: 32 tests OK. #4+#8: 36 tests OK. #8's `compensation_raw` shape equals section 6 exactly. **Real publish step from `collect.yml`** in a scratch repo: a complete generation publishes; **a mixed generation is refused, `public/` reverted, HEAD unchanged**; the next real live collection verifies and publishes; page captures untouched | #5 vs #11 conflict is unresolved because #11 is parked; a future #11 resolution must keep the manifest |
| 8 | C1 live trial | none (scratch only, nothing committed) | 10/10 sources in 23 s, 532 listings. **162 changed, all `changed_fields: ["compensation_raw"]`**; each changing source has `endpoint_changed` or `normalization_changed`. Clipboard's 36 rewrites are explained only by `normalization_changed`. 2 genuinely new postings; all 10 boards at normalization version 2; manifest of 11 files; `--verify` consistent | The first production run after merge publishes this one-time wave |
| 9 | Combined validation | `f1d31c8` (integration) | **195 offline tests, 0 failures, 0 errors, 0 skipped**, outbound sockets disabled; #1's captures make the leads test run. Cache invalidation on real data: main snapshot 534 extracted → live v2 snapshot re-extracts only **164** (162 changed + 2 new) → rerun 0; store records 126 `compensation_source_added` and 36 `content_changed`. Two rebuilds from real history identical (14 tables, 539 postings, integrity ok). Candidate isolation: all 5 acceptance isolation checks pass (no shared-store writes, private outputs refused in repo, per-candidate items, cross-candidate sheet sync refused, no candidate id in public outputs) | Candidate gates, review queue, outputs and the fake Sheets adapter remain provisional (D3); only neutral synthetic behaviour is demonstrated. Live Sheets, scheduled execution of the integrated code and automated ChatGPT access are not verified |

**Not done by this work:**
- B3 extractor follow-ups: "$1B annually" extracted as pay, and `US$x - US$y` not parsed as one range.
- The C1 `BACKLOG.md`/`HANDOFF.md` refresh.
- D7 decisions on the remaining "owner rules".
- Any merge.
- 2026-10-26 Worker A: independently reproduced `completion/integration` `f1d31c8` in a fresh worktree (owner note bc6cb8a assigned this integration to A; Master built it first, so no duplicate tree was made). It contains main `e812b42`, #1 `bc6cb8a`, #3/#4 `c4e38fc` and #2 `2fab32a`; #1's own files are byte-identical to `bc6cb8a`. Offline suite with outbound sockets disabled: **195 run, 0 failures, 0 errors, 0 skipped**. `collect.yml` keeps `branches: [main]`, cron `37 1,6,11,16,21 * * *` and #5's verify step. Named tests present for each owner-required check: mixed-generation rejection (`test_crash_during_replacement_is_detected_not_silent`), rebuild idempotency and resume (`test_persist.py`), one-sided pay bounds (`screening_cases.py` pay_minimum_only/pay_maximum_only), extractor cache invalidation (`test_extraction_is_cached_by_content_and_incremental`), Ashby tiers (`test_ashby_tiers_keep_currency_period_and_basis_per_component`) and candidate isolation (shared-posting screening cases, acceptance second candidate).

## Handoff — Claude Master recheck, 2026-10-26 ~22:35 UTC

Sources:
- each session's status record
- every branch head
- offline test runs by the Master in temporary worktrees, outbound sockets disabled

No merges, schedule, task or Sheet changes.

### Sessions

| Worker | Session (title) | State | Last activity |
|---|---|---|---|
| A | `session_01WCd9…` "Crawl4AI fallback" | idle, connected | 22:23. `5a08f51` independently reproduced `completion/integration` `f1d31c8` (195 tests, 0 failures). `4301da0`: navigation links beside postings no longer count as job links (Canonical 333 → 313, Atlassian 335 → 334). Reports PR #1 CI green on `4301da0`; next self-check 01:15 UTC |
| B | `session_01FQor…` "Shared engine foundation" | idle, **disconnected since 19:11** | Last report: step 8 on PR #2. **Has not seen the completion work**: `builder1` moved `fc68672` → `2fab32a` at 19:52, after it went idle |
| C | `session_019pVg…` "Codex engine extension" | idle, connected | 22:21. Merged the consolidated #3/#4/#5/#8/#7 work up into the parked #10 (`51d450d`) and #11 (`5c26659`). Updated HANDOFF.md: the bare-`$` rule is not applied. Status: "bare-$ rule decision pending"; next self-check 23:13 UTC |

### Heads

| Branch | Head |
|---|---|
| main | `e812b42` (unchanged since 19:23) |
| #1 | `4301da0` |
| #2 | `2fab32a` |
| #3 | `0c76b85` |
| #4 | `c4e38fc` |
| #7 | `2bae921` |
| #10 | `51d450d` |
| #11 | `5c26659` |
| `completion/integration` | `f1d31c8` |

#5, #6, #8 and #9 are unchanged and superseded: their content is folded into #3, #2, #4 and #2.

### Verified now

- **#11 alone (`5c26659`): 74 tests OK.** It keeps #5's manifest: `verify()`, the manifest code, all three manifest tests, and `collect.yml`'s `--verify` step, cron and branch filter. So its resolution with #5 did **not** discard the manifest, as the completion note requires. #10 and #11 stay parked; the backoff policy is unapproved.
- **Resolved 22:37; see the 22:50 update below.** `completion/integration` + #1 `4301da0`: merges cleanly; **196 tests, 2 failures**:
  - `test_leads.CommittedCaptureTests`
  - `test_acceptance` (its leads check)
- **Cause of the 2 failures.** The engine reuses #1's `job_links()` by design, and `4301da0` changed it. The **committed** `public/pages/index.json` still holds the counts from the previous capture run (Atlassian 335, Canonical 333), while the code now finds 334 and 313. The engine correctly refuses mismatched pages ("no leads taken"). No capture run followed `4301da0`, because `crawl-pages.yml` triggers on `pages.json` and workflow-file pushes only.
  - Production (`main`) is unaffected.
  - At `bc6cb8a`, the integration was 195/195.

### Open items, by owner

- **Worker A (A2): done 22:37; see the 22:50 update below.** Original task: republish captures with the `4301da0` counter. That's one capture run on `build/crawl4ai`, using the existing manual/branch trigger, with no schedule. Then confirm `job_links` in `index.json` equals what `job_links()` returns, and post the run id. No other changes.
- **Worker B (on reconnect):**
  - `git pull origin builder1` before anything else. It now holds B1 (`3595af8`), the estimate fix (`640a8fb`), the bare-`$` gate removal (`4cc3fce`) and the acceptance fix (`2fab32a`); see the completion report above.
  - Then review those commits and say on #2 whether it accepts them.
  - Not yet assigned: B3 extractor follow-ups ("$1B annually" read as pay; `US$x - US$y` not parsed as one range).
  - No new engine steps.
- **Worker C:**
  - C1 is done on #3/#4/#7, apart from the `BACKLOG.md`/`HANDOFF.md` refresh on #3.
  - Keep #10 and #11 parked; don't extend them.
  - Wait for D7.
- **Owner / GPT Master:**
  - **D7, bare `$`. Conflicting records:**
    - Worker C's HANDOFF.md (`51d450d`) says the rule was "given directly by the user" in its session.
    - The GPT Master's 16:30 decision treated it as unverified, and `4cc3fce`/`2bae921` removed it from #2's gates and #7's benchmark.
    - Only the owner can settle which stands. If it stands, it should be re-added once, in #2's gates, with the US-only definition, plus matching #7 labels.
  - D7, other "owner rules": commission-only, multi-currency floors, residents-only pay, `human_confirmed` cases, and #10's careers URLs. Still unconfirmed.
  - D1: merge order `#1 → #3 → #4 → #2`, then #7. Every candidate-specific part stays provisional.
  - Close the superseded #5, #6, #8 and #9.
  - D3: candidate rules after the Sheets comparison, and where outputs live.
  - The new cron hasn't been verified on the integrated code. `main` has had no scheduled run logged since the 16:59 change; the 21:37 slot should have fired.

### Update, 22:50 UTC (Master)

- **A2 done by Worker A**, 22:29–22:37:
  - `2df792d` adds `crawl_pages.py` to `crawl-pages.yml`'s **branch-only** push paths. This is still `build/crawl4ai` only, with no schedule.
  - `8fcfea9` re-derives listing labels (`job_links`, `claimed_total`, `listing_quality`, `coverage`, `flags`, `boilerplate_share`) from every stored capture on each run, so a failed fetch can't leave stale counts.
  - Run 40412808666 (22:30) republished 5/6 pages; Canonical timed out.
  - Run 40413438919 (22:35) committed `8f5bfe1`: 6/6 usable, schema `public-page-capture-index-3`. `job_links` is Atlassian 334, Canonical 313, Automattic 12, Doist 2, Salesforce Workday 20, Toggl 0.
- **Master check:** `completion/integration` `f1d31c8` + #1 **`0591b23`** merges cleanly. **197 offline tests, 0 failures, 0 errors, 0 skipped**, outbound sockets disabled. The leads and acceptance checks pass again.
- **Heads, 22:50:**
  - `main` `e812b42`
  - #1 `0591b23`
  - #2 `2fab32a`
  - #3 `0c76b85`
  - #4 `c4e38fc`
  - #7 `2bae921`
  - #10 `51d450d`
  - #11 `5c26659`
  - `completion/integration` `f1d31c8` (not rebuilt; #1's newer commits merge into it cleanly)
- **Schedule (verified in Actions, 22:45):** there has been no `schedule` run since 15:17. The 21:37 UTC slot, the first under `562baaf`'s cron, created no run. The next slot is 01:37 UTC. No change proposed; this is for the owner or GPT Master.
- **Still open, unchanged from 22:35:**
  - Worker B pulls `builder1` and accepts or rejects the completion commits on #2.
  - B3 extractor follow-ups.
  - Worker C refreshes `BACKLOG.md`/`HANDOFF.md`; #10 and #11 stay parked.
  - D7: the bare-`$` conflict (Worker C reports a direct owner instruction; the GPT Master treated it as unverified), plus the other "owner rules".
  - D1 merge order.
  - Closing the superseded #5, #6, #8 and #9.
  - D3.
  - Automated ChatGPT access and live Sheets remain unverified.

### Recheck schedule

Worker A is standing by; it self-checks at 01:15 UTC and Worker C at 23:13 UTC. Neither check replaces the actions above.
- 2026-10-26 Worker A (A2, done): fixed the stale-index regression from 4301da0. Run 40412808666 (22:30, from 2df792d, which adds crawl_pages.py to the branch-only push paths) republished 5/6 pages, but Canonical timed out and kept its old entry (job_links 333 vs 313 derived). Root fix 8fcfea9: listing labels (job_links, claimed_total, listing_quality, coverage, flags, boilerplate_share) are re-derived from every stored capture on every run, failed fetches included; evidence/change fields and capture files untouched (test_listing_labels_follow_the_code_even_when_a_fetch_fails). Run 40413438919 (22:35) committed 8f5bfe1: 6/6 usable, index job_links equals job_links() on every page (Atlassian 334/334, Canonical 313/313). completion/integration f1d31c8 + #1 8f5bfe1 merges cleanly: 197 offline tests, 0 failures, 0 errors, 0 skipped, including test_leads.CommittedCaptureTests and test_acceptance.

## Release report — Claude Master, 2026-10-26 ~23:10 UTC (supersedes earlier completion and handoff sections where they differ)

No PR merged, no schedule changed, no live Sheets writes, no candidate rule deployed. All pushes were fast-forwards.

### 1. Correction to the 22:50 record

The **197-test result** was measured on `completion/integration` `f1d31c8` + #1 **`0591b23`**. #1's head then moved to **`9e18579`**, a Master docs-only commit: `git diff 0591b23 9e18579` touches only `docs/COORDINATION.md`, so no code changed. A2 is fixed, as recorded at 22:50. The current release candidate below replaces both numbers.

### 2. Exact heads (release candidate)

| PR / branch | Head | Role |
|---|---|---|
| `main` | `e812b42` | production; owner commits `562baaf` (cron), `709948e` (filter) |
| #1 `build/crawl4ai` | `9e18579` code = `0591b23` (+ this report's commit, docs only) | page capture, PR CI, coordination docs |
| #3 `builderbranches` | `95bdcd1` | registry, reliable runs, #5 manifest, backlog/handoff refresh |
| #4 `builderbranches-compensation` | `c4e38fc` | compensation inputs, #8 Ashby tiers |
| #2 `builder1` | **`23922ab`** | store, extraction v4, gates v8 (provisional), queue, outputs, fake Sheets, #6, #9 |
| #7 `builderbranches-benchmark` | `2bae921` | benchmark (labels partly provisional) |
| #10, #11 | `51d450d`, `5c26659` | **parked**, not in the release |
| `completion/integration` | **`05a3ba3`** | validation only, never merge: `main` + #1 + #3 + #4 + #2 |
| #5, #6, #8, #9 | `48ff370`, `1bca0d2`, `5932c0d`, `3018541` | superseded; content folded into #3, #2, #4 and #2 |

### 3. Combined tests and READY-path coverage (Master, offline, outbound sockets disabled)

- **`completion/integration` `05a3ba3`: 203 tests, 0 failures, 0 errors, 0 skipped.** Each PR's own files are byte-identical to its head (`git diff` of #1's, #4's and #2's files against their heads: 0 files).
- **`05a3ba3` + #7 `2bae921`: 215 tests, 0 failures.** Benchmark against gates v8: **false READY 0, missed READY 0, incorrect exclusions 0, missed exclusions 0, unknowns retained 12/12, every gate 34/34** (salary was 32/34 before B3).
- **End-to-end acceptance on `05a3ba3`: 47 passed, 0 failed, 1 not run.**
  - **Synthetic READY path: passes completely.** It uses an invented `example.invalid` posting and a synthetic US candidate in its own store, queue and fake ledger. Gates pass on stated evidence (the `US$` range is read as USD), review makes it READY, and the decision reaches the fake ledger.
  - **Real-snapshot READY path: `not_run`.** On today's real postings, none can reach READY for the synthetic candidates without the bare-`$` rule (provisional, off). This is reported honestly, not as a pass.
  - Career-page leads, mixed-generation, rebuild, cache and isolation checks all pass.
- **Earlier evidence that still holds**, from the 20:10 completion report:
  - The real publish step rejects a mixed generation and recovers on the next live collection.
  - Two rebuilds from real history are identical.
  - Cache invalidation re-extracts only changed versions.
  - The live collection trial: 162 compensation-only changes, all attributed to the collector.

### 4. B3 (Master took ownership; Worker B disconnected since 19:11)

B3 is commit **`23922ab`** on #2: extractor version 4, gates version 8.
- **Company figures:**
  - "$1B annually in revenue" is no longer pay.
  - Funding, valuation and payments-volume sentences without pay wording give no range.
  - Real pay written in millions is kept (JPY 6M–8M; INR 3M–4M passes an INR floor). This replaces version 3's blanket "millions/billions are never pay" rule.
- **Coded dollars:** `US$`, `CA$`, `C$`, `A$`, `AU$`, `NZ$`, `HK$` and `S$` set the currency, so "US$130,000 - US$150,000" is one USD range. A bare `$` is still currency-unknown.
- **Per-unit ranges:** "$30.09/hr - $37.61/hr" is one hourly range (it was two single points).
- **Tests:** 7 extractor tests and 4 labelled cases; 5 of the 6 targeted ones fail on the previous code. On `main`'s 534 postings, exactly 2 extractions change, both Twilio and both as intended.
- **Worker B, on reconnect:** `git pull origin builder1` before any push. Keep all completion commits (`3595af8`…`23922ab`). No force-push and no new engine steps.

### 5. Production workflow checks (`05a3ba3` vs `main`)

- **`collect.yml`:**
  - `push.branches: [main]` (from `709948e`), cron `37 1,6,11,16,21 * * *` (from `562baaf`), no age gate.
  - Added steps: `registry.py` validation before any request, `--trigger "$EVENT"`, #5's `--verify` with revert-and-fail, and branch-relative publish.
  - The test step runs `test_collect` only, so `test_registry` doesn't run in Actions; `registry.py` itself still validates every run.
- **Other workflows:**
  - `crawl-pages.yml`: push limited to `build/crawl4ai`, plus `workflow_dispatch`; no schedule.
  - `tests.yml`: pull requests only, read-only token.
  - `engine.yml`: `workflow_dispatch` only, read-only.
  - **Only `collect.yml` has a schedule.**
- **Scheduled execution on the new cron is not verified.** Actions holds no `schedule` run after 15:17. The 21:37 UTC slot, the first under `562baaf`, created no run. The next slot is 01:37 UTC. There have been no stray collections since run 40377774005 (18:26, nothing published).

### 6. Unresolved candidate-policy behaviour (provisional; integration does not depend on it)

The full table, with affected tests, is in `docs/HANDOFF.md` on #3 (`95bdcd1`).

| Rule | In code now | If the owner decides otherwise |
|---|---|---|
| Bare `$` = USD on US-only postings. Owner direct, per Worker C; the GPT Master treated it as unverified | **off** | Re-add once in `engine/gates.py` `_currency` and update the #7 labels. That would bring back the real-snapshot READY path |
| Commission-only fails a base floor | on (gates v4) | Remove `commission_only` and update the cases |
| Multi-currency floors; residents-only pay not compared | on (gates v5) | Revert to one floor and update the config schema and cases |
| Employer estimates are provisional evidence, never deciding | on (gates v7; GPT Master decision) | Change `EMPLOYER_ESTIMATE` handling |
| "Millions/billions never pay" | **replaced** by the context rule (gates v8 / extractor v4), per the owner's completion instruction | — |
| GitLab and Zapier `human_confirmed` labels; #10 careers URLs and hosts | on in #7; #10 parked | relabel; drop from #10 |

**Every salary result and every READY is provisional** until the canonical Sheets comparison (D3).

### 7. Implemented versus deployed

| Feature | Implemented and tested offline | Deployed (on `main`, running) |
|---|---|---|
| ATS feed collector, 10 feeds | yes | **yes**, old collector code; last collection 19:23 (`e812b42`) |
| Five-daily cron, no age gate, `main`-only push filter | yes | **yes** (owner); schedule events not yet observed |
| Registry, reliable runs, manifest (#3), compensation inputs and tiers (#4) | yes; live trial in a container | no |
| Crawl4AI page capture (#1) | yes; live runs on its branch | no (branch-only, manual) |
| Store, extraction v4, rebuild (#2) | yes | no |
| Gates, review queue, outputs, fake Sheets adapter (#2) | yes, **provisional** | no; no live Sheets, no candidate rules deployed |
| Benchmark (#7) | yes, partly provisional | no |
| Discovery (#10), backoff (#11) | yes | no; parked |
| Automated ChatGPT consumer access | — | **not verified**. Interactive read works (GPT Master) |

### 8. Merge order and what each merge triggers

Owner only; use merge commits. After each merge, the next PR's owner merges `main` into their branch, re-runs the offline guard and confirms `collect.yml` still matches section 5.

1. **#1** (`build/crawl4ai`).
   - Brings PR CI (`tests.yml`) and the capture workflow; no schedule.
   - `crawl-pages.yml` push trigger is inert on `main`.
2. **#3** (`builderbranches`).
   - Its merge pushes root `*.py` and `collect.yml` to `main`, so **one live collection runs** with the new collector. It writes the first manifest.
   - Check the job summary table.
3. **#4** (`builderbranches-compensation`, retarget to `main`).
   - The next collection publishes a **one-time wave** of about 162 `changed_fields: ["compensation_raw"]` rows, with `endpoint_changed` / `normalization_changed` set.
4. **#2** (`builder1`).
   - Adds `engine/`, `engine.yml` (manual) and #2's collector-only test step. **No new collection behaviour.**
   - Candidate features remain provisional and need a private config path to run at all.
5. **#7** (benchmark), after D7/D3, if wanted. **#10 and #11 stay out.**

Close #5, #6, #8 and #9 as superseded.

### 9. Rollback

- **A merge on `main`:** `git revert -m 1 <merge-sha>`, newest merge first, so no history rewrite. Reverting #3 restores `709948e`'s `collect.yml` (filter and cron kept, original collector).
  - Collected snapshots stay valid: `public/` is plain data.
  - A snapshot written by the new collector carries a `manifest` and `normalization_version` that the old collector ignores.
- **Bad publication:** #5's step already refuses and reverts a mixed generation. To restore data by hand, `git checkout <good-commit> -- public/` and commit.
- **Engine store:** a git-ignored cache. Delete `state/engine.sqlite3` and run `python -m engine rebuild --ref origin/main`; it is deterministic.
- **Schedule:** cron changes are owner-only; nothing in this release changes the cron.
- **Candidate outputs:** none are deployed. The Sheets adapter is a fake, so there's nothing to roll back.

### 10. Bounded assignments not started

None of these started; none blocks the release.

- **actionlint (Worker A, after #1 merges):**
  - Run a pinned actionlint release binary locally against the four workflow files in `completion/integration`, with no CI change.
  - Report findings; fix only `crawl-pages.yml`/`tests.yml`. Hand any `collect.yml` finding to Worker C and the owner.
  - **Not started.**
- **JobSpy (Worker C, after C1, as an evaluation doc only):**
  - Verify its licence and the terms of the sites it scrapes. It targets job aggregators whose terms may forbid scraping.
  - No code in the release, no scheduled use, no candidate data.
  - **Not started.**
- **Trafilatura (Worker B):** evaluated and **not adopted** (`docs/ENGINE.md` §6). Revisit only when single job pages are fetched for primary-posting verification. No action now.

Other open items:
- C1's `BACKLOG.md`/`HANDOFF.md` refresh is now **done by the Master on #3 (`95bdcd1`)**.
- P8 (fold `pages.json` into the registry) is **not started**.

### 11. Head update, 23:28 UTC (Master)

At 23:14 Worker C merged the #3 notes commit `95bdcd1` up its stack. **Every change is docs only.** `git diff --name-only` outside `docs/` is 0 files for each branch against its section 2 head, so the section 3 results stand unchanged.

| PR | Section 2 head | Current head |
|---|---|---|
| #4 `builderbranches-compensation` | `c4e38fc` | **`21fba41`** (contains #3 `95bdcd1`) |
| #7 `builderbranches-benchmark` | `2bae921` | **`4607d11`** |
| #10 (parked) | `51d450d` | **`ad1ed8b`** |
| #11 (parked) | `5c26659` | **`8281831`** |

Unchanged:
- `main` `e812b42`
- #1 `5ba8ab6` (code identical to `0591b23`)
- #3 `95bdcd1`
- #2 `23922ab`
- `completion/integration` `05a3ba3`

The merge order in section 8 uses these current heads. No collection run has started since run 40386117652 (19:22, `main`). No `schedule` run has appeared since 15:17; the next slot is 01:37 UTC.

## Final release candidate and merge checklist — Claude Master, 2026-10-26 ~23:50 UTC

Supersedes sections 2, 3 and 11 of the release report where they differ. **Nothing is merged.** All pushes were fast-forwards.

### A. Exact heads

Docs-only updates are listed.

| Merge step | Branch | Head | Changes since the 23:10 report |
|---|---|---|---|
| (base) | `main` | `e812b42` | none |
| 1 | `build/crawl4ai` (#1) | the commit adding this section (docs only). Validated code = `aec118a` = `0591b23` | docs only (`5ba8ab6`, `aec118a`, this commit) |
| 2 | `builderbranches` (#3) | **`c1c4a64`** | `95bdcd1` (docs); **`c1c4a64`: production test step now runs `test_collect test_registry`** |
| 3 | `builderbranches-compensation` (#4) | **`582b5ca`** | `21fba41` (docs, by Worker C); `582b5ca` merges #3 `c1c4a64` (no other change) |
| 4 | `builder1` (#2) | **`bb00b1c`** | `e5b1bf6` cache-invalidation regressions; `af6c1bd` `collect.yml` restored to `main`'s (the engine branch no longer edits the production workflow); `bb00b1c` docs |
| 5 (optional) | `builderbranches-benchmark` (#7) | `4607d11` | docs only (`95bdcd1` via #4, by Worker C) |
| parked | #10 / #11 | `ad1ed8b` / `8281831` | docs only |
| validation only | `completion/integration` | **`739efa8`** | `main` + #1 `aec118a` + #3 `c1c4a64` + #4 `582b5ca` + #2 `bb00b1c` |

Close #5, #6, #8 and #9 as superseded.

### B. Verification evidence

Master, 23:30–23:46 UTC, on a fresh `git archive` export with `PYTHONDONTWRITEBYTECODE=1` and outbound sockets disabled.

| Check | Result | Change from the 23:10 report |
|---|---|---|
| Merge order simulated from clean `main` (#1 → #3 → #4 → #2, `--no-ff`) | 4/4 clean; the result is **byte-identical** to `completion/integration` `739efa8` | new check |
| Full offline suite on `739efa8` | **205 run, 0 failures, 0 errors, 0 skipped** | 203 → 205 (+2 cache regressions) |
| `739efa8` + #7 | **217, 0 failures**. Benchmark: false READY 0, missed READY 0, incorrect exclusions 0, missed exclusions 0, salary 34/34 | 215 → 217 |
| End-to-end acceptance | **47 passed, 0 failed, 1 not run** (real-snapshot READY path). Synthetic READY path passes completely | unchanged |
| Production test step `python -m unittest test_collect test_registry` | OK (32 tests on #3, 36 on #4 and in the combined tree) | new: registry tests now run in Actions |
| `registry.py` | OK, 10 employers, 10 sources | unchanged |
| **actionlint 1.7.7** (release tarball, SHA-256 matched `actionlint_1.7.7_checksums.txt`) with shellcheck 0.10.0 and pyflakes 3.2.0, on all four workflows of `739efa8` | **0 errors** (exit 0). Shell checking confirmed active: a syntax-error canary is reported (SC1046/SC1073, exit 1) | new |
| Byte identity of each PR's own files in `739efa8` vs its head (#1 `aec118a`, #4 `582b5ca`, #2 `bb00b1c`) | 0 files differ for each | unchanged |
| `collect.yml` vs `main` | Cron `37 1,6,11,16,21 * * *` and `push.branches: [main]` unchanged. Added: test step (`test_collect test_registry`), `registry.py` validation, `--trigger "$EVENT"`, manifest `--verify` with revert-and-fail, branch-relative publish. **Only `collect.yml` has a schedule** | test step now includes `test_registry` |
| Candidate data in the tree | 4 candidate configs, all `synthetic: true`; no real profiles, decisions or application history | unchanged |

### C. B3 cache invalidation

- **Extraction:** results are keyed on (posting, content hash, `EXTRACTOR_VERSION`). B3 bumped the extractor to **4**, so every stored version is re-extracted on the next `extract`.
- **Screening:** queue item ids include `GATES_VERSION`, now **8**, so every posting is re-screened.
- **Regressions (`e5b1bf6`):**
  - A cached version-3 record that read "$1B annually in revenue" as a $1 pay range is re-extracted, and the current record says compensation `not_stated`. The test **fails if `EXTRACTOR_VERSION` is left at 3** (checked).
  - A `GATES_VERSION` bump re-screens unchanged postings.
- **Measured on real data** at the 20:10 completion: a version bump re-extracts all 544 versions; an unchanged rerun extracts 0.

### D. Decisions recorded (owner, 23:30)

- **A bare `$` stays currency-unknown.** No rule reads it as USD (gates `_currency`; `bench/score.py` flags any bare-`$` salary label).
- **Candidate Sheets remain the separate canonical ledgers.** The Sheets adapter is a fake with no live client; no Sheet is written.
- **No real candidate profiles, decisions or application history are committed.** Enforced by `test_committed_candidate_files_are_synthetic` and by the repository-path refusals in `candidates`, `review`, `outputs` and `sheets`.
- **Unresolved candidate policies stay provisional.** The list, with affected tests, is in `docs/HANDOFF.md` on #3/#4.
- **#10 and #11 stay parked.**
- **Trafilatura: evaluated, not adopted.** On 2026-10-26, version 2.3.1 (Apache-2.0) installed 18 packages, including lxml (a C extension) and `tld` (MPL/GPL/LGPL). On ATS description fragments, the only input the engine has, it matched the standard-library converter: 5/5 requirement bullets and the pay line kept. It helps only on full HTML pages, which the engine doesn't ingest. Adopting it would add dependencies and break the install-free CI for no measured gain. Revisit only if single job pages are fetched for primary-posting verification; that would need an `EXTRACTOR_VERSION` and `CONTENT_HASH_VERSION` bump. Details: `docs/ENGINE.md` §6.
- **JobSpy:** a bounded evaluation (licence plus the scraped sites' terms), **not a release blocker, not started**.

### E. Incidents during this pass (no production effect)

- **`af6c1bd`/`bb00b1c` were pushed to `builder1` before their test result was checked.** That run showed 1 failure. The cause was a stale `__pycache__` in the Master's scratch worktree: a proof step briefly set `EXTRACTOR_VERSION=3` and restored it within the same second at the same size, so Python reused the old bytecode. The committed code was correct. With the cache cleared, 148/148 passed.
- From then on, every push was made only after a green fresh-export run with `PYTHONDONTWRITEBYTECODE=1`.
- `builder1`'s `collect.yml` has the branch filter, so no collection could run from it.

### F. Merge checklist (owner; merge commits; stop at any failed check)

1. ☐ **Before merging:** confirm the heads in table A (`git ls-remote origin`). Any other SHA invalidates section B.
2. ☐ **Merge #1 `build/crawl4ai`** into `main`.
   - Expect PR CI (`tests.yml`) to start running on later PRs.
   - No capture runs (`crawl-pages.yml` triggers only on `build/crawl4ai` pushes and manual dispatch).
3. ☐ **Merge #3 `builderbranches` (`c1c4a64`).**
   - **Expect one live push collection on `main`** (root `*.py` and `collect.yml` changed).
   - Check its job summary: the test step runs `test_collect test_registry`, the registry validates, all sources show `ok`, and the run writes the first `manifest` to `status.json`.
   - Then run `python collect.py --verify` on the result: it should report "publication consistent".
4. ☐ **Merge #4 `builderbranches-compensation` (`582b5ca`).**
   - The next collection publishes a **one-time wave** of about 162 `changed` rows with `changed_fields: ["compensation_raw"]`, each with `endpoint_changed` or `normalization_changed` set.
   - All board files should be at `normalization_version` 2.
5. ☐ **Merge #2 `builder1` (`bb00b1c`).**
   - Expect no new collection behaviour; `collect.yml` is unchanged by this merge.
   - Optionally dispatch `engine.yml` (manual, read-only) and expect acceptance 47/0/1.
6. ☐ **Optional:** merge #7 `4607d11` after D7/D3. **Do not merge #10 or #11.**
7. ☐ **Close** #5, #6, #8 and #9 as superseded.
8. ☐ **After merging:**
   - Watch for the first `schedule` event on `37 1,6,11,16,21`. None has arrived since the cron changed, so the 21:37 slot was missed.
   - Confirm `branches: [main]` and the cron are byte-identical to `709948e`/`562baaf`.
9. ☐ **Rollback, if needed:** `git revert -m 1 <merge-sha>`, newest first. See release report section 9.

### G. Still not verified (not release blockers)

- Scheduled execution of the five-daily cron.
- Automated ChatGPT consumer access. Interactive reading works.
- Live Sheets. None by design.
- A real-posting READY path. It needs a provisional policy decision; the synthetic path is proven.
- **Not started:** JobSpy evaluation, P8, and an actionlint step in CI. actionlint was run locally before merge, as required.

## Handoff and authority — 2026-10-26 ~23:55 UTC

### Owner authority (recorded at the owner's instruction)

The owner stated: *"I have no idea what worker is what, so this chat has the authority to directly control the workers and all the Repos."*

From now on:
- **This chat, the Claude Master** (`session_012Voup5dFSNWfqAGJ3FzjFS`, "Codex master planning and coordination"), directs the Claude workers below.
- It sends them instructions directly, through cross-session messages, and records every instruction here.
- Workers treat a Master message as their assignment. They log what they did in section 9 before pushing.
- The GPT Master still sets requirements and priorities. Where the two conflict, the owner decides.

**Still owner-only (unchanged by this grant):**
- merging PRs
- changing schedules
- writing to live Sheets
- deploying candidate rules
- spending money

### Who is who

| Name used in this file | Session title in the Claude app | Session id | Branches / PRs | State (23:51 UTC) |
|---|---|---|---|---|
| **Claude Master** | Codex master planning and coordination | `session_012Voup5dFSNWfqAGJ3FzjFS` | `build/crawl4ai` (docs), `completion/integration`; release work on #2, #3, #4, #7 | active |
| **Worker A** (Crawl4AI) | Crawl4AI fallback | `session_01WCd9wwgzPgNAHU6F2kv6QK` | #1 `build/crawl4ai`; wrote #5, #6, #8, #9 | idle, connected; reports RC `babada8` validated; self-check 01:15 UTC |
| **Worker B** (engine) | Shared engine foundation | `session_01FQorivZRVyv3ggSUDwDoq6` | #2 `builder1` | idle, **disconnected since 19:11**. Hasn't seen the completion commits; must `git pull origin builder1` before any push |
| **Worker C** (registry/collector) | Codex engine extension | `session_019pVgcPhTsH8cCJJZcQQ7Vd` | #3, #4, #7, #10, #11 (`builderbranches*`) | idle, disconnected (23:14); last action: #3 notes merged up the stack; self-check 03:15 UTC |

Other sessions on the same account work on **other repositories** (Mianrodev/msdev: "Opportunity discovery product", "Website Builder"; Mianrodev/Goes-Local: "Local directory expansion feasibility", "Goes Local deployment setup"). They are **outside the Codex release**. The Master does not direct them unless the owner names them.

### State (unchanged since the final release candidate section)

- **Heads:**
  - `main` `e812b42`
  - #1 `babada8` (code = `aec118a`)
  - #3 `c1c4a64`
  - #4 `582b5ca`
  - #2 `bb00b1c`
  - #7 `4607d11`
  - #10 `ad1ed8b`, #11 `8281831` (parked)
  - `completion/integration` `739efa8`
- **Evidence:**
  - Merge order clean from `main` and byte-identical to the integration tree.
  - 205/205 tests; 217/217 with #7, benchmark perfect.
  - Acceptance 47/0/1; the real-posting READY path is not run while a bare `$` stays currency-unknown.
  - actionlint 1.7.7 with shellcheck: 0 errors.
  - Only `collect.yml` is scheduled. All candidate configs are synthetic.
- **Not verified:**
  - Scheduled execution: the 21:37 slot missed; next 01:37 UTC.
  - Automated ChatGPT access.
  - A real-posting READY path.
  - Live Sheets: unused by design.
- **Merge checklist:** see *Final release candidate and merge checklist* above (section F). Nothing is merged.

### Standing instructions to workers (from the Master)

- **Worker A:** stand by; no pushes. #1 is release-ready at `babada8`.
- **Worker B:** on reconnect, run `git pull origin builder1` first.
  - Keep `3595af8`…`bb00b1c`; no force-push.
  - No new engine steps.
  - Leave `.github/workflows/collect.yml` exactly equal to `main`'s.
- **Worker C:**
  - Keep #10 and #11 parked.
  - No changes to #3 or #4 except merging `main` if asked; their release heads are `c1c4a64` and `582b5ca`.
  - No new labels; wait for the provisional-policy decisions.
- **All workers:** no merges, schedule changes, Sheet writes or candidate-rule changes. Log any direct owner instruction in section 9 before acting on it.

### Open decisions (owner / GPT Master)

1. Approve the merge order and perform the merges (owner).
2. The missed 21:37 scheduled run: investigate, or wait for 01:37.
3. Provisional candidate policies, against the canonical Sheets:
   - commission-only
   - multi-currency floors
   - residents-only pay
   - employer estimates
   - GitLab/Zapier benchmark cases
   - #10 careers URLs
4. D3: where candidate outputs live.

## Release executed — Claude Master, 2026-10-26 23:55 – 2026-10-27 00:06 UTC (owner-authorized)

The owner authorized merging the completed release and verifying it. Merges used merge commits, in the order #1 → #3 → #4 → #2 → #7. Each merge was pinned to its validated head, and the release stopped between merges for verification. No force-push.

**Not changed by this release:**
- No schedule change.
- No live Sheets writes.
- No candidate configuration deployed.
- No ChatGPT task or candidate rule changed.

### Pre-merge check

- Heads matched the final checklist. #1 had changed only in `docs/COORDINATION.md` since validation.
- All five merges were simulated from `main` `e812b42`: clean, **217/217 tests**.
- The collect workflow's state was `active`.

### Merges and verification

| Step | PR | Validated head | Merge commit | Production check | Actions run | Result |
|---|---|---|---|---|---|---|
| 1 | farshaikh17/Codex#1 page capture, PR CI, docs | `c38a4cc` | **`a69229b`** | #1 adds root `crawl_pages.py`, so it triggered a push collection (the checklist wrongly said it wouldn't) | [40423113874](https://github.com/farshaikh17/Codex/actions/runs/40423113874) | success. Published `50bc091`: 10/10 ok, 533 listings. Branch-relative publish works on `main` |
| 2 | farshaikh17/Codex#3 registry, reliable runs, manifest | `c1c4a64` | **`2ca5653`** | collector + registry tests, source health, manifest | [40423220346](https://github.com/farshaikh17/Codex/actions/runs/40423220346) | success. Log shows **32 tests incl. `test_registry`, OK**; `registry.py` OK; 10/10 sources ok, 0 failures; `run_id gh-40423220346-1`, `trigger push`; **first manifest (11 files)**, "publication consistent" in the publish step and again locally. Published `270a637` |
| 3 | farshaikh17/Codex#4 compensation inputs, Ashby tiers (retargeted to `main`) | `582b5ca` | **`99f14c9`** | normalization v2; collector-format vs employer changes | [40423360906](https://github.com/farshaikh17/Codex/actions/runs/40423360906) | success. **All 10 boards at `normalization_version` 2.** **162 changed postings, all collector-format** (`changed_fields == ["compensation_raw"]` with `endpoint_changed` or `normalization_changed`): GitLab 107, Clipboard 36 (normalization only), Zapier 12, Oyster 7. **0 employer edits, 0 new.** 55 Ashby postings carry tier JSON. Manifest verifies. Published `114a2bf` |
| 4 | farshaikh17/Codex#2 store, extraction v4, provisional gates/queue/outputs/fake Sheets | `bb00b1c` | **`9c13eab`** | combined tests, acceptance; no collection expected (no root `*.py`, `collect.yml` unchanged by the merge) | — (no run, as expected) | Fresh export of `main`: **205/205**. Acceptance **49 passed, 0 failed, 0 not run** (below) |
| 5 | farshaikh17/Codex#7 benchmark (retargeted to `main`) | `4607d11` | **`82fde18`** | combined tests, benchmark; push collection (adds root `test_bench.py`) | [40423901236](https://github.com/farshaikh17/Codex/actions/runs/40423901236) | success. Published `254b867`. Fresh export of final `main`: **217/217**. Benchmark: false READY 0, missed READY 0, incorrect exclusions 0, salary 34/34 |

**READY-path coverage changed for the better after #4.** On the production snapshot with normalization v2, the real-snapshot READY path now runs and passes. Synthetic candidate `synthetic-cs-us`, on real posting `ashby:zapier:04838dc8-…`, has its USD stated explicitly by the Ashby tier `currencyCode`, not by a bare `$`. The decision reaches the **fake** ledger. The synthetic READY path also passes. This is offline evidence with synthetic candidates only; nothing was deployed.

### Pull requests after the release

- **Merged:** #1, #3, #4, #2, #7. Each head is in `main`, with its merge commit's second parent equal to the validated head.
- **Closed as superseded, with a comment naming where the content went:** #5 (manifest, into #3), #6 (rebuild, into #2), #8 (Ashby tiers, into #4), #9 (tier parser, into #2).
- **Open and parked:** #10 (`ad1ed8b`, base `builderbranches-benchmark`) and #11 (`8281831`, base `builderbranches-discovery`). Neither is in `main`, and the backoff policy is unapproved.

### Production snapshot and controls (`main` `254b867`, 00:03 UTC)

- `status.json` attempted 00:03:39 UTC, status `ok`, 10/10 sources, 533 listings, run `gh-40423901236-1`, manifest of 11 files. `collect.py --verify`: publication consistent.
- **`collect.yml`:** `push.branches: [main]` and cron `37 1,6,11,16,21 * * *` are **identical** to the owner's `709948e`/`562baaf`, with no age gate. **Only `collect.yml` has a schedule.**
- **Browser crawling stays manual:** `crawl-pages.yml` triggers only on pushes to `build/crawl4ai` and on `workflow_dispatch`.
- **$0 controls:** this session did not change any spending setting and can't see billing. The GPT Master's earlier check found $0 paid, with usage blocked. Every run in this release used standard `ubuntu-latest` runners, about 30–60 s each.
- **Non-blocking warning** in every run: `actions/checkout@v4` and `setup-python@v5` target Node 20, which GitHub has deprecated; it currently forces them onto Node 24. A version bump is a separate, bounded task.

### Scheduling investigation (no schedule changed)

| Event type | Runs of `collect.yml`, all time | Notes |
|---|---|---|
| `schedule` | **2**: [40288776346](https://github.com/farshaikh17/Codex/actions/runs/40288776346) (07:55 UTC) and [40347918405](https://github.com/farshaikh17/Codex/actions/runs/40347918405) (15:17 UTC) | Both under the old hourly cron `23 * * * *`, starting 32 and 54 minutes after a tick. That's 2 runs in about 16 hourly ticks (01:23–16:23) |
| `push` on `main` | 10, all success except the pre-gate failure at 01:35 | They show the workflow, runners and minutes work; **they are not scheduled execution** |
| `schedule` under the owner's cron `37 1,6,11,16,21` (from 16:59) | **0**. The 21:37 slot created no run | next slots: 01:37, 06:37 UTC |

**Findings:**
- The workflow is `active`, not disabled for inactivity.
- It's on the default branch `main`, and the cron is valid; actionlint passes.
- Push runs succeed, so the account is not blocked from running Actions.
- **The pattern matches GitHub's documented best-effort scheduling:** scheduled events can be delayed or dropped under load. 14 of about 16 hourly ticks were dropped, and the first slot of the new cron was dropped.
- Nothing in the repository explains the drops, and **no repository change can guarantee a scheduled run.**
- **Recommendation (owner/GPT Master decision; nothing changed):** watch 01:37 and 06:37. If they're dropped too, choose a backstop that doesn't change the cron itself. Two options:
  - the existing `workflow_dispatch` trigger, started by the owner or an external free scheduler with a token;
  - accept best-effort scheduling and rely on the consumer's freshness checks (`status.json` `attempted_at`).

  Until then, *scheduled execution* stays **not verified**.

### Remaining blockers

1. **Scheduled execution:** not verified, as above.
2. **ChatGPT ingestion:**
   - Interactive authenticated reading of this private repo works (GPT Master).
   - **Automated, unattended consumer access is not verified.** The ChatGPT tasks were read by the GPT Master and are enabled; their schedules weren't changed.
   - The next step is `docs/CONSUMER_TEST.md` from the consumer chat. The consumer should read `public/status.json`, check `run_id` and `manifest`, and treat the one-time wave of 162 `compensation_raw` changes as collector-format (`endpoint_changed`/`normalization_changed`), not employer edits.
3. **Candidate policy:** provisional until the canonical Sheets comparison (D3). No candidate rule or configuration is deployed. Gates, queue, outputs and the Sheets adapter run only with private configs, which don't exist in the repository.
4. **Parked:** #10 and #11.
5. **Not started:** JobSpy evaluation, P8, actionlint in CI, the Node 20 → 24 action bump.

### Workers after the release

- **Worker A:** the PR #1 branch is merged; no further pushes needed.
- **Worker B:** disconnected. `builder1` is merged; on reconnect, branch any new work from `main`.
- **Worker C:** #3, #4 and #7 are merged. #10 and #11 stay parked; if they're ever resumed, retarget them to `main` and merge `main` into them first.


## GPT Master consumer publication repair — 2026-10-27 UTC

Owner authorized direct completion and verification. Workflow commit 6551e7 adds full-history store rebuild, current snapshot ingestion, extraction v4, public-posting export and hash verification before publishing public/postings/. No real candidate configs/decisions are generated. Live run https://github.com/farshaikh17/Codex/actions/runs/40427268334 passed collector+registry tests, engine output tests, collection, export verification and publication. Readback: 533 listed + 11 missing historical records; 513 ok / 31 uncertain extractions. Authenticated ChatGPT read of export status, bounded index and individual record succeeded. Both existing ChatGPT task prompts now reference this export and blocked-page retry deferral; schedules and eligibility gates unchanged. Real unattended task ingestion of the NEW export is not yet verified. Native Sheets remain canonical; software private queue/Sheets adapter not deployed. Worker changes must preserve this exporter in collect.yml.

## Claude Master review of PR #13 and coverage extension — 2026-10-27 ~19:45 UTC

Nothing merged. Cron, push filter and billing unchanged. No candidate data, Sheets or ChatGPT task changes.

**PR #13 (release candidate), head f1f31c7** — reviewed independently from b21609f; fixes pushed:
- robots_rules swallowed `Halt`, so an exhausted budget/429 was recorded as "robots.txt unreachable" and the
  target was blocked and cooled down without a request. Fixed; un-requested directories, feeds and targets now keep
  their state and appear under `deferred` (not_attempted / cooldown / rotation_limit).
- The reused scanner had no pause between same-host requests. Network now waits max(1 s, robots Crawl-delay) and
  skips hosts asking for more than 15 s. Body reads are bounded in time (≤30 s) as well as bytes.
- Vacancy cards were full job records (descriptions included) with no source health. Now compact, with location
  text, provenance, observed/published times, the source's latest real status/checked_at, `eligibility:
  not_assessed`, and last_known_good_after_failure for failed sources. Leads dedupe by host with first/last seen.
- Software "Site Reliability Engineer" and "Sales Commission Analyst" were counted as asset/commissioning signals.
  Fixed.
- Engine freshness would report the new 24-hour sources stale for half of each day. A source with
  poll_interval_hours is now judged against its interval + 6 h; a missed daily poll is still stale.
- CAI evidence was overstated (the careers index does not link the board; the "plugin" is formatting JS). Now: CAI's
  own job page links the exact cagents Lever posting id present in the API; cagents.com 301 → caiready.com.
- SmartRecruiters (Assystem): api.smartrecruiters.com/robots.txt disallows all agents except LinkedInBot. Not adopted.
- Verified: 260 root + 153 engine tests from a clean export; PR CI green
  https://github.com/farshaikh17/Codex/actions/runs/40569567137. Scratch discovery: 17 GETs, NAESCO and HubSpot 403.

**Coverage PR (stacked on #13), branch coverage/energy-crm-sources** — Cognite, EnergyHub, Voltus, Celigo feeds
(ownership confirmed on each careers page), bounded directory-lead validation, same-title card merging. Live trial:
six feed GETs, 302 exact vacancies; export 835 records verified; discovery 23 then 8 GETs, 25 cards from 11 employers.
264 root + 153 engine tests from a clean export.

**Scheduling**: schedule events now arrive — 00:45, 06:47, 16:50 UTC on 27 Oct (runs 40428414921, 40463178019,
40544864597), all success, 10–13 min to ~3 h late; the 11:37 slot (and likely 01:37) did not fire. Best-effort
delivery, no change made.

**Overlaps**: discover.py came from parked PR #10; this work changes its robots Halt handling, body time bound and
unsupported-ATS list, so #10 would conflict on discover.py/test_discover.py. #11 stays parked; its collector budgets
are not adopted.

**Post-merge checks (owner merges #13, then the coverage PR)**: the sources.json push starts one collection — do not
dispatch another. Confirm: registry 12 (then 16) sources; new board files with jobs; `collect.py --verify` consistent
in the log; posting export verify problems=[]; public/discovery/report.json generated_at from that run, errors and
deferred listed, vacancies carry source_status; no Sheets/task changes. Then watch the next scheduled run: the 24 h
sources show `not due` and discovery reports cooled targets as deferred. Rollback: `git revert -m 1 <merge sha>` on
main (no force-push); the next collection drops nothing it has not re-fetched, and orphan board files are listed in
status.json, not deleted.

## Merged and verified — #13 and #14, 2026-10-27 ~20:35 UTC (owner-authorized)

| PR | Head | Merge commit | Collection run | Result |
|---|---|---|---|---|
| #13 | f1f31c7 | 5179d6c | https://github.com/farshaikh17/Codex/actions/runs/40578528233 | 12/12 ok, 730 listings (HighLevel 105, CAI 94); discovery 17 GETs; published 46d52d8 |
| #14 (retargeted to main; simulated merge 264+153 tests green) | ffac14d | d300f0d | https://github.com/farshaikh17/Codex/actions/runs/40579210761 | 16/16 ok, 833 listings (Cognite 52, Celigo 22, Voltus 16, EnergyHub 13); published 0f0c7bf |

Verified on 0f0c7bf from a fresh export: `collect.py --verify` consistent (manifest 17 files); posting export
verify problems=[] (extraction ok 692 / uncertain 162 — uncertain rose from 103 with the new sources' descriptions);
discovery report generated in that run: 13 GETs, no errors, NAESCO/HubSpot/Remote In Tech and three targets listed as
cooldown deferrals, two leads validated (10up no board; 1password Ashby board unverifiable), 25 cards from 11
employers, largest share 0.12, all cards source_status ok. The six 24 h sources show next_due_at 2026-10-28 20:34 UTC;
push runs collect every source, scheduled runs will skip them until due. Cron, push filter and billing unchanged; no
Sheets, ChatGPT task or candidate changes. Next: confirm a scheduled run lists the daily sources as not due, and the
unattended ChatGPT read of the export. Rollback if needed: `git revert -m 1 d300f0d` then `5179d6c`, no force-push.

## Discovery expansion — Claude Master, 2026-10-27 ~21:40 UTC (branch discovery/role-search-career-pages)

Not merged. Cron, push filter, billing, Sheets, ChatGPT tasks and candidate rules unchanged; no candidate data.
Overlap flagged before editing: #10 edits existing employers.json entries and registry.py; #11 rewrites collect.py.
This branch leaves collect.py and registry.py untouched and only appends one employers.json entry (Avathon).

Implemented (details and evidence: docs/MARKET_DISCOVERY.md, "Discovery expansion"):
- role_search.py — Himalayas Jobs API role/location queries (10 generic queries, 3 per run, 24 h each).
  JobSpy evaluated and rejected (private Naukri API with forged headers/signed token; TLS impersonation;
  Bayt challenge). Remotive/RemoteOK robots-disallowed; Jobicy filters ineffective.
- career_pages.py — stdlib JSON-LD JobPosting and career RSS extraction with identity, location wording,
  salary provenance and uncertainty; Siemens Energy and Siemens India feeds (ownership-reviewed).
- Directory → profile → employer website traversal (Zapier partner directory); profile leads validated first.
- signals.py — generic responsibility families, strong/weak/excluded strength (sales/support excluded,
  specialist software/test/named-language weak), India-explicit vs region-only geography.
- Exposure-based card rotation; same-title grouping keeps all identities; channel cache for cooled channels;
  failure backoff 1→14 days; per-method request/second cost; new vs repeated identities; compact state.
- Avathon Greenhouse feed (Bengaluru industrial AI/asset performance), 24 h polling.

Tested: 288 root + 153 engine tests from the working tree (offline). Live (scratch): run 1 31 GETs / 35 s,
run 2 18 GETs / 24 s; 926 exact + 61→116 provisional identities; 78 cards; 56 new identities in run 2.
Not integrated: private relevance feedback (documented optional aggregate format only).
