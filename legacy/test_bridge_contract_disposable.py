import sqlite3
import sys
import os

# Ensure repo root is discoverable relative to script path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(os.path.join(BASE_DIR, "engine", "staging_bridge.py")):
    REPO_ROOT = BASE_DIR
elif os.path.exists(os.path.join(BASE_DIR, "..", "source_tree", "engine", "staging_bridge.py")):
    REPO_ROOT = os.path.abspath(os.path.join(BASE_DIR, "..", "source_tree"))
elif os.path.exists(os.path.join(BASE_DIR, "source_tree", "engine", "staging_bridge.py")):
    REPO_ROOT = os.path.abspath(os.path.join(BASE_DIR, "source_tree"))
else:
    REPO_ROOT = BASE_DIR

sys.path.insert(0, REPO_ROOT)
from engine.staging_bridge import codex_to_d1_job, codex_to_d1_qualification, D1StagingBridge, normalize_posting_url

def test_bridge_contract_disposable_schema():
    print("=== Testing Staging Bridge on Disposable SQLite Schema ===")
    print(f"   [INFO] Active REPO_ROOT: {REPO_ROOT}")
    
    # 1. Initialize SQLite connection with actual production migrations 0001 and 0007
    conn = sqlite3.connect(":memory:")
    
    # Locate migrations portably
    cand_mig_dirs = [
        os.path.join(REPO_ROOT, "migrations"),
        os.path.join(BASE_DIR, "migrations"),
        os.path.join(BASE_DIR, "..", "source_tree", "migrations"),
        os.path.join(BASE_DIR, "source_tree", "migrations")
    ]
    
    mig_0001 = None
    mig_0007 = None
    for d in cand_mig_dirs:
        m1 = os.path.join(d, "0001_initial_schema.sql")
        m7 = os.path.join(d, "0007_qualification_history.sql")
        if os.path.exists(m1) and os.path.exists(m7):
            mig_0001 = m1
            mig_0007 = m7
            break
            
    assert mig_0001 is not None and mig_0007 is not None, f"FATAL: Migrations 0001 and 0007 not found in candidates: {cand_mig_dirs}"
    print(f"   [INFO] Found migration 0001: {mig_0001}")
    print(f"   [INFO] Found migration 0007: {mig_0007}")
    
    with open(mig_0001, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
    with open(mig_0007, "r", encoding="utf-8") as f:
        conn.executescript(f.read())
        
    # Verify candidate_job_scores table exists in disposable schema
    tbl = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='candidate_job_scores'").fetchone()
    assert tbl is not None, "FATAL: candidate_job_scores table is missing from disposable schema!"
    print("   [PASS] candidate_job_scores table confirmed in disposable schema.")

    # Populate required candidate seed rows
    conn.execute("INSERT OR IGNORE INTO candidates (id, full_name, citizenship, primary_timezone) VALUES ('farhan_shaikh', 'Farhan Shaikh', 'India', 'Asia/Kolkata')")
    conn.execute("INSERT OR IGNORE INTO candidates (id, full_name, citizenship, primary_timezone) VALUES ('sana_ansari', 'Sana Ansari', 'India', 'Asia/Kolkata')")

    def disposable_executor(sql: str):
        conn.executescript(sql)
        return [{"success": True}]

    bridge = D1StagingBridge(
        mode="disposable",
        cwd=REPO_ROOT,
        executor=disposable_executor
    )

    # 2. Test URL Normalization Contract
    print("\n1. Testing URL Normalization Contract...")
    raw_lever_apply = "https://jobs.lever.co/company1/abc-123/apply?lever-source=LinkedIn&ref=tracking"
    norm_url = normalize_posting_url(raw_lever_apply)
    assert norm_url == "https://jobs.lever.co/company1/abc-123", f"Expected stripped Lever apply URL, got {norm_url}"
    print(f"   [PASS] Lever URL normalized: {raw_lever_apply} -> {norm_url}")

    raw_gh = "https://boards.greenhouse.io/corp/jobs/999?gh_src=custom_tracker#app"
    norm_gh = normalize_posting_url(raw_gh)
    assert norm_gh == "https://boards.greenhouse.io/corp/jobs/999", f"Expected stripped Greenhouse URL, got {norm_gh}"
    print(f"   [PASS] Greenhouse URL normalized: {raw_gh} -> {norm_gh}")

    # 3. Test Initial Import into Disposable DB
    print("\n2. Testing Initial Import via Bridge...")
    codex_job = {
        "key": "job_disposable_101",
        "title": "Lead Solutions Engineer",
        "company": "Acme Global Systems",
        "company_url": "https://acme.example.com",
        "company_headquarters": "Bengaluru, India",
        "source_adapter": "greenhouse",
        "url": "https://boards.greenhouse.io/acme/jobs/101?source=referral",
        "apply_url": "https://boards.greenhouse.io/acme/jobs/101?source=referral",
        "workplace_type": "remote",
        "location_restrictions": "India",
        "description": "Lead customer automation integrations and technical implementations.",
        "required_skills": ["GoHighLevel", "Zapier", "REST APIs"],
        "discovered_at": "2026-11-02T12:00:00Z",
        "is_active": 1,
        "source_id": "gh_101",
        "provenance": "LIVE_PUBLIC"
    }

    qual_record_farhan = {
        "candidate_id": "farhan_shaikh",
        "job_id": "job_disposable_101",
        "qualification_status": "READY",
        "strategy_lane": "STRONGEST_FIT",
        "overall_score": 85,
        "eligibility_status": "ELIGIBLE",
        "eligibility_reason": "Location and skills meet requirements",
        "qualification_reason": "Strong GoHighLevel and integration experience",
        "qualified_at": "2026-11-02T12:05:00Z",
        "last_reverified_at": "2026-11-02T12:05:00Z",
        "score_breakdown": "{}"
    }

    item_farhan = {
        "job": codex_job,
        "qualification": qual_record_farhan
    }

    res = bridge.import_batch("farhan_shaikh", [item_farhan])
    assert res.get("status") in ("success", "SUCCESS") or res.get("qualifications_processed", 0) >= 1, f"Import failed: {res}"
    
    # Assert records exist in disposable DB
    row_job = conn.execute("SELECT id, title, original_posting_url FROM jobs WHERE id = ?", ("job_disposable_101",)).fetchone()
    assert row_job is not None, "Job record not found in disposable database!"
    assert row_job[2] == "https://boards.greenhouse.io/acme/jobs/101", f"Job URL not normalized in DB: {row_job[2]}"

    row_score = conn.execute("SELECT overall_score, strategy_lane FROM candidate_job_scores WHERE candidate_id = ? AND job_id = ?", ("farhan_shaikh", "job_disposable_101")).fetchone()
    assert row_score is not None, "candidate_job_scores row not inserted!"
    assert row_score[0] == 85 and row_score[1] == "STRONGEST_FIT", f"Score row mismatch: {row_score}"

    row_qual = conn.execute("SELECT qualification_status, strategy_lane FROM candidate_qualifications WHERE candidate_id = ? AND job_id = ?", ("farhan_shaikh", "job_disposable_101")).fetchone()
    assert row_qual is not None, "candidate_qualifications row not inserted!"
    assert row_qual[0] == "READY", f"Status mismatch: {row_qual}"
    print("   [PASS] Initial import successfully committed to jobs, candidate_qualifications, and candidate_job_scores.")

    # 4. Simulate Operator Manual Override and Application State Transition
    print("\n3. Testing Operator Manual Override and Application History Audit Logging...")
    conn.execute("""
        UPDATE candidate_qualifications
        SET manual_override_status = 'READY_HIGH',
            manual_override_reason = 'Direct referral from lead investor',
            qualification_status = 'READY_HIGH'
        WHERE candidate_id = 'farhan_shaikh' AND job_id = 'job_disposable_101'
    """)
    conn.execute("""
        INSERT INTO qualification_history (candidate_id, job_id, previous_status, new_status, reason, actor)
        VALUES ('farhan_shaikh', 'job_disposable_101', 'READY', 'READY_HIGH', 'Direct referral from lead investor', 'operator')
    """)
    conn.execute("""
        INSERT INTO applications (id, candidate_id, job_id, status, applied_at, notes)
        VALUES ('app_disp_1', 'farhan_shaikh', 'job_disposable_101', 'SUBMITTED', '2026-11-02T14:00:00Z', 'Submitted via referral portal')
    """)
    conn.execute("""
        INSERT INTO application_history (candidate_id, job_id, application_id, previous_status, new_status, notes, actor)
        VALUES ('farhan_shaikh', 'job_disposable_101', 'app_disp_1', 'SAVED', 'SUBMITTED', 'Submitted via referral portal', 'operator')
    """)

    # 5. Test Repeat-Import Downgrade Protection & History Preservation
    print("\n4. Testing Repeat Import Downgrade Protection...")
    repeat_qual = {
        "candidate_id": "farhan_shaikh",
        "job_id": "job_disposable_101",
        "qualification_status": "NEEDS_REVIEW",
        "strategy_lane": "BRIDGE",
        "overall_score": 60,
        "eligibility_status": "UNKNOWN",
        "eligibility_reason": "Automated re-evaluation check",
        "qualification_reason": "Downgraded automated confidence",
        "qualified_at": "2026-11-02T16:00:00Z",
        "last_reverified_at": "2026-11-02T16:00:00Z",
        "score_breakdown": "{}"
    }

    item_repeat = {
        "job": codex_job,
        "qualification": repeat_qual
    }

    res_repeat = bridge.import_batch("farhan_shaikh", [item_repeat])
    assert res_repeat.get("status") in ("success", "SUCCESS") or res_repeat.get("qualifications_processed", 0) >= 1, f"Repeat import failed: {res_repeat}"

    post_qual = conn.execute("SELECT qualification_status, manual_override_status, manual_override_reason FROM candidate_qualifications WHERE candidate_id = ? AND job_id = ?", ("farhan_shaikh", "job_disposable_101")).fetchone()
    assert post_qual[0] == "READY_HIGH", f"FATAL: Repeat import overwrote manual override! Status: {post_qual[0]}"
    assert post_qual[1] == "READY_HIGH", "Manual override status corrupted"
    assert post_qual[2] == "Direct referral from lead investor", "Manual override reason corrupted"
    print("   [PASS] Repeat import safely preserved operator override (READY_HIGH retained).")

    q_hist = conn.execute("SELECT COUNT(*) FROM qualification_history WHERE candidate_id = ? AND job_id = ?", ("farhan_shaikh", "job_disposable_101")).fetchone()[0]
    assert q_hist == 1, f"Expected 1 qualification history record, found {q_hist}"

    app_hist = conn.execute("SELECT COUNT(*) FROM application_history WHERE candidate_id = ? AND job_id = ?", ("farhan_shaikh", "job_disposable_101")).fetchone()[0]
    assert app_hist == 1, f"Expected 1 application history record, found {app_hist}"
    print("   [PASS] Historical audit logs preserved without corruption.")

    # 6. Test Candidate Scoping Isolation
    print("\n5. Testing Candidate Isolation on Staging Bridge...")
    qual_sana = {
        "candidate_id": "sana_ansari",
        "job_id": "job_disposable_101",
        "qualification_status": "INELIGIBLE",
        "strategy_lane": "NOT_FIT",
        "overall_score": 25,
        "eligibility_status": "INELIGIBLE",
        "eligibility_reason": "Role requires software integration; Sana specializes in plant engineering",
        "qualification_reason": "Domain mismatch",
        "qualified_at": "2026-11-02T16:05:00Z",
        "last_reverified_at": "2026-11-02T16:05:00Z",
        "score_breakdown": "{}"
    }
    item_sana = {
        "job": codex_job,
        "qualification": qual_sana
    }
    bridge.import_batch("sana_ansari", [item_sana])

    farhan_row = conn.execute("SELECT qualification_status FROM candidate_qualifications WHERE candidate_id = ? AND job_id = ?", ("farhan_shaikh", "job_disposable_101")).fetchone()
    sana_row = conn.execute("SELECT qualification_status FROM candidate_qualifications WHERE candidate_id = ? AND job_id = ?", ("sana_ansari", "job_disposable_101")).fetchone()
    
    assert farhan_row[0] == "READY_HIGH", f"Farhan qualification altered: {farhan_row[0]}"
    assert sana_row[0] == "INELIGIBLE", f"Sana qualification mismatch: {sana_row[0]}"
    print("   [PASS] Candidate isolation verified: Farhan is READY_HIGH, Sana is INELIGIBLE for the same job.")

    print("\n>>> All Disposable Staging Bridge Contract Tests Passed Successfully! <<<\n")

if __name__ == "__main__":
    try:
        test_bridge_contract_disposable_schema()
        sys.exit(0)
    except AssertionError as err:
        print(f"\n[FAILED] Bridge Contract Test Assertion Error: {err}")
        sys.exit(1)
    except Exception as exc:
        print(f"\n[ERROR] Bridge Contract Test Unexpected Error: {exc}")
        sys.exit(2)
