# Bounded market discovery (27 October 2026)

## Audit and scope

Baseline: main da123084495197c21e14680325a2483f02c0a35d, including merged PR #12.
The five-daily UTC cron remains 37 1,6,11,16,21. The latest committed collection
is gh-40463178019-1: 533 listed jobs across ten sources, 514 extraction OK and
31 uncertain across 545 retained posting records. These are health metrics.

PR #12's engine/discovery.py allocates private discovery effort and performs no
network requests. It remains unchanged. This change adopts only discover.py and
its tests from parked PR #10; it does not merge that stacked branch, PR #11,
their workflow changes, their unrelated engine code, or their policies.

## Actual mechanism

1. Keep all ten existing feeds. Add HighLevel (gohighlevel Lever, 107 vacancies in
the trial) and CAI (cagents Lever, 94). Both new sources poll once per 24 hours.
HighLevel's official careers page links jobs.lever.co/gohighlevel (checked 2026-10-27).
CAI's careers index page does not link the board: its "CAI - Lever API" plugin script only
formats text, and its cagents.com mention is an accessibility-statement link. The stronger
evidence is that CAI's own job page https://caiready.com/jobs/csv-engineer/ sends Apply to
jobs.lever.co/cagents/628cda60-6eeb-4ce2-a5e2-45617ec25cbe, that id is in the public cagents
posting API with the same title, cagents.com answers 301 to caiready.com, and feed descriptions
open with "CAI Overview". This shows the board is CAI's; it does not show any posting's
eligibility, pay or currency. The scanner still stops on the careers page's Cloudflare script
marker (conservative; not a challenge we solve), so this evidence was gathered by hand.
No country, qualification or pay eligibility is asserted by onboarding.

2. Scan three public directories: HubSpot's October partner announcement,
Remote In Tech, and NAESCO's accredited-company directory. Read only HTML links.
Take at most 25 provisional employer links from each successful directory and
advance a generic public directory offset. Keep at most 500 leads. Ignore assets,
credentials and non-HTTPS links. Directory links are unverified leads: never
auto-enable sources or follow newly found employer hosts. The public directory
offset is not a candidate research cursor.

3. Rotate through at most four previously reviewed employer seeds: engineering
consultancies, an ESCO, implementation agencies and CRM employers. Prefer
never-checked/stalest targets, use observed title-signal yield only to break ties,
and cool down attempted targets/directories for 24 hours. Human review promotes
a directory lead into this target allowlist after ownership and access review.
This promotion gate is deliberate; the system does not search the open web or
automatically invent employers/ATS slugs.

4. Reuse the PR #10 scanner to inspect at most two career pages per employer,
one link level deep. Detect supported ATS links and verify their feed schema.
Record unsupported systems and access failures instead of treating them as empty
markets. Proposals do not edit sources.json. Follow SOURCE_ONBOARDING.md and
review a PR before enabling a source.

5. Read existing board snapshots and deduplicate employer/requisition identities
before selecting a shared bounded review batch (60 maximum, three per employer).
Tag broad responsibility families; prefer concrete implementation, onboarding,
commissioning, maintenance and reliability titles over broad specialist titles.
Title signals are imperfect triage, not verified suitability. All records keep
locations, original timestamps and provenance. Never interpret remote/APAC as
India eligibility. The full legacy posting export remains available; this small
batch does not delete or assess omitted jobs.

## Operational boundaries and exports

market_discovery.py is stdlib-only. The repository's MIT license applies to this
code; the reused scanner is from the same repository. No new packages or services.
Remote In Tech identifies its directory repository as ISC-licensed; this code
reads its public site as evidence and does not install or vendor it.

The existing collection workflow adds a discovery step without changing cron.
It makes at most 40 actual discovery GETs, refuses redirects, starts no request
after its 180-second deadline, uses at most a 10-second socket timeout plus a
whole-body read limit (at most 30 s), bounds HTML responses at 2 MB and feed
validation at 10 MB, and performs no retries. Successive requests to one host
wait at least 1 s or the host's robots Crawl-delay; a host asking for more than
15 s is skipped. DNS resolution is outside these limits; the existing job timeout
is the outer bound. A 429 or exhausted budget stops the invocation: everything
not yet requested is reported under `deferred` as not attempted and keeps its
previous state (no failure, no cooldown). Failed targets are cooled down for 24 h.
Existing scheduled feed requests remain separately bounded by the registry and
the existing 25-second timeout/25 MB feed cap; this does not adopt PR #11's
collector budgets.

Robots rules are checked per URL path; rules are cached by origin. Nonpublic
addresses and credentialed URLs are rejected by the new transport. No browser,
stealth, proxy, LLM, paid search, CAPTCHA submission or application actions.

