# Isolated fix patches (independent review, 2026-11-09)

Three self-contained fixes, each built from `origin/main` (`a1ac61e`), not from the QA branch, so each can be reviewed and merged on its own. Apply one with
`git checkout -b <name> origin/main && git am dashboard/docs/qa-patches/<file>.patch`, then run the command in the table. None has been pushed as a branch or opened as a pull request.

| Patch | Fixes | Test command (in `dashboard/`) | Result on `main` + patch | New test without the fix |
|---|---|---|---|---|
| `fix1-outage-backup-share-link.patch` | outage copy of a share-link holder's answer served to anonymous visitors | `node --import ./test/register.mjs --test test/worker.test.mjs` | 66 pass, 0 fail | fails |
| `fix2-unsave-race.patch` | un-save loses a concurrent note / reports a false success and writes a false history row | same | 67 pass, 0 fail | fails |
| `fix3-job-row-button-names.patch` | identical accessible names on every job row | `npm run build:frontend` then `E2E_BASE=http://localhost:8787 node test/e2e/production-readonly.e2e.mjs desktop` against a seeded local server | new check passes | new check fails (150 duplicate names) |

Fixes 1 and 2 both append tests at the end of `test/worker.test.mjs`, so merging both gives a trivial end-of-file conflict: merge one, rebase the other. Fix 3 touches different files.
All three merge cleanly with each of the six draft pull requests #62 to #67.
