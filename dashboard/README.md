# Career Job Engine dashboard

The public dashboard for the career job engine: a React/Vite frontend and a Cloudflare Worker API (`worker/index.ts`) on
Cloudflare D1, for two candidates (Farhan Shaikh and Sana Ansari). This folder lives inside the collector repository
(`farshaikh17/Codex`); the collector, the matching engine and the sync into D1 are in the repository root.

## Who can do what

| | Anyone with the URL | Operator (holds `ADMIN_API_KEY`) |
|---|---|---|
| Jobs, search, filters, candidate switching, Analytics, application tracker (status only), profile summary | yes | yes |
| Application notes, resume versions, application history, qualification audit, run logs, sync and backup surfaces | no | yes |
| Pay floors, notice period, employers, city, location preferences | no | yes |
| Save or change an application, dismiss, override, edit a profile, import a resume, start or pause automation | **no** | yes |

Reading is open: anything on a public page can be read by anyone with the URL. Writing is not: every non-GET request
and every sensitive read needs `Authorization: Bearer <ADMIN_API_KEY>`. The router uses an explicit allowlist of public
read routes (`PUBLIC_READ_PATTERNS` in `worker/index.ts`); a new route is protected until it is added there on purpose.
Public responses use explicitly selected fields and are passed through a second filter that removes private keys.

The operator sign-in is the lock icon in the top bar. It opens only when you choose it or when you try to change something;
loading and browsing never open it. Viewing the dashboard sends no credentials.

## Layout

```
dashboard/
  frontend/      React + Vite app (built to frontend/dist, served by the Worker as static assets)
  worker/        Worker API (index.ts) and cloud discovery (discovery.ts)
  migrations/    D1 migrations 0001-0008 (0008 is the only one a release applies; seed migrations are never replayed)
  scripts/       post_deploy_smoke.mjs (public smoke test), fingerprint.mjs (protected-record comparison), ...
  test/          Worker unit tests (SQLite harness), bundle-privacy test, real-browser tests (test/e2e)
  docs/          RELEASE.md, QA_REPORT.md, KNOWN_ISSUES.md, REPOSITORIES.md
  legacy/        original local Windows scripts, not used
  wrangler.toml  the one Worker named career-job-engine
```

## Develop and verify (no Cloudflare account needed)

```
cd dashboard
npm ci
npm run verify      # frontend build, Worker dry-run bundle, unit + public-view + bundle-privacy tests, migration chain
```

Real-browser tests against the real Worker runtime and a local D1 (disposable data and a throwaway key only) are in
`docs/RELEASE.md`. Releases are made only by the manual **Dashboard release to production** workflow.
