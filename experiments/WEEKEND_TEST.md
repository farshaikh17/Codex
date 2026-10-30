# Weekend recruiter experiment

Branch: `experiment/recruiter-triage-v1`. No production changes.

## Run
1. Open the GitHub repository, switch to this experiment branch.
2. Open Actions > **Recruiter experiment (manual only)**.
3. Select **Run workflow**, choose the experiment branch, candidate (farhan or sana), and sample limit (30 recommended).
4. Once finished, open the workflow run and download **recruiter-trial-CANDIDATE** from Artifacts.
5. Review `CANDIDATE-trial.json` and the Actions test log.

If the workflow does not appear in Actions, GitHub may require the workflow to exist on the default branch before manual dispatch. Do **not** merge the experiment solely to expose the workflow. Instead run locally:

```sh
python -m unittest discover -s experiments -p 'test_*.py' -v
python experiments/weekend_trial.py --candidate farhan --limit 30
python experiments/weekend_trial.py --candidate sana --limit 30
```

The report appears in `trial-output/`. It is a read-only offline triage snapshot, not a list of verified READY jobs. The sample contains the highest-ranked N unique records across all board files using deterministic title/description keyword scores. These scores are relevance hints, not verified eligibility. No live URL, pay, or work-authorization verification is performed. The trial does not compare against Gmail or the private application ledger.

## Weekend acceptance
- Unit tests pass for candidate separation, exclusions, duplicates, and schema validation.
- Record counts are explainable and deterministic across repeat runs.
- No READY claims without full-JD and compensation verification.
- No production files, ledgers, schedules, or applications changed.
- Review at least 10 sample decisions manually and record false exclusions and missing blockers.
- Before production integration, implement real primary-JD verification, salary/India evidence, candidate fit, canonical dedup and incremental processing.

Cost: Python standard library only, no AI API. GitHub Actions free usage is subject to account/repository limits.
