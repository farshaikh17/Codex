# Legacy scripts (not part of the release)

These were written for a Windows workstation (absolute `C:\Users\...` paths, local Chrome/Edge, a local SQLite
staging server) and are kept only for history. They are not run by `npm test` or any workflow.

* `staging_server.mjs` was replaced by `wrangler dev --local` (see `docs/RELEASE.md` and `test/e2e/`).
* The two Python tests need the collector repository (`farshaikh17/Codex`) and its `engine/` package; the collector owns
  that code and its tests.
* The Playwright scripts are superseded by `test/e2e/browser.e2e.mjs`.
