"""
Automated Recurring GitHub Collector to Dashboard D1 Importer
=============================================================

This module implements the recurring collector-to-dashboard ingestion pipeline.
It bridges external public collector feeds (or local collected artifacts) into
Cloudflare D1, strictly adhering to release specifications:
1. Employer Identity Preservation: Maps employer_name, company, or normalized board name.
2. Source Evidence & Provenance: Records source_adapter, source_channel='GITHUB_COLLECTOR',
   and provenance='GITHUB_PUBLIC_DISCOVERY'.
3. Candidate Separation: Imports unassessed postings into candidate_qualifications for
   BOTH candidates ('farhan_shaikh' and 'sana_ansari') independently without cross-leakage.
4. Unassessed Qualification Integrity: Unassessed discoveries enter 'NEEDS_REVIEW' with
   strategy_lane='UNASSIGNED', eligibility_status='UNKNOWN', overall_score=0, and
   transparent reason: 'Automated public discovery; unassessed review pending'.
   NO fabricated scores or match claims are generated.
5. Human Decision & Application Protection: Existing human overrides (manual_override_status),
   active applications, or historical qualification records are strictly preserved on repeat runs.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Any, Optional

# Ensure release tree is in path
CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from engine.staging_bridge import D1StagingBridge, codex_to_d1_job

CANDIDATES = ["farhan_shaikh", "sana_ansari"]


def build_unassessed_qualification(
    candidate_id: str,
    job_id: str,
    source_name: str,
    observed_at: Optional[str] = None
) -> Dict[str, Any]:
    """
    Constructs a clean, unassessed qualification record entering NEEDS_REVIEW
    without fabricated scores or eligibility assertions.
    """
    now_iso = observed_at or datetime.now(timezone.utc).isoformat()
    return {
        "candidate_id": candidate_id,
        "job_id": job_id,
        "qualification_status": "NEEDS_REVIEW",
        "strategy_lane": "UNASSIGNED",
        "eligibility_status": "UNKNOWN",
        "eligibility_reason": f"Automated collector discovery from {source_name}; employer availability and geographic eligibility unverified",
        "qualification_reason": f"[GITHUB_COLLECTOR] Unassessed public ATS posting from {source_name}; review pending",
        "manual_override_status": None,
        "manual_override_reason": None,
        "qualified_at": now_iso,
        "last_reverified_at": now_iso,
        "overall_score": 0,
        "score_breakdown": json.dumps({
            "source": "github_public_collector",
            "state": "UNASSESSED",
            "source_name": source_name,
            "overall_score": 0,
            "why": "Unassessed discovery requiring candidate review",
            "evaluated_at": now_iso
        })
    }


def import_collector_postings(
    postings: List[Dict[str, Any]],
    mode: str = "local",
    cwd: Optional[str] = None,
    target_candidates: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Imports a list of normalized collector postings into D1 for the target candidates.
    """
    bridge = D1StagingBridge(mode=mode, cwd=cwd or str(REPO_ROOT))
    candidates = target_candidates or CANDIDATES
    
    total_jobs = len(postings)
    summary = {
        "status": "SUCCESS",
        "input_postings_count": total_jobs,
        "candidate_results": {},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    for cand in candidates:
        batch = []
        for post in postings:
            # post contains 'key', 'title', 'board', 'url', 'locations', etc.
            key = post.get("key")
            if not key:
                continue
            
            source_name = post.get("board") or post.get("provider") or "public_collector"
            decision_record = build_unassessed_qualification(cand, key, source_name, post.get("observed_at"))
            
            batch.append({
                "job": post,
                "qualification": decision_record
            })
        
        if batch:
            res = bridge.import_batch(cand, batch)
            summary["candidate_results"][cand] = res
        else:
            summary["candidate_results"][cand] = {"status": "EMPTY", "jobs_imported": 0}
            
    return summary


def run_collector_import(
    collector_dir_or_file: str,
    mode: str = "local",
    cwd: Optional[str] = None,
    limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Reads collector index or board files and invokes the automated import into D1.
    """
    path = Path(collector_dir_or_file)
    postings = []
    
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            postings = data
        elif isinstance(data, dict):
            if "jobs" in data:
                postings = data["jobs"]
            elif "key" in data:
                postings = [data]
    elif path.is_dir():
        # Check for public/index.json or public/boards
        index_file = path / "public" / "index.json"
        if not index_file.exists():
            index_file = path / "index.json"
            
        if index_file.exists():
            index_data = json.loads(index_file.read_text(encoding="utf-8"))
            # Index has job summaries; read boards for full details if available
            boards_dir = path / "public" / "boards"
            if not boards_dir.exists():
                boards_dir = path / "boards"
                
            if boards_dir.exists():
                for bf in boards_dir.glob("*.json"):
                    bdata = json.loads(bf.read_text(encoding="utf-8"))
                    postings.extend(bdata.get("jobs", []))
            else:
                postings = index_data.get("jobs", [])
    
    # Deduplicate postings by key
    seen = set()
    deduped = []
    for p in postings:
        k = p.get("key")
        if k and k not in seen:
            seen.add(k)
            deduped.append(p)
            
    if limit is not None:
        if limit <= 0:
            raise ValueError(f"Invalid limit: {limit}. Limit must be a strictly positive integer.")
        deduped = deduped[:limit]
        print(f"[Collector Importer] Bounded import active: clamped to maximum {limit} postings.")

    print(f"[Collector Importer] Loaded {len(deduped)} unique postings from {collector_dir_or_file}")
    res = import_collector_postings(deduped, mode=mode, cwd=cwd)
    return res


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recurring GitHub Collector to D1 Dashboard Importer")
    parser.add_argument("--source", type=str, required=True, help="Path to collector repo, public directory, or JSON file")
    parser.add_argument("--mode", type=str, default="local", choices=["local", "remote"], help="Wrangler execution mode")
    parser.add_argument("--cwd", type=str, default=str(REPO_ROOT), help="Working directory containing wrangler.toml")
    def positive_int(value):
        try:
            ivalue = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError(f"Limit must be an integer, got '{value}'")
        if ivalue <= 0:
            raise argparse.ArgumentTypeError(f"Limit must be a strictly positive integer, got {value}")
        return ivalue

    parser.add_argument("--limit", type=positive_int, default=None, help="Maximum number of postings to import in this run (must be > 0)")
    args = parser.parse_args()

    result = run_collector_import(args.source, mode=args.mode, cwd=args.cwd, limit=args.limit)
    print(json.dumps(result, indent=2))
