# Consumer access test (for the original ChatGPT chat)

Goal: establish, with evidence, whether the ChatGPT task can read this private repository. This changes nothing in any live task or Sheet. Run it manually in a chat that has the GitHub connector enabled.

1. Ask: "Using the GitHub connector, open `public/status.json` in `farshaikh17/Codex` on branch `main` and quote `schema`, `attempted_at` and `status` exactly."
   - Pass: the three values match the file on GitHub.
   - Fail: an access or not-found error, or values that don't match. Note whether it tried a public `raw.githubusercontent.com` URL; that can't work for a private repository.
2. Ask it to open `public/boards/posthog-ashby.json` (small) and report the number of jobs and the first job's `key`. This tests reading a second file in the same run.
3. Ask it to open `public/boards/gitlab-greenhouse.json` (largest, about 2 MB) and report the last job's `key`. This tests truncation. If it can't reach the end, the consumer needs to read per source or rely on `index.json` plus selected boards.
4. Record: date, connector name, pass or fail per step, any truncation. Send the results back to the repository owner. Don't paste job data into Sheets as part of this test.

After this PR merges, `status.json` also carries `run_id` and `outcome`. Step 1 can then quote `run_id` to confirm the consumer sees the newest commit.

Until step 1 passes, record the consumer status as **not verified**.
