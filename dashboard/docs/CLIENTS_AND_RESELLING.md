# Clients and reselling

The engine runs job searches for more than the two original candidates. Each extra person is a **client**. You add clients yourself from the dashboard. No code change or deploy is needed, and everything stays on the free tier.

## What a client is

- **A profile.** Name, headline, one-line summary, skills, years of experience, a score threshold, and a **search profile**.
- **A search profile:**
  - **Role keywords.** Plain words such as `data analyst, bi analyst`. A posting matches when its title contains one of them. They are not regular expressions; symbols are matched literally.
  - **Titles to rank down.** For example `senior, principal`. These postings stay listed, but their preliminary score is capped below the review threshold.
  - **Location rule.**
    - `REMOTE_FROM_HOME`: eligible only when the posting explicitly supports fully remote work from the home country.
    - `HOME_OR_RELOCATE`: eligible also when the posting is in the home country and remote, or explicitly offers sponsorship or worldwide remote work.
  - **Home country.** India by default.
- **Visibility.**
  - **Private (default).** Only the operator, and anyone holding a share link for this client, can see it.
  - **Public.** Listed for every visitor, like the original two.

The two original candidates (Farhan, Sana) keep their built-in rules and stay public. Their visibility and rules cannot be changed from the Clients page.

## Adding a client

1. Sign in as operator, then open **CLIENTS**.
2. Fill in **Add a client** and choose **Create client and screen jobs**.
   - This creates the client, then screens every active job in the database for them, in batches of 200.
   - Screening only **adds** rows for the new client and never changes anyone else's.
   - Nothing is marked READY or STRETCH automatically. Promotion to READY is always a human decision, made in the job detail.
3. Later, new postings found by the Worker's discovery cron are screened for every client automatically.
   - Use **Screen new jobs** to pick up anything that arrived some other way, such as GitHub collector imports. The collector itself only writes rows for the two original candidates.

## Sharing with a client

- **New share link** creates a read-only link of the form `https://<site>/#view=<token>&candidate=<id>`.
- The link is **shown once**. Only a SHA-256 of the token is stored.
- The token sits after `#`, so it is never sent in a page request and never appears in server logs. The page reads it once, keeps it for that browser tab, and removes it from the address bar.
- Anyone with the link sees that one client's dashboard: jobs, READY list, analytics and CSV export. They can change nothing and cannot see other private clients.
- **Links → Revoke** ends a link at once. The holder is told the link is no longer valid and sees only the public dashboard.
- Make a separate link per person, so you can revoke one without affecting the others.

## Exporting

- **Export CSV** and **Export Ready + Stretch** are in each workspace header. The Clients page has **CSV** for each client.
- The file lists active jobs in the list's score order, up to 1,000 rows. Columns:
  - job id, title, company, location, workplace
  - posting URL
  - qualification status, eligibility, lane
  - preliminary score
  - whether pay is published, and the published pay text
  - application status, discovered date
- Private details are never included: notes, override reasons, pay floors, stored city.
- Cells that a spreadsheet would run as a formula are prefixed with `'`.

## Capacity on the free tier

D1 allows 5,000,000 rows read per UTC day. Public viewing is capped at 2,500,000 of those (`PUBLIC_DAILY_READ_BUDGET`). After that, visitors see a "capacity used up" notice until 00:00 UTC; the operator is not affected.

- **What a page view costs.** One uncached load of a client's job list reads about one row per screened job, times two to three. Measured locally with 2,200 jobs: about 13,000 rows for the list and about 6,500 for analytics.
- **Caching.** Answers are cached for 30 minutes for visitors and 10 minutes for the operator, so repeat views cost almost nothing.
- **Share links are not cached.** Every load through a share link is a fresh read.
- **What it adds up to.** A handful of clients, each checking their dashboard a few times a day, fits comfortably. A large audience of share-link viewers does not.
- **How to check.** The release workflow's `diagnose` mode prints today's metered public reads and Cloudflare's own account usage.

## Removing a client

There is no delete button: deleting would also delete their applications and decisions.

- Make the client private and revoke its links. It then disappears for everyone but the operator.
- If a client must be erased entirely, that is a deliberate manual step on the database.
  - Delete their rows from `client_view_tokens`, `applications`, `application_history`, `qualification_history`, `candidate_job_scores`, `candidate_qualifications`, `client_profiles` and `candidates`, in that order.
  - Take a backup first.

## Operator API

All of these need the operator key, except `/api/export`, which follows the same visibility rule as every other read.

| Method and path | What it does |
|---|---|
| `GET /api/clients` | Every client, with profile, visibility, jobs screened, Ready+Stretch count, and active share links |
| `POST /api/clients` | Create a client. Body: `full_name`, `search_profile.role_keywords` (required); optional `id`, `display_title`, `summary_line`, `primary_skills`, `qualification_threshold` (30–95), `visibility`, … Returns 201, 400 or 409 |
| `PUT /api/clients/:id` | Change any of the fields above. A changed search profile applies to new screening only; rows already screened keep their recorded result |
| `POST /api/clients/:id/backfill?limit=200` | Screen up to 200 active jobs the client has no row for yet. Returns `{ inserted, more }` |
| `GET /api/clients/:id/share-links` | Link ids, labels, created and revoked times. Never the token |
| `POST /api/clients/:id/share-links` | Create a link: `{ token, path }`, shown once |
| `DELETE /api/clients/:id/share-links/:link_id` | Revoke a link |
| `GET /api/export?candidate_id=…&qualification_status=ALL\|APPLY_WORTHY\|READY\|…` | CSV download |
