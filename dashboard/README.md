# Farhan Job Engine (v1.0.0-local)

A local, deterministic job discovery, India-remote eligibility qualification, and application tracking companion for Farhan Shaikh.

- **Zero Paid Dependencies**: Local SQLite storage, zero paid API keys.
- **Asymmetric Google Companion**: Read-only import and proposal staging; never overwrites canonical applications.
- **Conservative India Qualification**: Generic "Remote" does NOT mean India-eligible without affirmative proof.
- **Explainable Matching**: Deterministic scoring and rule-based evaluation.

---

## User Guide

### START ENGINE
Double-click `START_FARHAN_ENGINE.bat` in the project root folder.
Or run in PowerShell:
```powershell
.\START_FARHAN_ENGINE.bat
```
This automatically verifies the virtual environment, launches the local service on `http://127.0.0.1:8000`, runs a health probe, and opens the dashboard in your default web browser.

### STOP ENGINE
Double-click `STOP_FARHAN_ENGINE.bat` in the project root folder.
Or run in PowerShell:
```powershell
.\STOP_FARHAN_ENGINE.bat
```
This safely locates and terminates the background engine process on port 8000.

### OPEN DASHBOARD
If the engine is already running, navigate to:
```
http://127.0.0.1:8000/
```
The FastAPI backend serves both the REST API and the compiled React production application.

### RUN DISCOVERY
1. Click the **Automation** or **Sources** tab in the navbar.
2. Under Automation, click **Run Cycle Now** to trigger an immediate incremental polling run across enabled source adapters.
3. The engine uses content-hashing to skip unchanged feeds and executes exponential backoff on transient errors.

### REVIEW JOBS
1. Click the **Discovery** tab to view all collected opportunities.
2. Use the **Search**, **Eligibility**, and **Match Score** filters to slice vacancies.
3. Click any job row to open the **Explainability Card** showing exact eligibility breakdown, compensation analysis, and match evidence.
4. Use **Thumbs Up (Boost)** or **Thumbs Down** to tune candidate relevance.

### UNDERSTAND READY / NEEDS_REVIEW / UNKNOWN / INELIGIBLE
- **READY**: Confirmed genuine vacancy, working direct application URL, meets builder scope and pay floor, AND has affirmative verbatim evidence of remote work from India (contractor, W-8BEN, EOR, or India entity).
- **NEEDS_REVIEW**: Listing matches candidate builder domain but geographic eligibility requires manual candidate inspection.
- **UNKNOWN**: Ambiguous remote terms (e.g. "Remote - US/Worldwide") without explicit country terms. Kept on HOLD.
- **INELIGIBLE**: Explicitly excludes India, fails fixed pay floor (< INR 120,000/mo or < 14.4 LPA), or falls under disqualified domains (primary customer support, call center, outbound cold calling, embedded firmware).

### GOOGLE SYNC
1. Click the **Google Sync** tab in the navbar.
2. The engine targets canonical spreadsheet: `1nReYflEQcDsa-hG0zebr_XTtO7sV7eZlhffoIBdgHss` (*Farhan Job Engine — Live Ledger*).
3. **Write Guard**: Google Sheets write access is locked by default.
4. **Dry-Run Import**: Preview canonical records to import without writing any data.
5. **Dry-Run Propose**: Preview local READY vacancies to stage into `Proposed_Discoveries`.
6. **Candidate Authority**: Canonical applications and candidate manual notes in Google Sheets have absolute precedence.

### BACKUP
1. Click the **Sources** tab, then select **Backups & Ledgers**.
2. Click **Create Snapshot Backup** to generate an immediate timestamped SQLite database copy in `backend/backups/`.
3. Backups are transactional and capture full job state, audit trails, and application history.

### RESTORE
1. Stop the engine using `STOP_FARHAN_ENGINE.bat`.
2. Locate the desired backup file in `backend/backups/job_engine_backup_YYYYMMDD_HHMMSS.db`.
3. Copy the backup file over `backend/job_engine.db`.
4. Restart the engine using `START_FARHAN_ENGINE.bat`.

### TROUBLESHOOT
- **Port 8000 in use**: Run `STOP_FARHAN_ENGINE.bat` to clear orphaned processes.
- **Backend disconnected in UI**: Check `backend_startup.log` in the project root.
- **Google Sheets connection**: The engine defaults to offline simulation (`Test File Transport`). Desktop OAuth 2.0 PKCE can be authenticated via the Google Sync tab.
- **Reset test fixtures**: Click the reload icon in the navbar to re-seed deterministic synthetic fixtures without affecting real tracked applications.
