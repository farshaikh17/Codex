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
HighLevel's official careers Explore Our Jobs link points to Lever. CAI's
official careers page uses its own CAI Lever plugin and identifies legacy
cagents.com; the cagents feed is CAI-branded. This is manually corroborated
ownership evidence, not a generic name match or a newly inferred directory link.
The CAI page scanner conservatively flags a Cloudflare script; its independently
accessible official API can be collected without solving or bypassing a challenge.
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
after its 180-second deadline, uses at most a 10-second request timeout, bounds
HTML responses at 2 MB and feed validation at 10 MB, and performs no retries.
The deadline is a request-start limit; an in-flight request/OS DNS can finish
later. The existing job timeout is the outer bound. A 429 stops the discovery
invocation. Failed targets are cooled down. Existing scheduled feed requests
remain separately bounded by the 12-entry registry and existing 25-second
timeout/25 MB feed cap; this does not adopt PR #11's collector budgets.

Robots rules are checked per URL path; rules are cached by origin. Nonpublic
addresses and credentialed URLs are rejected by the new transport. No browser,
stealth, proxy, LLM, paid search, CAPTCHA submission or application actions.

public/discovery/report.json is additive: generic employer leads, source
proposals, errors, exact unreviewed vacancy evidence and metrics.
public/discovery/state.json contains only public source observations/cooldowns.
It is not a candidate queue. Existing public/postings schema/hash contract and
private candidate planner are unchanged. Discovery failure does not prevent
ordinary snapshot publication. Check report generated_at and errors; a green
collection alone does not establish fresh discovery.

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

Offline targeted validation: 48 tests passed (scanner, new market module,
private planner and registry). Ubuntu PR CI additionally runs the full existing
suite/export tests; local Windows cannot import the existing fcntl collector.
No real profiles, private cursors, applications, replacement ledgers, Sheet
writes or automated READY decisions are introduced.

