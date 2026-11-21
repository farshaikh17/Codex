# Career Job Engine

**A hyper-specialized job search engine, built around the person searching.**

The goal is simple: help people find opportunities that fit their skills, experience, career goals, location and working preferences. The long-term vision is to make this kind of personalized job discovery accessible to anyone and everyone, across professions, industries and countries.

This project began with two candidate profiles and is being developed in public. It already brings together job discovery, eligibility screening, ranking and a dashboard. Expanding it into a service that anyone can configure for their own search is the next direction—not a feature we claim is finished today.

**Want to help make it better? You are welcome here.** Developers, designers, testers, job seekers and people with industry knowledge can all contribute. Ideas, bug reports, documentation improvements and pull requests are welcome, whether this is your first contribution or your hundredth.

## Help shape what comes next

- **Broader discovery:** more employer career pages, reliable public feeds, industries and regions.
- **Better matching:** clearer eligibility checks and explanations for why a job may fit.
- **An easier experience:** accessible mobile layouts, useful filters and simpler onboarding.
- **Reliable, efficient operation:** fewer duplicate or stale postings, lower database usage and dependable automation.
- **Personalization for more people:** configurable profiles and preferences, with appropriate privacy and access controls.

These are development priorities, not promises of current coverage or availability. The project is a work in progress, and contributions that make existing features more reliable are just as valuable as new features.

## Get involved

1. Browse the [open issues](https://github.com/farshaikh17/Codex/issues) or open an issue describing a bug, idea or missing job source.
2. For a substantial change, discuss the approach in an issue first so we can coordinate.
3. Fork the repository, make a focused change and open a pull request explaining the problem, your solution and how you checked it.
4. Use fictional candidate data for examples and tests. Keep CVs, contact details, credentials and personal application records out of public issues and commits.

No coding experience is required to report confusing screens, suggest employers or improve the documentation. Please keep feedback constructive and respectful.

The aim is to remain usable with free tools and within free hosting limits. **The engine helps people discover and review opportunities; it does not submit job applications automatically.** Each person stays in control of where they apply.

Licensed under the [MIT License](LICENSE).

## Job collector

Official public ATS feed collector, maintained in this public development repository. See OPERATIONS.md and MIGRATION.md. The collector has no candidate profiles or application data.

Manual Crawl4AI fallback for allowlisted career pages without feeds: crawl_pages.py, pages.json, output under public/pages/. See OPERATIONS.md.

## How the pieces fit

A free, manual-apply job-hunting engine for two candidates. It finds postings, screens and ranks them with one shared rule set, and shows the best ones on a public
dashboard. **Nothing is ever applied to automatically.**

| Piece | Where | What it does |
|---|---|---|
| Collector | `collect.py`, `.github/workflows/collect.yml`, `sync_collector_to_d1.yml` | Official public ATS feeds (Greenhouse, Lever, Ashby, ...) into snapshots, then into D1 |
| Daily discovery | `engine/dataset_discovery.py`, `engine/more_sources.py`, `engine/remote_boards.py`, `.github/workflows/discovery.yml` | An open dataset of ~5M live ATS postings plus employer sites (SuccessFactors, SmartRecruiters, Workday, Oracle, Eightfold, ...) and remote boards; scored with the Worker's own screen; written to D1 in capped batches; still-open check |
| Watchlist | `.github/workflows/watchlist.yml` | The priority employers and boards, every two hours |
| Screen | `dashboard/worker/discovery.ts` (`evaluate`) | The single scoring and eligibility function, used by the Worker and the GitHub scripts |
| Worker + dashboard | `dashboard/` | Cloudflare Worker, D1, React; public job lists, candidate tracking and operator tools |
| Guards | `dashboard/scripts/budget_guard.mjs`, `recent_run_guard.mjs` | Keep the free D1 limits (5M reads, 100k writes a day) and catch dropped GitHub schedules |
| Release | `.github/workflows/dashboard-release.yml` | The only way production changes: manual, from `main`, with its own tests, smoke test and real-browser check |

Free tools only. Protected: applications, manual decisions and candidate profiles (no CVs or contact details are stored in this repository).

Start here if you are reviewing the system: [`dashboard/docs/QA_HANDOFF_2026-11-10.md`](dashboard/docs/QA_HANDOFF_2026-11-10.md) (what was built, how it was verified, known gaps),
then [`dashboard/docs/RELEASE.md`](dashboard/docs/RELEASE.md) and [`dashboard/docs/KNOWN_ISSUES.md`](dashboard/docs/KNOWN_ISSUES.md).

### Run the tests locally

Start in the repository root. With Python 3.12, run a first check using the synthetic pipeline fixtures:

```sh
python3 -m unittest engine.tests.test_pipeline
```

For the full Python suite, use the [offline test workflow](.github/workflows/tests.yml), which disables outbound sockets before discovering tests from the repository root.

The dashboard uses Node.js 22.18 or newer and npm. From the same repository root, run:

```sh
(cd dashboard && npm ci && npm run verify)
```

This installs dependencies, builds the frontend and Worker, and runs the dashboard tests against local fixtures. Neither check requires production credentials.

## Candidate-specific discovery

Optional private discovery strategies allocate research effort independently of
eligibility. See [docs/DISCOVERY.md](docs/DISCOVERY.md) for the planner, cooldowns,
privacy boundary and live acceptance requirements.

## Dashboard

The public career dashboard (React frontend, Cloudflare Worker API, D1 migrations, release workflow and its tests) lives in
[`dashboard/`](dashboard/README.md). Viewing is public. With the open tracker enabled, tracker actions can update real candidate records without an operator key. Use local fixtures when testing changes. See the [tracker permissions](dashboard/docs/RELEASE.md#open-tracker-limits-and-undo).
[`dashboard/docs/REPOSITORIES.md`](dashboard/docs/REPOSITORIES.md) explains how it connects to this collector.
