# Project map

| Path | What it is |
|---|---|
| `sources.json` | Employer and source registry (`source-registry-1`). Public employer facts only. See [SOURCE_ONBOARDING.md](SOURCE_ONBOARDING.md). |
| `registry.py` | Loads and validates the registry. `python registry.py` before any collection. |
| `collect.py` | Official ATS feed collector: due scheduling, staged publication, run summary. |
| `adapters.py` | Greenhouse, Lever, Ashby normalization (MIT, extracted from the earlier local collector). |
| `public/status.json`, `public/index.json`, `public/boards/*.json` | Published collection output. See [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md). |
| `.github/workflows/collect.yml` | Hourly tick, collects only due sources; manual and `main` push runs collect all. |
| `migration/` | Provenance from the `public-job-collector` migration. |
| `test_*.py` | Offline tests: `python -m unittest -v`. |
| `crawl_pages.py`, `pages.json`, `public/pages/` | Manual Crawl4AI page fallback. **Only after farshaikh17/Codex#1 merges.** |

Docs:
- [ARCHITECTURE.md](ARCHITECTURE.md): current architecture
- [SOURCE_ONBOARDING.md](SOURCE_ONBOARDING.md): adding a source
- [OUTPUT_CONTRACT.md](OUTPUT_CONTRACT.md): output files, consumers, staleness, compatibility
- [OPERATIONS_RECOVERY.md](OPERATIONS_RECOVERY.md): operations and recovery
- [ACCEPTANCE.md](ACCEPTANCE.md): acceptance-test checklist
- [LIMITATIONS.md](LIMITATIONS.md): known limitations
- [BACKLOG.md](BACKLOG.md): dependency-ordered backlog
- [HANDOFF.md](HANDOFF.md): current state and status labels
- [CONSUMER_TEST.md](CONSUMER_TEST.md): steps for the original chat to test its access

The root `README.md` and `OPERATIONS.md` are left unchanged here to avoid conflicting with PR #1. Backlog item P8 merges them with these docs.
