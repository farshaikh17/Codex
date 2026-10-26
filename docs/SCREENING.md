# Candidate configuration and evidence-based screening (engine steps 3 and 4)

Status: implemented and tested offline. Screening is deterministic and read-only. Decisions are stored by the review queue (step 5, `docs/REVIEW_QUEUE.md`). The engine is **not** proven end to end.

This corresponds to BACKLOG E3+E4, plus the gate-relevant part of H (labelled benchmark cases) from farshaikh17/Codex#3. It builds only on the posting store and extraction (farshaikh17/Codex#2) and adds new files only. `engine/__main__.py`, `engine/store.py` and `docs/ENGINE.md` are untouched, so it doesn't conflict with farshaikh17/Codex#6.

## Where candidate data lives

- **Real profiles never go in this repository.** Keep one JSON file per candidate in a private directory, and point `JOB_ENGINE_CANDIDATES` at it (or pass `--candidates DIR`).
- `engine/candidates.py` refuses any file inside the work tree unless it says `"synthetic": true`. It also refuses an application-history file inside the work tree for a real profile.
- Keep only candidate files, `*.history.json` files and the review database (`docs/REVIEW_QUEUE.md`) in that directory. Any other JSON there is refused as an invalid candidate.
- The only committed candidates are the four synthetic fixtures in `engine/tests/fixtures/candidates/`. A test fails if any committed candidate config is not synthetic.
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
- Currency comes from an explicit code or an unambiguous symbol (₹ € £ zł R$).
- **Bare `$`:** a `$` with no currency code is currency-unknown unless the candidate's own `assume_currency_for_symbol` maps it. Other dollars (`CA$`, `A$`, `HK$`, or a CAD/AUD/… code) are never USD.
  - Gates versions 3–6 read a bare `$` as USD when every listed location was in the United States, attributed to the owner. That attribution was not verified (GPT Master, 2026-10-26), so version 7 removed the behaviour. It remains an open proposal for the owner and the GPT Master, and is not applied.
  - `US$` is left unknown for now: the extractor doesn't yet read "US$x - US$y" as one range, and comparing a broken range could fail a floor wrongly. That's an extractor follow-up (B3).
- **Amounts in millions or billions** ("generates nearly $1B annually") are company figures, never pay, and are not compared. Found on a real Twilio posting, where the `$` rule would otherwise have failed a floor on "$1".
- **Several floors, one per currency (owner rule, gates version 5):** `rules.salary` may be one floor (an object) or a list, at most one floor per currency, for example `[{"minimum": 2500000, "currency": "INR", "period": "year", "basis": "base"}, {"minimum": 60000, "currency": "USD", "period": "year", "basis": "base"}]`.
  - Each stated range is compared only with the floor in its own currency, using that floor's period, basis and `assume_period`. There's no conversion; a range in a currency with no floor stays unknown.
  - When ranges in different currencies disagree (one passes, one fails), salary is unknown.
  - `assume_currency_for_symbol` maps may not contradict each other across floors.
- **Residents-only pay (owner rule, gates version 5):** a pay statement limited to residents of places that don't include the candidate's `eligible_countries` isn't compared, and the limiting phrase is quoted in `notes`. Examples are "residents of the United States only" (GitLab's Greenhouse pay blurbs) and "applies to candidates located in X".
  - A limit naming no recognised place ("residents of listed locations") excludes nothing.
  - A limit that includes the candidate's country doesn't block comparison.
  - Without known eligible countries, a recognised limit can't be confirmed, so that range isn't compared.
  - Measured: no committed real posting is affected today. Its limiting phrases name US states or "those locations", which aren't recognised places. GitLab's blurbs arrive once farshaikh17/Codex#4 requests pay data.
- **Commission-only (owner rule, gates version 4):** an explicit statement that the role has no base pay ("commission-only", "100% commission", "no base salary", "without a base salary") **fails a base floor**. The failing line is quoted verbatim as evidence.
  - A negated statement ("not a commission-only role") doesn't count.
  - Wording about undisclosed pay ("no base salary range is listed", "no base salary information") doesn't count.
  - OTE-only pay doesn't count: it leaves the base unstated, so it stays unknown.
  - A posting that says there is no base but also states a base range at or above the floor is contradictory, and stays unknown.
  - A `total` floor is not failed by this rule.
  - No committed real posting matches today.
- A missing period counts only if the candidate's `assume_period` says so. Every such assumption is written into the evidence.
- Lakh and crore are applied as units.
- **Third-party pay is never compared; employer-published estimates are kept but never decide (gates version 7).** A pay quote that says it is third-party, not provided by the employer, or names a salary site (Glassdoor, Levels.fyi, PayScale, Salary.com, Indeed) can't pass or fail the gate; it's listed in `notes`. A range the employer itself calls an estimate ("The estimated pay ranges for this role are…", "Estimated OTE") is compared and kept as an evidence item with its verbatim quote, `qualifier: employer-published estimate` and `provisional_result`, but on its own the gate stays `unknown`. Only non-estimate ranges decide. Detection reads the quote's wording, not the extractor's `estimated` flag, because that flag also marks "expected" ranges, which are firm employer statements. Final salary qualification stays provisional pending the canonical Sheets comparison (GPT Master decision, 2026-10-26).
  - Measured on main's snapshot (`e812b42`): 60 pay quotes matched the version-2 rule (Twilio 57, Clipboard 3). All 60 are employer-published estimates and are now kept as provisional evidence; none is third-party.
- `basis`:
  - A `base` floor compares base or plain ranges. An OTE range whose top is below the floor also fails, because base is below OTE.
  - A `total` floor compares OTE or plain ranges. A base range at or above the floor passes.
  - Ranges with variable pay and no basis are not compared.

**Relevance** is separate from the verdict. It's a score from title (3 points) and description (1 point) keyword matches, with `routing` = `queue` or `below_relevance_threshold`. It sets priority only, and a test checks that it never changes a verdict.

## Benchmark (`python -m engine.benchmark`)

There are 62 hand-labelled synthetic cases in `engine/tests/screening_cases.py`. Labels were written from the case text before running the code. They cover:
- remote US-only; India explicitly allowed; worldwide with a conflicting country; a negated eligible country; a city-only location
- missing salary; variable-only pay; a range spanning the floor; a range below it; lakh units; OTE below the floor; `$` not assumed for an INR floor; missing period; estimates; the bare-`$` rule (US-only above and below the floor, unstated, mixed and city-only locations, `CA$`, `US$`, an estimate on a US-only posting, company revenue); commission-only (explicit, negated, undisclosed pay, OTE-only, contradicted by a base range); multi-currency floors (INR and USD floors, no floor for EUR, floors disagreeing) and residents-only limits (US-only blurb, India blurb, unrecognised place)
- mandatory years unmet; preferred years unmet; "or equivalent"; a required language missing; reviewer `not_met`
- already applied; same employer and title; employer cooldown
- onsite in an eligible country; conflicting workplace; employment type unstated; empty description; EMEA
- one posting assessed for two candidates
- six regressions found on real postings

The primary metric is **false READY**, reported next to incorrect exclusions, missed exclusions, retained unknowns and gate mismatches.

Current result: 62 cases, false READY 0, incorrect exclusions 0, missed exclusions 0, gate mismatches 0, unknowns retained 47. The `BenchmarkTests` test fails on any false READY, incorrect exclusion or mismatch.

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
