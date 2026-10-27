# Codex

## Job collector

Official public ATS feed collector, migrated into this private development repository. See OPERATIONS.md and MIGRATION.md. The collector has no candidate profiles or application data.

Manual Crawl4AI fallback for allowlisted career pages without feeds: crawl_pages.py, pages.json, output under public/pages/. See OPERATIONS.md.

# Candidate-specific discovery

Optional private discovery strategies allocate research effort independently of
eligibility. See [docs/DISCOVERY.md](docs/DISCOVERY.md) for the planner, cooldowns,
privacy boundary and live acceptance requirements.

