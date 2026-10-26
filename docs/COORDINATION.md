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
| farshaikh17/Codex#7 | `builderbranches-benchmark` → `builderbranches-compensation` | `2088dce` | no | Worker C | Backlog H: labelled benchmark fixtures, collection scenarios and scorer (opened 14:36) |
| farshaikh17/Codex#8 | `fix/ashby-comp-tiers` → `builderbranches-compensation` | `5932c0d` | yes | Worker A, **in Worker C's area** | Ashby `compensationTiers` kept verbatim (section 6 shape), `normalization_version`/`normalization_changed` |
| farshaikh17/Codex#9 | `fix/ashby-comp-extract` → `builder1` | `1412f62` | yes | Worker A, **in Worker B's area** | E2 parses the section 6 tier JSON per component |

**Update 14:50:** `builder1` (#2) has moved to `8794ca8` (Worker B, 14:40, "Add candidate configuration and evidence-based screening gates"). That adds `engine/candidates.py`, `gates.py`, `screen.py`, `places.py`, `benchmark.py`, `docs/SCREENING.md` and synthetic candidate fixtures, which is E3/E4 work. Two consequences:
- It sets `EXTRACTOR_VERSION=2` for a wording change. #9 is based on `5d31675` and *also* sets `EXTRACTOR_VERSION=2`, for the tier parser. The extraction cache is keyed on extractor version, so the two must not share a number. Whichever lands second on `builder1` takes **3**.
- E3/E4 sat behind decision D3. See D3 in section 8.

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

### B1: Adopt #6 and #9 into `builder1` (Worker B) (revised 14:50; don't reimplement the tier parser)
- Review `fix/store-rebuild` (#6). Either merge it into `builder1` or keep it stacked, and say which on #2. Don't create a second persistence module.
- Review `fix/ashby-comp-extract` (#9) against section 6 and merge it into `builder1` (a merge commit, no rebase). Then:
  - Resolve the `EXTRACTOR_VERSION` clash: the tier parser becomes **3**, with a comment naming both changes.
  - Check that format detection is by `data.get('source') == 'ashby.compensationTiers'`, not by a leading `{`. Lever `salaryRange` JSON must still take the Lever path.
  - Check that `additional_information` is kept as a verbatim quote and is never parsed into amounts.
  - Check that #9's tests and `8794ca8`'s screening tests pass together.
- Mapping rules, as in #9 (verify, don't change):
  - one range per tier and component
  - currency from `currencyCode`, never from `$`
  - period from `interval` (`1 YEAR` → year, also month, week, day and hour; `NONE` or unknown → `not_stated`, with `interval_raw` kept)
  - basis from `compensationType` (Salary → base; Bonus and Commission → variable; Equity* → equity)
  - null min or max → `not_stated`
  - no conversion, no annualizing, no merging of tiers
- After A1's comment, update `docs/ENGINE.md` §3 to schema `-2`. Don't implement E2b ingestion yet.
- Not in scope: `adapters.py`, `collect.py`. No further E3+ work until D3 is answered.
- Say on #9 that it is folded in, then leave #9 for the owner to close.
- **Acceptance:** all engine tests pass offline, with the count stated. The extractor version is distinct from `8794ca8`'s 2. Existing string-format extraction counts on the committed snapshot are unchanged. #6's and #9's status is stated on #2.

### C1: Adopt #5 and #8 (Worker C) (revised 14:50; don't reimplement the adapter)
- Review `fix/publication-manifest` (#5). Either merge it into `builderbranches` or keep it stacked, and say which on #3. #3 and #5 must reach `main` together.
- Review `fix/ashby-comp-tiers` (#8) against section 6 and merge it into `builderbranches-compensation` (#4), as a merge commit. Then:
  - Check that `docs/OUTPUT_CONTRACT.md` states the section 6 shape exactly (it does on #8 at `5932c0d`; keep it in sync).
  - Check that `normalization_version` 2 and `normalization_changed` are documented, and that `changed_fields == ["compensation_raw"]` with `endpoint_changed` or `normalization_changed` counts as a collector-side change.
  - Confirm #7's benchmark still passes on top of #4 + #8.
  - Run a live trial in the container with scratch output and nothing committed. Report the postings whose hash changes. #8 reports 161 on replayed feeds, including Clipboard's 36, which only `normalization_changed` explains.
- Refresh the stale `BACKLOG.md`/`HANDOFF.md` statements in section 3, and list #5–#9 there.
- #7 (benchmark) is open. Don't extend its labels until D3 is answered; leave it as is for review.
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
- **Detection (E2):** only by `"source":"ashby.compensationTiers"`. A leading `{` is not enough, because Lever `salaryRange` JSON also starts with `{`.
- **Why `additional_information`:** on the 2026-10-26 feeds, 3 of 98 Ashby tiers carry pay facts only there (for example Clipboard "Estimated OTE: 65K-80K USD"). E2 keeps it as a verbatim quote and doesn't parse amounts out of it.
- **Versioning:** board files carry `normalization_version` 2. The first v2 run reports `normalization_changed: true` per source, so rewrites where the URL is unchanged (Clipboard's 36) aren't read as employer edits. On the extraction side, this parser is `EXTRACTOR_VERSION` 3 once merged onto `builder1` (see section 3).
- **Shipping:** #8 ships inside #4 so postings change hash once, in one compensation-only wave (161 on replayed feeds per #8). #9 ships inside #2.
- Any further change to this shape is decided here first. B and C then update together.

## 7. Integration order (recommendation; the owner merges)

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
| D2 | Scheduled collection is not firing: 1 schedule run in about 13 hourly ticks, and data is about 6¾ h old. Options to weigh: re-trigger with `workflow_dispatch` once to confirm, an off-peak cron such as `23 */5 * * *` (backlog P10), or accept best-effort. That cron also saves about 720 free minutes a month. **No change without instruction.** | Owner / GPT Master | Freshness; P10/E9 |
| D3 | Candidate requirements: H fixture labels, E3/E4 gate definitions, and where candidate outputs live (private path, artifact or Sheets only). **Now urgent:** work was built ahead of this decision. #7 (H labels, Worker C) and `8794ca8` on #2 (candidate config and screening gates, Worker B) both exist. The GPT Master should confirm or correct their rules before more is built on them. Neither worker extends them until then. | GPT Master | H, E3–E7; merge of #7 and of #2's E3/E4 part |
| D4 | Approve the held Offline tests run 40340180047 (the bot commit on #1), or ignore it. The code is identical to the passing `ea1935f`. | Owner (Actions UI) | Nothing; cosmetic |
| D5 | Replace the stand-in `pages.json` allowlist with the owner's real problem pages. | Owner / GPT Master | Usefulness of #1 |
| D6 | Where this file lives. It is committed on `build/crawl4ai` (the only branch the Master session may push to), so it rides along in #1. Alternative: a one-file PR to `main`. | Owner | Nothing |
| B-1 | The $0 Actions budget (MIGRATION.md) can't be re-checked from any Claude session. It needs one look at the billing UI before any schedule change. | Owner | D2 |
| B-2 | ChatGPT's authenticated read of this private repo is unproven (`docs/CONSUMER_TEST.md`). | GPT Master | Consumer access verified |

## 9. Handoff log

Append one line per handoff: date, worker, commit or comment link, what changed. Newest last.

- 2026-10-26 Master: created this file; assigned A1, B1, C1; fixed the Ashby `compensation_raw` shape (section 6).
- 2026-10-26 Worker A (on the owner's direct request "implement the Ashby compensation tier fix"): opened farshaikh17/Codex#8 (adapter, stacked on #4) and farshaikh17/Codex#9 (extractor v2, stacked on #2) before this board was read; offered to C and B to adopt or replace. Their shape differs from section 6 in two keys, for evidence-based reasons, for the Master to decide: (1) it keeps `additional_information` per tier, because on the 2026-10-26 feeds 3 of 98 Ashby tiers carry pay facts only there (Clipboard: "Estimated OTE:  65K-80K USD", "Uncapped commissions. Base salary range is $90,000-$110,000.", "Uncapped Commission + Base Salary"); (2) it adds `"source":"ashby.compensationTiers"` and E2 detects the format by that key, because Lever `salaryRange` JSON also starts with `{`, so a leading `{` cannot identify it. #8 also adds `normalization_version`/`normalization_changed` so Clipboard's 36 rewrites (URL unchanged) are not read as employer edits. Verified: 161 compensation-only changes on replayed real feeds, 171/171 components kept, 0 non-verbatim quotes; #7+#8+#9 together 83 tests OK, bench scores unchanged.
- 2026-10-26 14:50 Master (on owner instruction): adopted the #8/#9 shape as section 6. Revised B1 to "adopt #6 and #9" and C1 to "adopt #5 and #8". Recorded #7–#9, `builder1` at `8794ca8`, the `EXTRACTOR_VERSION=2` clash (tier parser becomes 3), and D3's new urgency.
- 2026-10-26 Worker A: A1 done. Contract for `public-page-capture-index-2` in OPERATIONS.md, test-enforced against the committed index (1783532). Field list posted on farshaikh17/Codex#2 (comment 6419553617). `integration/pr1-2-3` rebuilt from all nine open heads (4331322): 132 offline tests, 0 failures; one doc-only conflict between #6 and #9 in ENGINE.md (keep both); stale schema-1/Canonical statements removed from docs/INTEGRATION.md. Handoff comments posted: #5 and #8 to Worker C, #6 to Worker B (#9 handed to B earlier, comment 6419022846). Worker A no longer pushes to #5, #6, #8 or #9. No workflow file changed.
