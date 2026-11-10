# Codex

## Job collector

Official public ATS feed collector, migrated into this private development repository. See OPERATIONS.md and MIGRATION.md. The collector has no candidate profiles or application data.

Manual Crawl4AI fallback for allowlisted career pages without feeds: crawl_pages.py, pages.json, output under public/pages/. See OPERATIONS.md.

# Career Job Engine (how the pieces fit)

A free, manual-apply job-hunting engine for two candidates. It finds postings, screens and ranks them with one shared rule set, and shows the best ones on a public
read-only dashboard. **Nothing is ever applied to automatically.**

| Piece | Where | What it does |
|---|---|---|
| Collector | `collect.py`, `.github/workflows/collect.yml`, `sync_collector_to_d1.yml` | Official public ATS feeds (Greenhouse, Lever, Ashby, ...) into snapshots, then into D1 |
| Daily discovery | `engine/dataset_discovery.py`, `engine/more_sources.py`, `engine/remote_boards.py`, `.github/workflows/discovery.yml` | An open dataset of ~5M live ATS postings plus employer sites (SuccessFactors, SmartRecruiters, Workday, Oracle, Eightfold, ...) and remote boards; scored with the Worker's own screen; written to D1 in capped batches; still-open check |
| Watchlist | `.github/workflows/watchlist.yml` | The priority employers and boards, every two hours |
| Screen | `dashboard/worker/discovery.ts` (`evaluate`) | The single scoring and eligibility function, used by the Worker and the GitHub scripts |
| Worker + dashboard | `dashboard/` | Cloudflare Worker, D1, React; public read-only, every change needs the operator key |
| Guards | `dashboard/scripts/budget_guard.mjs`, `recent_run_guard.mjs` | Keep the free D1 limits (5M reads, 100k writes a day) and catch dropped GitHub schedules |
| Release | `.github/workflows/dashboard-release.yml` | The only way production changes: manual, from `main`, with its own tests, smoke test and real-browser check |

Free tools only. Protected: applications, manual decisions and candidate profiles (no CVs or contact details are stored in this repository).

Start here if you are reviewing the system: [`dashboard/docs/QA_HANDOFF_2026-11-10.md`](dashboard/docs/QA_HANDOFF_2026-11-10.md) (what was built, how it was verified, known gaps),
then [`dashboard/docs/RELEASE.md`](dashboard/docs/RELEASE.md) and [`dashboard/docs/KNOWN_ISSUES.md`](dashboard/docs/KNOWN_ISSUES.md).

Tests: `cd dashboard && npm ci && npm run verify` (Node, migrations, bundle privacy) and `python3 -m unittest discover -s . -p 'test_*.py'` (Python, network disabled).

# Candidate-specific discovery

Optional private discovery strategies allocate research effort independently of
eligibility. See [docs/DISCOVERY.md](docs/DISCOVERY.md) for the planner, cooldowns,
privacy boundary and live acceptance requirements.

## Dashboard

The public career dashboard (React frontend, Cloudflare Worker API, D1 migrations, release workflow and its tests) lives in
[`dashboard/`](dashboard/README.md). Viewing is public; every change needs the operator key. See
[`dashboard/docs/REPOSITORIES.md`](dashboard/docs/REPOSITORIES.md) for how it connects to this collector.
