# Source discovery: careers URLs and the first trial (backlog B)

`discover.py` came to `main` through farshaikh17/Codex#13, with review fixes on top of #10's version (no redirects followed, a time budget on each response body, `market_sources.json` targets). Its bounds, report format and targets are documented in [MARKET_DISCOVERY.md](MARKET_DISCOVERY.md). This file covers what remains from #10: verified `careers_url` evidence and the record of the first live trial.

## `careers_url` evidence

A run proposes a `careers_url` when a page links to a board already configured for the same employer. The evidence is `{url, checked_at, quote}`, where the quote is the board link. A person reviews it and copies it into `employers.json` as `careers_url` plus `careers_url_evidence`.

`registry.py` checks `careers_url_evidence` whenever it is given (an `https` URL, a `checked_at` time) and rejects malformed evidence. A `careers_url` without evidence is a warning, not an error, because `main` has employers added before evidence was recorded. Applied with evidence (owner-approved 2026-10-26): Oyster, Zapier, Weave, Clipboard.

## Adding a discovered source

1. Read the proposal. Open the evidence page yourself and confirm it is the employer's own site.
2. Add the employer to `employers.json` if `employer_entry_needed` is true, with a real `inclusion.reason`.
3. Paste `proposed_source` into `sources.json`. Run `python registry.py`, and trial it with `python collect.py --ids <id>`.
4. Open a PR. Recurring collection starts only after the PR merges.

## First live trial (2026-10-26, this container, #10's version, 40 requests across 16 targets, nothing committed)

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

Widening a target's `allowed_hosts` needed a recorded basis (`allowed_hosts_basis`): owner approval, or verified ownership (a 301 from the employer's established domain to a page naming the employer).

The trial found four defects, all fixed with regression tests:
- A redirect to another allowed host skipped that host's robots.txt.
- A redirect target was fetched again through its own link.
- A closure in `robots_rules` lost the exception it referenced, so an off-scope robots.txt redirect crashed the run.
- A Next.js script URL with "careers" in its path was queued as a page.
