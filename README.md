# Codex

## Job collector

Official public ATS feed collector, migrated into this private development repository. See OPERATIONS.md and MIGRATION.md. The collector has no candidate profiles or application data.

Manual Crawl4AI fallback for allowlisted career pages without feeds: crawl_pages.py, pages.json, output under public/pages/. See OPERATIONS.md.

# Candidate-specific discovery

Optional private discovery strategies allocate research effort independently of
eligibility. See [docs/DISCOVERY.md](docs/DISCOVERY.md) for the planner, cooldowns,
privacy boundary and live acceptance requirements.

## Dashboard

The public career dashboard (React frontend, Cloudflare Worker API, D1 migrations, release workflow and its tests) lives in
[`dashboard/`](dashboard/README.md). Viewing is public; every change needs the operator key. See
[`dashboard/docs/REPOSITORIES.md`](dashboard/docs/REPOSITORIES.md) for how it connects to this collector.
