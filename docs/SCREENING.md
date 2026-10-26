# Candidate configuration and evidence-based screening (engine steps 3 and 4)

Status: implemented and tested offline. Screening is deterministic and read-only. Decisions are stored by the review queue (step 5, `docs/REVIEW_QUEUE.md`). The engine is **not** proven end to end.

This corresponds to BACKLOG E3+E4, plus the gate-relevant part of H (labelled benchmark cases) from farshaikh17/Codex#3. It builds only on the posting store and extraction (farshaikh17/Codex#2) and adds new files only. `engine/__main__.py`, `engine/store.py` and `docs/ENGINE.md` are untouched, so it doesn't conflict with farshaikh17/Codex#6.

## Where candidate data lives

- **Real profiles never go in this repository.** Keep one JSON file per candidate in a private directory, and point `JOB_ENGINE_CANDIDATES` at it (or pass `--candidates DIR`).
- `engine/candidates.py` refuses any file inside the work tree unless it says `"synthetic": true`. It also refuses an application-history file inside the work tree for a real profile.
- Keep only candidate files, `*.history.json` files and the review database (`docs/REVIEW_QUEUE.md`) in that directory. Any other JSON there is refused as an invalid candidate.
- The only committed candidates are the two synthetic fixtures in `engine/tests/fixtures/candidates/`. A test fails if any committed candidate config is not synthetic.
- Screening output contains candidate facts (history entries, salary floor, eligible countries). `python -m engine.screen` prints it and writes nothing. Where stored candidate outputs live is an owner decision before step 6; they must never go under `public/`.

## Configuration (`candidate-config-1`)

```json
{
  "schema": "candidate-config-1",
  "candidate_id": "lowercase-id",
  "synthetic": false,
  "profile_version": "bump when any profile fact changes",
  "rules_version": "bump when any rule changes",
  "profile": {
    "eligible_countries": ["IN"],
    "experience_years": 7,
    "languages": ["English"],
    "application_history_file": "lowercase-id.history.json"
  },
  "rules": {
    "required_gates": ["geography", "engagement", "qualifications", "salary", "application_history"],
    "relevance": {"title_keywords": [], "description_keywords": [], "minimum_score": 3},
    "engagement": {"workplace": ["remote"], "employment_types": ["full_time", "contract"]},
    "salary": {"minimum": 2500000, "currency": "INR", "period": "year", "basis": "base",
               "assume_period": null, "assume_currency_for_symbol": null},
    "application_history": {"employer_cooldown_days": 90}
  }
}
```

**Profile vs rules.**
- `profile` holds facts: where the person may live and work (ISO country codes), total years of experience, languages, and application history. History entries have the keys `posting_id`, `url`, `employer`, `title`, `status` (applied, interviewing, offer, rejected or withdrawn) and `date`. History goes either inline or in a separate private file.
- `rules` holds the person's own choices. No threshold lives in shared code; a test checks that shared modules name no candidate and contain no fixture threshold.

**Missing is not empty.**
- An absent fact or rule makes its gate `unknown`. Nothing is assumed or borrowed from another candidate.
- An empty `application_history: []` is a statement ("no earlier applications") and can pass.
- `required_gates` defaults to all five. A gate left out is still reported but doesn't block.

**Strict keys.** Unknown keys, unknown countries, workplaces, employment types or gate names, and malformed values are refused, so a typo can't silently switch a gate off.

## Gates

Each gate returns `pass`, `fail` or `unknown`, with a `reason`, `evidence` and the `candidate_basis` it used.
- `pass` and `fail` cannot be produced without evidence. The code raises an error if they are.
- Evidence items are verbatim posting quotes, with `source_url`, `retrieved_at` and the extraction `method`, or a named candidate rule.

**Verdict:**
- `excluded`: any required gate fails.
- `conditional`: nothing fails, but some required gate is unknown.
- `ready`: every required gate passes.

`blocking` lists the required gates that didn't pass.

| Gate | Passes when | Fails when | Stays unknown when |
|---|---|---|---|
| geography | A listed location, a location section or a clause stating where the person must be names an eligible country, a region containing one (EU, EMEA, APAC, LATAM, …) or worldwide | Every place named is outside the eligible countries | No recognised place (city-only such as "Pune"); statements disagree ("Remote, Worldwide" plus "must be based in the United States"); a negated clause mentions an eligible country ("unable to hire candidates located in India") |
| engagement | Every stated workplace and employment type is accepted, or the rule accepts any | A stated value isn't accepted (for example, onsite for remote-only) | Not stated, or conflicting (location "Remote" but feed field "OnSite") |
| qualifications | **Only through review:** every mandatory requirement line has a reviewer decision `met` (with profile evidence) or `not_a_requirement` | A mechanical shortfall (required years above `experience_years`; a required language not in `languages`), or a reviewer decides `not_met` with profile evidence | Any line still awaits review; no requirements section extracted |
| salary | Every comparable range starts at or above the floor | Every comparable range ends below it | Pay not stated; no amount; currency or period not comparable; the range spans the floor |
| application_history | No posting, URL or employer-cooldown match | Exact posting or URL already in history; rejected by the same employer within `employer_cooldown_days` | History not provided; same employer and same title (possibly a reopened requisition) |