public/discovery/report.json is additive and separates four things:
`employer_leads` (provisional links, one per host, with discovered_from and
first/last seen; never sources or ownership claims), `vacancies` (compact exact
vacancy cards: identity, title, location text, URLs, published/observed times,
provenance and the source's latest real status/checked_at), each card's
`responsibility_signals` (public title keywords only), and `eligibility`, which is
always "not_assessed": eligibility is decided only in the private ChatGPT/Sheet
review. Cards from a failed source are labelled last_known_good_after_failure;
deferred targets/directories are listed with their reason and are never reported
fresh. Software "site reliability" and "sales commission" titles are not counted
as asset/commissioning signals. public/discovery/state.json contains only public
source observations/cooldowns. It is not a candidate queue. Existing
public/postings schema/hash contract and private planner are unchanged.
Discovery files are not in the status.json manifest; discovery failure does not
prevent ordinary snapshot publication. Check report generated_at, errors and
deferred; a green collection alone does not establish fresh discovery.

The engine's per-source freshness now judges a source with poll_interval_hours
against its own interval plus six hours (one run gap), so HighLevel and CAI are
not reported stale between their daily polls; a missed daily poll is still stale.

## Live evidence and limits

A scratch-only bounded trial made 16 discovery GETs. It normalized 201 exact
vacancies from the two new feeds, 58 with broad title signals; selected six
unreviewed cards across two employers. Those six demonstrate a diversity cap,
not six eligible jobs. The trial found 40 provisional partner links, including
AutomationCo and CRM Assist; later asset filtering removes non-employer images.
A separate two-GET robots-aware Remote In Tech check successfully extracted a
bounded 200-link sample before the rolling 25-per-directory selection was added;
examples include 10up, 90 Seconds and A1 Auto Transport. No link proves hiring,
India engagement, salary, sponsorship or qualification.

NAESCO returned 403: no ESCO directory leads are claimed from that request.
AFRY and Assystem pages loaded; Assystem exposed unsupported SmartRecruiters.
BluLeadz exposed an exact CRM-integration-engineer page URL, but its detail
request timed out; no full JD/qualification was claimed. The CAI scanner stopped
on its conservative Cloudflare-script marker. These limitations remain visible.

The live trial preceded final registry onboarding and the final directory
rotation/filter changes. Those changes have offline tests; their scheduled
execution must still be checked after merge. Native ChatGPT web discovery can
supplement inaccessible directories and submit reviewed public employer seeds.
GitHub Actions cannot invoke ChatGPT native search. No complete market coverage,
candidate counts or READY yield is promised.

### Independent review re-run (27 October 2026, scratch copy of main's public/)

After the review fixes, one scratch invocation made 17 GETs in 30 s. NAESCO and the
HubSpot community page both returned 403 (recorded as errors, cooled down 24 h; no
leads claimed). Remote In Tech gave 25 provisional host links. AFRY, Assystem and
BluLeadz pages were read; Assystem links SmartRecruiters; no supported board was
found. CAI's careers page stopped on its script marker. HighLevel, iMarc, Smart Joules
and WebFX were deferred by the four-target rotation (no request). The batch held 16
cards from 8 employers (largest share 0.19) drawn from the ten existing feeds; HighLevel
and CAI cards appear only after their first collection. These are title signals, not
relevance or eligibility.

SmartRecruiters: api.smartrecruiters.com/robots.txt allows only LinkedInBot and
disallows every other agent, so its Posting API is not adopted for Assystem or any
employer; the scanner records it as unsupported. AFRY's static jobs page names no ATS.

## Deployment / acceptance

Merge this PR after CI. The sources.json change triggers the existing main-only
collection; do not dispatch a duplicate run. Verify 12 sources in registry,
new source board files, publication consistency, posting export hashes, and
discovery generated_at/errors. Then watch one scheduled invocation and a later
due discovery rotation. GitHub Actions minutes are consumed; no paid service is
introduced and this PR does not change billing controls.

Candidate strategy allocations (70/20/10 and 50/30/20) remain in the private
ChatGPT/Sheet workflow, not shared source configuration. Actual candidate-relevant
yield must be measured there and returned as aggregated source-quality feedback.
The code currently learns only public title-signal yield, freshness and failures;
it does not claim a private relevance feedback integration.

Offline validation after review fixes: see the PR description for the full-suite
count; targeted scanner/market/registry tests pass. Ubuntu PR CI additionally runs the full existing
suite/export tests; local Windows cannot import the existing fcntl collector.
No real profiles, private cursors, applications, replacement ledgers, Sheet
writes or automated READY decisions are introduced.

