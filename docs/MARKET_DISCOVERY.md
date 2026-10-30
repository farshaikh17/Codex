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


## Coverage extension (stacked on PR #13)

### Newly verified official feeds (24-hour polling)

Each board was found by probing official ATS APIs for relevant employers and then
confirmed against the employer's own careers page (2026-10-27). No eligibility, pay or
currency is asserted.

| Source | Sector fit | Ownership evidence | Trial vacancies |
|---|---|---|---|
| cognite-greenhouse | Industrial data for energy, utilities, manufacturing (Bengaluru hiring) | cognite.com/en/company/careers links job id 4867423101, present in the boards-api `cognite` feed | 52 |
| energyhub-greenhouse | Utility DER / demand-response platform | energyhub.com/careers links job ids such as 8586008002, present in the feed | 13 |
| voltus-lever | Distributed energy / demand-response market operator | voltus.co/jobs links jobs.lever.co/voltus/<id>/apply (repository scanner) | 16 |
| celigo-greenhouse | Integration / business-process automation (Hyderabad office) | celigo.com/careers embeds the Greenhouse `celigo` board (repository scanner) | 22 |

Probed but not added: Budderfly (careers page uses Rippling, unsupported), Augury,
Arcadia, Tulip and Workato (boards exist but their careers pages do not link them in
static HTML, so ownership is not shown), Aptitude 8 (verified HubSpot partner board, but
its only posting is a contractor talent community, not a vacancy). Cognite's page links
the EU Greenhouse host; the same job ids are served by the supported US API.

### Directory lead validation

