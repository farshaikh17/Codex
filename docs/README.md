# Project map

| Path | What it is |
|---|---|
| `sources.json` | Source list (JSON array): employer, provider, board, URL, enabled, poll interval. See [SOURCE_ONBOARDING.md](SOURCE_ONBOARDING.md). |
| `employers.json` | Employer registry (`employer-registry-1`): name, careers URL, evidenced job families and geography, inclusion reason. Public facts only. |
| `registry.py` | Loads and validates the registry. `python registry.py` before any collection. |
| `collect.py` | Official ATS feed collector: due scheduling, staged publication, run summary. |
| `adapters.py` | Greenhouse, Lever, Ashby normalization (MIT, extracted from the earlier local collector). |
| `public/status.json`, `public/index.json`, `public/boards/*.json` | Published collection output. See [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md). |
| `.github/workflows/collect.yml` | Five scheduled runs a day (owner's schedule). Each collects every enabled source, except one waiting on its own `poll_interval_hours`. Manual and `main` push runs collect all. |
| `migration/` | Provenance from the `public-job-collector` migration. |
| `bench/` | Quality benchmark: labelled fixtures, collection scenarios and scorer. See [BENCHMARK.md](BENCHMARK.md). |
| `test_*.py` | Offline tests: `python -m unittest -v`. |
| `crawl_pages.py`, `pages.json`, `public/pages/` | Manual Crawl4AI page fallback. **Only after farshaikh17/Codex#1 merges.** |
| `engine/`, `docs/ENGINE.md` | SQLite posting store over collector snapshots. **Only after farshaikh17/Codex#2 merges.** |

Docs:
- [ARCHITECTURE.md](ARCHITECTURE.md): current architecture
- [SOURCE_ONBOARDING.md](SOURCE_ONBOARDING.md): adding a source
- [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md): output files, consumers, staleness, compatibility
- [OPERATIONS_RECOVERY.md](OPERATIONS_RECOVERY.md): operations and recovery
- [ACCEPTANCE.md](ACCEPTANCE.md): acceptance-test checklist
- [LIMITATIONS.md](LIMITATIONS.md): known limitations
- [BENCHMARK.md](BENCHMARK.md): quality benchmark, labels, metrics, current measurements
- [BACKLOG.md](BACKLOG.md): dependency-ordered backlog
- [HANDOFF.md](HANDOFF.md): current state and status labels
- [CONSUMER_TEST.md](CONSUMER_TEST.md): steps for the original chat to test its access

The root `README.md` and `OPERATIONS.md` are left unchanged here to avoid conflicting with PR #1. Backlog item P8 merges them with these docs.
