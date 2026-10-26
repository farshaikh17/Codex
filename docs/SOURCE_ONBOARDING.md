# Source onboarding

A source whose ATS is Greenhouse, Lever or Ashby needs only a JSON edit. No Python changes.

1. Find the official board on the employer's own careers page, not a third-party aggregator. Record that page as `careers_url` once you have opened it yourself.
2. Add or reuse an employer in `employers.json` → `employers`:
   ```json
   {"id": "acme", "name": "Acme", "careers_url": "https://acme.example/careers",
    "job_families": [], "geography": [],
    "inclusion": {"reason": "Why this employer is worth polling", "evidence_url": "https://acme.example/careers"}}
   ```
3. Add a source to the `sources.json` list:
   ```json
   {"id": "acme-lever", "employer": "acme", "provider": "lever", "board": "acme"}
   ```
   `url` is optional. When omitted it is derived, and it requests employer-published compensation: Greenhouse `https://boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true&pay_transparency=true`, Lever `https://api.lever.co/v0/postings/<board>?mode=json`, Ashby `https://api.ashbyhq.com/posting-api/job-board/<board>?includeCompensation=true`. A Greenhouse or Ashby URL without its compensation option produces a validation warning. Allowed query options: Greenhouse `content`, `pay_transparency`; Lever `mode=json`; Ashby `includeCompensation`. Changing an existing source's URL can change content hashes. See BACKLOG E2.
   Optional: `enabled` (default true), `poll_interval_hours` (1–168, default 5), `notes`.
4. Run `python registry.py` (it validates both files). It must print `OK`. Warnings (for example a missing `careers_url`) don't block collection, but resolve them.
5. Trial locally: `python collect.py --ids acme-lever`. Check the run table and `public/boards/acme-lever.json`. Revert `public/` if you don't intend to commit a collection.
6. Open a PR. A `main` push of `sources.json` triggers a full collection. `employers.json` edits don't.

Geography and job families need evidence: `{"region": "IN", "basis": "explicit_statement" | "posting_location", "evidence": {"url": "https://…", "checked_at": "YYYY-MM-DD", "quote": "…"}}`. A remote posting is not evidence that an employer hires in India or anywhere else. Leave these lists empty rather than guessing.

Validation rejects: duplicate source ids, the same provider board configured twice (case-insensitive), malformed ids or boards, URLs off the provider's host, path or allowed options, unknown keys (including candidate fields such as `salary_floor`), unknown employers, intervals out of range, and a registry with no enabled source.

Employers without a supported feed go to `pages.json` (PR #1) until P8 merges the two.
