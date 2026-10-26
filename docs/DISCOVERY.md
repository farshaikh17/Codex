# Bounded source discovery (backlog B)

`discover.py` finds official Greenhouse, Lever and Ashby boards linked from employer careers pages, and writes **proposals for review**. It is run by hand, separately from scheduled collection, and never edits `sources.json` or `employers.json`.

```
python discover.py                                   # every target in discovery_targets.json
python discover.py --employer doist,toggl            # selected targets
python discover.py --max-pages 3 --max-requests 20 --no-sitemaps --out discovery/proposals.json
```

## Bounds

| Bound | Default | Hard cap |
|---|---|---|
| Pages per target (start page, sitemap and followed links) | 5 | 20 |
| Link depth from the start page | 1 | 1 |
| Requests per run (robots.txt, pages, sitemap, feed checks) | 15 | 40 |
| Response size | 2 MB | |
| Timeout per request | 15 s | |
| Pause after each target | 2 s | |
| Redirects | 3, and only within the target's allowed hosts. After a redirect to another allowed host, that host's robots.txt is checked too, and a disallowed page is discarded. A redirect target counts as visited | |

- **Scope:** only `https` links on the target's `allowed_hosts` (default: the start URL's host) are followed. Links on other hosts are scanned for board URLs and recorded, never fetched.
- **What is followed:** only `<a href>` links whose path looks like a jobs page and isn't a static asset. Scripts, iframes, forms and stylesheets are scanned for board URLs only.
- **Sitemaps:** at most one sitemap, the first one robots.txt lists on an allowed host. It is read once (no index recursion), and only jobs-like URLs on allowed hosts are queued, within the page budget.
- **robots.txt:** checked before any page, with the same policy as PR #1's `crawl_pages.robots_rules`. 4xx means no rules. 5xx, unreachable, 401/403 or an off-scope redirect means disallow everything. A 429 halts the run.
- **Stops:** 401/403/451, CAPTCHA, login or denial pages stop that host. A 429 anywhere halts the whole run, with no retries. When the request budget runs out, the run halts and the unvisited targets are reported as stopped.

## What a run reports (`source-discovery-1`)

Per target:
- `pages`: each page with how it was reached and its result (`read`, `blocked`, `failed`).
- `boards`: up to 3 pieces of evidence per board, each giving the page, how the URL was found (`a`, `iframe`, `script`, `json-ld`) and the URL itself.
- `unsupported_ats`: Workday, SmartRecruiters, Workable and others, plus the Greenhouse and Lever EU hosts. Recorded only.
- `careers_url_proposal`: see below.

Each board gets one status:

| Status | Meaning |
|---|---|
| `already_configured` | The provider and board match a source in `sources.json`. No request is spent re-checking it. |
| `verified_feed` | The official feed answered through `collect.fetch` (pinned host, no redirects, 25 MB cap). The entry carries `feed_jobs`, a `proposed_source` snippet, `registry_problems` from a dry-run `registry.validate` with the snippet added (empty means it would validate), and `employer_entry_needed`. |
| `feed_failed` | The page links to a board, but its feed didn't answer. The error is reported and nothing is proposed. |
| `not_verified` | The run halted before the feed could be checked. |

**`careers_url_proposal`:** when a page links to a board that is already configured for the same employer, and that employer has no `careers_url`, the run proposes that page as `careers_url`. The evidence is `{url, checked_at, quote}`, where the quote is the board link. The proposal is applied only if a person reviews it and copies it into `employers.json` as `careers_url` plus `careers_url_evidence`. `registry.py` rejects a `careers_url` without evidence. Applied so far (owner-approved 2026-10-26): Oyster, Zapier, Weave, Clipboard.

## Adding a discovered source

1. Read the proposal. Open the evidence page yourself and confirm it is the employer's own site.
2. Add the employer to `employers.json` if `employer_entry_needed` is true, with a real `inclusion.reason`.
3. Paste `proposed_source` into `sources.json`. Run `python registry.py`, and trial it with `python collect.py --ids <id>`.
4. Open a PR. Recurring collection starts only after the PR merges.

## Targets (`discovery_targets.json`)

- The ten configured employers: start URLs marked `operator_guess`. They are unverified until a run finds the configured board linked from the page.
- The six PR #1 page-capture employers: the URLs PR #1's allowlist already opens. Discovery checks whether any of them has an official feed, in which case the feed should replace browser capture.

## Live trial (2026-10-26, this container, 40 requests across 16 targets, nothing committed)

| Target | Result |
|---|---|
| Oyster, Zapier, Weave | Page links to the configured Ashby board → `careers_url` proposed with evidence |
| GitLab, Remote, PostHog, Automattic, Doist, Atlassian, Canonical | Pages read, no supported board link in the static HTML (likely added by JavaScript, or no Greenhouse/Lever/Ashby board). Nothing proposed |
| Toggl | Page embeds `https://jobs.ashbyhq.com/toggl/embed`, but the Ashby posting API returns 404 for `toggl` → `feed_failed`, nothing proposed |
| Salesforce | Workday, recorded as an unsupported ATS |
| Clipboard, Resilinc, Twilio (first run) | Redirect to another domain (clipboard.com, resilinc.ai, jobs.twilio.com) → blocked by scope |
| Clipboard (after the scope was widened) | clipboardhealth.com answers path-preserving 301s to clipboard.com, and the page names "Clipboard Health". It links to the configured Ashby board → `careers_url` proposed and applied |
| Resilinc (after the scope was widened) | resilinc.com → resilinc.ai → careers.resilinc.com → careers.resilinc.ai, all 301s from the established domain, on a page naming Resilinc 23 times. The careers and openings pages have no Lever link in static HTML → nothing proposed |
| Twilio (after the scope was widened; owner approved jobs.twilio.com) | jobs.twilio.com/careers is a JavaScript app with no Greenhouse reference in static HTML → nothing proposed |
| Drivetrain | robots.txt answered 429 → the run halted with no retry. The three targets after it were run separately, later |

Widening a target's `allowed_hosts` needs a recorded basis in the target's `allowed_hosts_basis`: owner approval, or verified ownership (a 301 from the employer's established domain to a page naming the employer).

The trial found four defects, all fixed with regression tests:
- A redirect to another allowed host skipped that host's robots.txt.
- A redirect target was fetched again through its own link.
- A closure in `robots_rules` lost the exception it referenced, so an off-scope robots.txt redirect crashed the run.
- A Next.js script URL with "careers" in its path was queued as a page.