Each invocation now scans up to two provisional directory leads (never-validated
first, otherwise the stalest past a seven-day recheck) with the same bounded scanner,
inside the same 40-GET / 180-second budget and only after allowlisted targets. Results
stay on the lead: `supported_board_found`, `board_found_unverified` (detected but the
feed could not be checked, e.g. Ashby's API robots.txt answers 401), `unsupported_ats`,
`no_board_found` or `blocked_or_failed`, with evidence. A lead never becomes a source,
its ownership stays `unverified`, and vacancies from lead boards never enter review cards.

### Review cards

Same-title requisitions at one employer now share one card, listing the other
locations under `same_title_elsewhere`, so a single employer cannot spend several of
its three slots on one role. Title signals now also recognise demand response,
battery and grid wording, and HubSpot/Salesforce administration.

### SmartRecruiters, other directories

Not adopted. api.smartrecruiters.com/robots.txt disallows every agent except
LinkedInBot, so Assystem's SmartRecruiters jobs are recorded as unsupported. AFRY's
static jobs page names no ATS. The HubSpot community page and NAESCO both answered 403
on 27 October 2026; Make's partner directory answered 403; Zapier's and n8n's partner
directories link only same-host profile pages, so they give no employer hosts without
a second hop, which is not implemented.

### Bounded live trial (scratch copy, 27 October 2026)

- Collector, the six new sources only (`--ids`): six feed GETs, 302 exact vacancies
  (HighLevel 105, CAI 94, Cognite 52, Celigo 22, Voltus 16, EnergyHub 13);
  `collect.py --verify` reports the publication consistent. Posting export (ingest,
  extract, outputs, verify) over the 16 sources: 835 records, no problems.
- Discovery, first invocation: 23 GETs. Second invocation: 8 GETs (directories and
  four targets on cooldown, listed as deferred). The batch held 25 cards from
  11 employers (largest share 0.12), including CAI electrical-commissioning roles,
  Celigo's Hyderabad AI integration engineer, Voltus's Salesforce administrator and
  EnergyHub's energy data scientist. Four Remote In Tech leads were validated:
  10up, 37signals (no board), 1password (Ashby board detected, unverifiable), 3blocks
  (blocked). These are public title signals, not candidate relevance or eligibility.

The candidate-relevant yield of these sources can only be measured in the private
ChatGPT/Sheet review and returned as aggregate source-quality feedback; no such
feedback is integrated in the repository.

## Discovery expansion (role search, career pages, profile traversal) — 27 October 2026

The configured-employer collector refreshes known boards well but cannot find employers it does not know.
This change adds routes that start from roles and locations, follow directory profiles to employer sites,
and read official career pages beyond Greenhouse/Lever/Ashby. Everything runs inside the existing
`market_discovery.py` step, the same 40-GET / 180-second budget, robots checks, refused redirects and
per-host spacing. No new dependency (stdlib only), no paid service, no candidate data.

### Pipeline per invocation (in budget order)

1. **Directories** (stalest three per run): direct employer links as before, plus bounded
   directory → profile → employer website traversal (`profile_pattern`, at most three profiles per
   directory per run, rotating offset). The website is the most-linked external host on the profile,
   excluding the directory, CDNs, social, booking and code-hosting hosts; candidates are recorded.
   Added: Zapier's partner directory (automation/CRM implementation agencies).
2. **Role-and-location search** (`role_search.py`, Himalayas Jobs API): three queries per run — the two
   stalest plus the due query with the best public strong-signal rate — each once per 24 h. Ten generic
   queries (HubSpot, GoHighLevel, CRM implementation, Salesforce administrator, automation, business
   systems, AI implementation, energy, electrical engineer, reliability engineer; India filter where the API
   supports it). One page (≤20 results) per query. Listings are `aggregator_listing_provisional`, keep the
   Himalayas applicationLink as the apply action and attribution (API terms), and are matched to configured
   employers only as title evidence (`official_evidence`), never as proof.
3. **Official career feeds** (`career_pages.py`): ownership-reviewed employers only (`career_feeds`, each with
   evidence). Formats: career-site RSS (Avature) and schema.org JobPosting JSON-LD pages, with optional
   same-host detail pages. Detail pages already extracted and still listed are reused from a cache; at most
   three new detail pages per feed per run. Added: Siemens Energy and Siemens India keyword feeds.
4. **Allowlisted employer seeds** and 5. **lead validation** as before; pages they read are also searched for
   JobPosting JSON-LD (records stay provisional: ownership not reviewed). Profile-derived leads are validated
   before bare directory links.

Failures back off 1, 2, 4 … 14 days; a success resets to 24 h. A halted budget leaves everything
unrequested untouched and listed as `deferred`. A channel not requested this run contributes its last
records, labelled `cached_from_last_check` / `cached_after_failure` with their real check time; it is never
reported fresh.

### Records and outputs (public/discovery/report.json)

- `vacancies`: **exact** cards — configured feeds, reviewed feeds and career-feed records with an employer
  identifier, title, official URL and reviewed ownership. At most three per employer, 60 total.
- `provisional_cards`: aggregator listings and career-page records missing an identifier, location or
  reviewed ownership. At most two per employer, 40 total. Every record lists `extraction.uncertainty`.
- `employer_leads`: provisional links with `discovered_via` (directory_link / directory_profile),
  profile URL, website candidates and validation result. Never sources.
- Each card: `responsibility_signals` (generic families), `signal_strength` (strong / weak / excluded),
  `signal_notes`, `geographic_evidence` (`india_explicit` names India or an Indian city; `remote_or_region_only`
  is APAC/worldwide/remote wording and is never India eligibility), `freshness`, provenance, salary with
  provenance, `eligibility: not_assessed`. Sales/marketing and support-first titles are counted but not
  carded; specialist software, test automation and named-language titles are `weak` even when they contain
  battery, integration, automation or reliability.
- Same-title requisitions share a card; every identity (`key`, `req_id`, URL, provenance, locations) stays
  listed under `same_title_elsewhere`. Different requisitions are never merged into one identity.
- Rotation: cards shown least often come first and employers least recently shown lead each round, so the
  first batch does not hide unseen vacancies (state `_shown`, public exposure counts only).

### Measurements (`metrics`)

Exact vs provisional vs cached identities; new identities since the last run vs repeated; strong signals by
family; geography classes; counts by discovery method; extraction uncertainty reasons; sources
(enabled, ownership-reviewed career feeds, provisional links by route, leads with a supported board,
scanner-verified proposals); per-query results / strong / India-explicit / failures; and cost: requests and
seconds per method. **No candidate relevance feedback is integrated**; the only rotation signal is the
public strong-title rate per query. `state.json` is written compact (≈200 kB in trials). The first production run after deployment has no `_seen` history, so all identities count as new once (baseline).

### Channels evaluated and not adopted

| Channel | Finding (27 Oct 2026) | Decision |
|---|---|---|
| speedyapply/JobSpy (MIT; pandas, pydantic, curl_cffi, bs4, markdownify) | Naukri adapter calls the private `/jobapi/v3/search` with spoofed `appid`/`systemid` headers and an RSA-signed `nkparam` token; all sessions use curl_cffi Chrome TLS impersonation and support proxy rotation. Bayt serves a Cloudflare managed challenge even for robots.txt (403). LinkedIn/Indeed/Glassdoor/ZipRecruiter/Google terms prohibit scraping. | Not adopted; no trial run, because every channel would rely on impersonation or a reverse-engineered private API. |
| Naukri public search pages | robots.txt does not disallow `/jobapi` for `*`, but the search page is a 38 kB script shell with no JobPosting data; the data path needs the forged headers above. | Not adopted. |
| Remotive API | robots.txt disallows `/*search=`. | Not adopted. |
| RemoteOK API | robots.txt `Disallow: /`. | Not adopted. |
| Jobicy API | Permitted for research tools with attribution, but the tag filter was not applied (unrelated results) and `geo=india` is rejected (400). | Not adopted; revisit if filters work. |
| Himalayas company profiles | 403 for HTML profiles; only the jobs API is open. | Profile traversal uses Zapier's directory instead. |
| SmartRecruiters | robots.txt still disallows all but LinkedInBot (unchanged). | Still rejected. |
| scrapinghub/extruct | JSON-LD + RSS needs ~150 stdlib lines; extruct 0.18.0 adds lxml, lxml-html-clean, rdflib, pyrdfa3, mf2py, w3lib, html-text and jstyleson. | Not adopted. |

Probed official boards: Avathon (Greenhouse, 53 jobs, 17 Bengaluru) added with board-owner URL evidence;
Fervo Energy (66, Houston) and Antora (38, California) have boards but their careers pages do not show
ownership statically, so they are not added.

### Bounded live trial (scratch copy of main's public/, fresh discovery state, 27 Oct 2026)

- Collector `--ids avathon-greenhouse`: 1 feed GET, 53 vacancies; publication consistent.
- Run 1: 31 GETs, 35 s (directories 6, role search 4, career feeds 4, employer seeds 11, lead validation 6).
  926 exact identities (886 configured feeds + 40 Siemens/Siemens Energy RSS), 61 provisional
  (60 Himalayas, 1 scanned-page JSON-LD), 78 cards. NAESCO and HubSpot 403 (backed off).
- Run 2 (cooldowns active): 18 GETs, 24 s; 56 new identities, 986 repeated, 100 cached; 38 of 78 cards
  had never been shown.
- Per-query public yield (results / strong / India-explicit): CRM implementation 20/15/15, electrical
  engineer 20/11/14, AI implementation 20/9/11, business systems 20/9/13, automation 20/4/13, energy 20/1/8.
- Zapier profiles produced three agency websites (flowmondo, codexsolutionsint, minorco) as provisional
  leads; lead validation found no supported board on the first four Remote In Tech links.
- Examples with India named in the location wording and a strong title signal (still unassessed):
  exact — Siemens Energy "Commissioning Engineer for HVDC - Converter Control", CAI "Lead Commissioning (Cx)
  Engineer - Electrical", Cognite "NetSuite Systems Analyst" (Bengaluru), Celigo "AI Integration Engineer"
  (Hyderabad); provisional — "Business Systems & Implementation Manager (Remote - India)", "Zoho Automation
  Specialist", "Electrical Team Leader" (Clean Energy Associates), "Senior Consultant - Energy" (Kline).

Coverage stays partial: Himalayas is a remote-work board, so on-site Indian utility/ESCO/plant roles come
mainly from the Siemens feeds, CAI and Avathon; Workday/SuccessFactors/iCIMS employers remain unreadable
without their own permitted feeds.

### Path into the private review

GitHub publishes only public evidence. The private ChatGPT review tasks read
`public/discovery/report.json` (authenticated private-repository access) after checking `generated_at`,
`errors` and `deferred`, and then:

1. Review `vacancies` first (exact identity; open `url`), then `provisional_cards`. For a provisional card,
   find the employer's own requisition before treating it as a vacancy; apply links for Himalayas listings
   must stay the Himalayas `apply_url`.
2. Apply private eligibility and candidate rules in the existing review, never from `signal_strength` or
   `geographic_evidence`; `remote_or_region_only` is not India eligibility, and a missing listing is not a
   closure.
3. Save decisions only to the original Sheets. Nothing in this repository is READY.
4. Optional, not yet integrated: an aggregate, non-identifying count per source/query of how many reviewed
   cards were judged relevant, for future rotation weighting. Candidate names, profiles, decisions, cursors
   and application history must never be returned.
