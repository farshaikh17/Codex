# Decisions waiting for the owner (2026-11-09)

One page, in the order I would take them. "Recommend" is the QA view only; every item is the owner's call. Nothing here has been deployed: the live site is still
commit `5832c43`. Changes only reach it when they are merged to `main` and the manual workflow `dashboard-release.yml` is run.

## A. Getting the work live
1. **Merge ChatGPT's six draft pull requests (#62 to #67).** They fix: a visa/relocation conflict (#62), the shared D1 budget guard (#64), JobSpy refusal detection (#63),
   application-link validation and the import limit (#65), decided-job protection in liveness checks (#66) and distinct jobs with the same employer and title (#67).
   Checked: all six merge cleanly with each other and with the QA branch, and on the combined code every test passes (205 Node, 357 Python). Recommend: review and merge.
2. **Open a pull request for the QA branch `ccr-31e055c3-e2y6ub`** (about 20 commits: privacy leak, login limiter during outages, client deletion, accessibility, error boundary, adapters,
   tests). It merges cleanly with the six above. Recommend: open the PR, merge after the six, then run the release workflow once.
3. **Run the release** (`dashboard-release.yml`, mode release) only after the merges, and check the run's browser step.

## B. Product and privacy
4. **Employer, role and date history of Farhan and Sana is written into `dashboard/worker/index.ts`** (private repo, not served publicly). Must move to the database only before the code is shared or sold. Recommend: before any client onboarding.
5. **Farhan's stored education text** (what `/api/profile` shows visitors). The code no longer falls back to the full college-and-year line, but whatever is stored is shown as is. Recommend: store the short label.
6. **Dashboard counts differ between screens** (Dashboard says Farhan has 40 READY, his page 39: one counts every job, the other leaves out jobs applied to or dismissed). Recommend: add a small "excluding applied" label.
7. **No "Delete client" button** (the API exists). Recommend: add one with a typed confirmation before the first real client.

## C. Free-tier limits and reliability
8. **Outage backup does nothing on `workers.dev`** (Cloudflare does not run the Cache API there). Options: custom domain (no code change), a KV namespace (small code change), or remove the code. Recommend: custom domain.
9. **Job-list queries cost roughly 9 rows read per qualification row per uncached view** (model, index entries included): about 13,000 reads for Farhan's 1,408 rows and 22,000 for Sana's 2,462, i.e. 110 to 200 distinct uncached views a day against the 2.5M public cap; at 30,000 rows per candidate it would be about 270,000. Recommend: measure real `rows_read`, then rewrite the page query to stop early and cache counts separately.
10. **Onboarding a client writes about NINE rows per active job (index entries count)**, so 27,000 writes for 3,000 jobs and 45,000 for 5,000, and nothing counts daily writes. (The backfill's READ cost, previously about N x N / 40 job rows, is fixed on the QA branch.) Recommend: screen only jobs matching the client's role keywords, or add a write meter, before the second client.
11. **GitHub delivers only about a third of the scheduled runs asked for** (guards make up for it). If a run is needed at a fixed hour (a morning report), let the Worker's own cron start the workflow with a minimum-permission token. Recommend: only if a fixed hour matters.
12. **Google Fonts are loaded from Google** (shows visitors' addresses to Google). Recommend: host the two font files yourself.

## D. Things only the owner can supply
13. The real **rows-read-today figure** (needs the analytics token the GitHub workflows hold) to confirm the cause of the 7 Nov overrun and the numbers in item 9.
14. A **30-row sample of re-scored jobs per candidate** from the live site (checks the `profile_v5` marker and that decided rows were left alone); the sandbox cannot reach the live site.
15. **Farhan's CV**, to review his profile for overstatement (not in the repository by design).