**Qualifications.**
- Keyword overlap is relevance, never proof. Mandatory requirements are split into lines, each with a stable id (a hash of its normalised text). Review decisions are keyed by that id, so they survive content changes elsewhere in the posting.
- Shortfall rules are deliberately narrow. Lines saying "or equivalent", "preferred", "a plus" or "advantage" never fail mechanically.
- "8+ years in X or 10+ years in Y" uses the lower bar. "8 years, with at least 6 in Y" uses the higher one.
- Total years are an upper bound on domain years, so a total below the requirement is a safe failure. Meeting it proves nothing, and the line still goes to review.

**Salary.**
- Never converted between currencies, never annualised. Pay quoted per month or per hour doesn't count against an annual floor.
- Currency comes from an explicit code or an unambiguous symbol (₹ € £ zł R$). A bare `$` counts only if the candidate's own `assume_currency_for_symbol` maps it.
- A missing period counts only if the candidate's `assume_period` says so. Every such assumption is written into the evidence.
- Lakh and crore are applied as units.
- `basis`:
  - A `base` floor compares base or plain ranges. An OTE range whose top is below the floor also fails, because base is below OTE.
  - A `total` floor compares OTE or plain ranges. A base range at or above the floor passes.
  - Ranges with variable pay and no basis are not compared.

**Relevance** is separate from the verdict. It's a score from title (3 points) and description (1 point) keyword matches, with `routing` = `queue` or `below_relevance_threshold`. It sets priority only, and a test checks that it never changes a verdict.

## Benchmark (`python -m engine.benchmark`)

There are 37 hand-labelled synthetic cases in `engine/tests/screening_cases.py`. Labels were written from the case text before running the code. They cover:
- remote US-only; India explicitly allowed; worldwide with a conflicting country; a negated eligible country; a city-only location
- missing salary; variable-only pay; a range spanning the floor; a range below it; lakh units; OTE below the floor; `$` not assumed; missing period
- mandatory years unmet; preferred years unmet; "or equivalent"; a required language missing; reviewer `not_met`
- already applied; same employer and title; employer cooldown
- onsite in an eligible country; conflicting workplace; employment type unstated; empty description; EMEA
- one posting assessed for two candidates
- six regressions found on real postings

The primary metric is **false READY**, reported next to incorrect exclusions, missed exclusions, retained unknowns and gate mismatches.

Current result: 37 cases, false READY 0, incorrect exclusions 0, missed exclusions 0, gate mismatches 0, unknowns retained 25. The `BenchmarkTests` test fails on any false READY, incorrect exclusion or mismatch.

The queue-related H cases are handled in step 5 (`docs/REVIEW_QUEUE.md`): interruption recovery and identical reposts. Reopened requisitions are partly covered by the application-history gate. An expired page returning HTTP 200 and a failed retrieval after success are store and collector concerns (availability states), not queue rules.

## Measured on the committed snapshot (532 open postings, unreviewed)

| | synthetic-impl-in (India, remote only, INR floor) | synthetic-design-eu (DE/NL, remote or hybrid, EUR floor) |
|---|---|---|
| Verdicts | 450 excluded, 82 conditional, 0 ready | 473 excluded, 59 conditional, 0 ready |
| Geography | 439 fail, 85 pass, 8 unknown | 466 fail, 56 pass, 10 unknown |
| Automatic qualification shortfalls | 51 postings (years or language) | 113 postings |
| Routing | 29 queue, 503 below relevance threshold | 532 queue (no minimum score) |

- Every automatic shortfall was read by hand for the India candidate. All were explicit: "Fluent French language skills (required)", "Minimum of 8 years …", "10+ years …".
- The geography passes were sampled by hand: India, Bangalore, APAC, explicit "Global".
- That review found and fixed:
  - "is a distinct advantage" being treated as required
  - "or" alternatives taking the higher bar
  - a negation in an unrelated sentence blocking a pass
  - "This role is based in X" not being captured by extraction

  These are now benchmark regressions. Extraction moved to `EXTRACTOR_VERSION` 2, so the store re-extracts automatically.
- Employment type is unstated in most postings. A candidate whose rule lists specific types therefore gets `engagement: unknown` almost everywhere. That's correct, not a bug; `employment_types: null` accepts any.

## Known limits

- City names aren't recognised (they stay unknown). Region membership is a fixed table, and "Middle East" and "EMEA" boundaries are conventions. Parentheses that narrow a region ("key APAC locations (Australia or Japan)") produce a disagreement, so the gate stays unknown rather than failing.
- Time-zone requirements are kept as evidence but not judged.
- Work authorisation is modelled only as `eligible_countries`; sponsorship wording isn't interpreted.
- Language and year rules use English wording only.
- Ashby compensation tiers (currency, interval, component type) are lost by the collector adapter. The fix proposed in `docs/INTEGRATION.md` needs an adapter change plus an extractor branch, so Ashby pay mostly stays unknown for salary gates.
- Screening itself persists nothing. The review queue (step 5) stores items, review decisions, leases and the separate counts.
