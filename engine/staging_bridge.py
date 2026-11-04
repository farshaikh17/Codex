import hashlib
import json
import os
import sqlite3
import subprocess

import urllib.parse
import re

def normalize_posting_url(raw_url: str) -> str:
    if not raw_url:
        return ''
    raw_url = raw_url.strip()
    lever_match = re.search(r'jobs\.lever\.co/([^/]+)/([a-f0-9\-]+)', raw_url)
    if lever_match:
        return f'https://jobs.lever.co/{lever_match.group(1)}/{lever_match.group(2)}'
    parsed = urllib.parse.urlparse(raw_url)
    path = parsed.path
    if path.endswith('/apply'):
        path = path[:-6]
    elif path.endswith('/apply/'):
        path = path[:-7]
    drop_prefixes = ('utm_', 'gh_src', 'lever-', 'ref', 'source', 'rb', 'sid')
    query_parts = urllib.parse.parse_qsl(parsed.query, keep_blank_values=False)
    filtered_parts = [(k, v) for k, v in query_parts if not any(k.lower().startswith(prefix) for prefix in drop_prefixes)]
    new_query = urllib.parse.urlencode(filtered_parts)
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path.rstrip('/'), '', new_query, ''))

import tempfile
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional, Callable

VALID_CODEX_CANDIDATE_IDS = frozenset(['farhan', 'sana'])
VALID_CLOUDFLARE_CANDIDATE_IDS = frozenset(['farhan_shaikh', 'sana_ansari'])

CODEX_TO_CLOUDFLARE_CANDIDATE = {
    'farhan': 'farhan_shaikh',
    'sana': 'sana_ansari'
}

CLOUDFLARE_TO_CODEX_CANDIDATE = {
    'farhan_shaikh': 'farhan',
    'sana_ansari': 'sana'
}


def codex_to_d1_job(job: Dict[str, Any], observed_at: Optional[str] = None) -> Dict[str, Any]:
    job_id = job.get('key')
    if not job_id:
        raise ValueError("Job missing mandatory 'key'")
    
    title = job.get('title') or 'Untitled'
    # Preserve employer identity: employer_name, company, or board name (e.g. Drivetrain, GitLab)
    board_name = job.get('board')
    if board_name and isinstance(board_name, str):
        board_display = board_name.replace('-', ' ').title()
    else:
        board_display = None
    company = job.get('employer_name') or job.get('company') or board_display or 'Unknown'
    source_url = job.get('url') or ''
    apply_url = normalize_posting_url(job.get('apply_url') or source_url)
    
    wp_raw = (job.get('workplace_type') or '').lower()
    desc_raw = (job.get('description') or '').lower()
    loc_raw = (str(job.get('locations') or '')).lower()
    
    # Check for explicit hybrid patterns in description or location text
    # e.g., '3 days in the office per week', 'hybrid work model', 'hybrid schedule'
    has_hybrid_mandate = bool(
        re.search(r'\b\d+\s*days?\s+(?:a|per)?\s*week\s+in\s+(?:the\s+)?office\b', desc_raw) or
        re.search(r'\bhybrid\s+(?:work\s+model|schedule|environment|setup|role|model)\b', desc_raw) or
        'hybrid' in loc_raw
    )

    if 'hybrid' in wp_raw or has_hybrid_mandate:
        workplace_type = 'HYBRID'
    elif 'remote' in wp_raw:
        workplace_type = 'REMOTE'
    elif 'onsite' in wp_raw or 'on-site' in wp_raw:
        workplace_type = 'ONSITE'
    else:
        workplace_type = 'REMOTE_RESTRICTED'

    locs = job.get('locations') or []
    loc_texts = []
    for l in locs:
        if isinstance(l, dict):
            loc_texts.append(l.get('text', ''))
        elif isinstance(l, str):
            loc_texts.append(l)
    location_restrictions = ", ".join(filter(None, loc_texts)) or None

    desc = job.get('description')
    if desc is not None:
        content_sha256 = hashlib.sha256(desc.encode('utf-8')).hexdigest()
    else:
        content_sha256 = None

    source_adapter = str(job.get('_source') or job.get('provider') or 'github_discovery')
    discovered_at = observed_at or job.get('observed_at') or datetime.now(timezone.utc).isoformat()

    # Salary fields
    salary_raw = job.get('compensation_raw') or job.get('salary_raw_text')
    if job.get('salary_published') is not None:
        salary_published = int(job.get('salary_published'))
    else:
        salary_published = 1 if salary_raw else 0
    salary_min = job.get('salary_min')
    salary_max = job.get('salary_max')
    salary_currency = job.get('salary_currency')
    salary_period = job.get('salary_period')

    return {
        'id': job_id,
        'title': title,
        'company': company,
        'company_url': job.get('company_url'),
        'company_headquarters': job.get('company_headquarters'),
        'source_adapter': source_adapter,
        'source_url': source_url,
        'original_posting_url': apply_url,
        'employment_type': job.get('employment_type') or 'full_time',
        'workplace_type': workplace_type,
        'location_restrictions': location_restrictions,
        'description': desc,
        'required_skills': json.dumps(job.get('required_skills') or []),
        'salary_published': salary_published,
        'salary_raw_text': salary_raw,
        'salary_min': salary_min,
        'salary_max': salary_max,
        'salary_currency': salary_currency,
        'salary_period': salary_period,
        'discovered_at': discovered_at,
        'last_verified_at': discovered_at,
        'is_active': 1,
        'content_sha256': content_sha256,
        'source_id': job.get('req_id') or job.get('id'),
        'source_channel': 'GITHUB_COLLECTOR',
        'provenance': 'GITHUB_PUBLIC_DISCOVERY'
    }


def codex_to_d1_qualification(
    candidate_id: str,
    job_id: str,
    decision: Dict[str, Any],
    qualified_at: Optional[str] = None
) -> Dict[str, Any]:
    if candidate_id not in VALID_CODEX_CANDIDATE_IDS and candidate_id not in VALID_CLOUDFLARE_CANDIDATE_IDS:
        raise ValueError(f"Invalid candidate identifier: {candidate_id}")
    
    cf_candidate_id = CODEX_TO_CLOUDFLARE_CANDIDATE.get(candidate_id, candidate_id)
    raw_state = decision.get('state') or 'NEEDS_REVIEW'

    # Check gates
    gates = decision.get('gates') or {}
    geo_gate = gates.get('geography') or {}
    
    # 1. Geography Eligibility determination
    if geo_gate.get('result') == 'pass':
        eligibility_status = 'ELIGIBLE'
    elif geo_gate.get('result') == 'fail':
        eligibility_status = 'INELIGIBLE'
    else:
        eligibility_status = 'UNKNOWN'

    # 2. Qualification status mapping
    if raw_state == 'READY':
        qualification_status = 'READY'
    elif raw_state == 'STRETCH_READY':
        qualification_status = 'STRETCH_READY'
    elif raw_state in ('REJECT', 'INELIGIBLE'):
        if eligibility_status == 'INELIGIBLE':
            qualification_status = 'INELIGIBLE'
        else:
            qualification_status = 'HOLD'
    elif raw_state in ('SCREENED', 'PAY_UNKNOWN', 'NEEDS_REVIEW', 'EXPERIENCE_GAP'):
        qualification_status = 'NEEDS_REVIEW'
    elif raw_state == 'HOLD':
        qualification_status = 'HOLD'
    else:
        qualification_status = 'NEEDS_REVIEW'

    eligibility_reason = geo_gate.get('reason') or 'Automated gate assessment'
    qualification_reason = f"[GITHUB_PIPELINE raw_state={raw_state}] {decision.get('why') or ''}".strip()

    fit = decision.get('fit', 0)
    explicit_lane = decision.get('lane') or decision.get('strategy_lane')
    if explicit_lane and explicit_lane in ('STRONGEST_FIT', 'BRIDGE', 'DREAM', 'TECHNICAL_FIT', 'LEADERSHIP_FIT', 'NOT_FIT', 'UNASSIGNED'):
        strategy_lane = explicit_lane
    else:
        if fit >= 40:
            strategy_lane = 'STRONGEST_FIT'
        elif fit >= 20:
            strategy_lane = 'BRIDGE'
        elif fit > 0:
            strategy_lane = 'DREAM'
        else:
            strategy_lane = 'UNASSIGNED'

    q_time = qualified_at or decision.get('observed_at') or datetime.now(timezone.utc).isoformat()

    score_breakdown = {
        'source': 'codex_github_pipeline',
        'raw_state': raw_state,
        'why': decision.get('why'),
        'fit': fit,
        'gates': gates,
        'skills_matched': decision.get('skills_matched') or [],
        'evaluated_at': q_time
    }

    return {
        'candidate_id': cf_candidate_id,
        'job_id': job_id,
        'qualification_status': qualification_status,
        'strategy_lane': strategy_lane,
        'eligibility_status': eligibility_status,
        'eligibility_reason': eligibility_reason,
        'qualification_reason': qualification_reason,
        'manual_override_status': None,
        'manual_override_reason': None,
        'qualified_at': q_time,
        'last_reverified_at': q_time,
        'overall_score': int(decision.get('overall_score') or fit or 0),
        'score_breakdown': json.dumps(score_breakdown)
    }


class D1StagingBridge:
    def __init__(
        self,
        mode: str = "local",
        cwd: str = r"C:\Users\admin\Documents\ChatGPT\Business\deployment\cloud-deploy-final",
        executor: Optional[Callable[[str], Any]] = None
    ):
        self.mode = mode
        self.cwd = cwd
        self.executor = executor

    def _execute_sql_file(self, sql_content: str) -> List[Dict[str, Any]]:
        if self.executor is not None:
            res = self.executor(sql_content)
            if not isinstance(res, list) or len(res) == 0:
                raise RuntimeError('Malformed D1 response: Returned empty or non-list JSON payload')
            for entry in res:
                if isinstance(entry, dict) and entry.get('success') is False:
                    raise RuntimeError(f'D1 execution reported statement failure: {entry}')
            return res

        with tempfile.NamedTemporaryFile(suffix='.sql', delete=False, mode='w', encoding='utf-8') as tf:
            tf.write(sql_content)
            temp_path = tf.name

        try:
            is_windows = os.name == 'nt'
            cmd = ["cmd.exe", "/c", "npx"] if is_windows else ["npx"]
            cmd.extend(["wrangler", "d1", "execute", "career-job-engine"])
            if self.mode == "remote":
                cmd.append("--remote")
            else:
                cmd.append("--local")
            cmd.extend([f"--file={temp_path}", "--json"])

            res = subprocess.run(cmd, cwd=self.cwd, capture_output=True, text=True, encoding='utf-8', errors='replace', check=False)
            if res.returncode != 0:
                raise RuntimeError(f"D1 execute failed (code {res.returncode}): {res.stderr}\nSTDOUT: {res.stdout}")

            out = res.stdout.strip()
            start = out.find('[')
            if start == -1:
                raise RuntimeError(f"Malformed or empty D1 response: No JSON array found in stdout.\nSTDOUT: {res.stdout}")

            try:
                parsed = json.loads(out[start:])
            except Exception as e:
                raise RuntimeError(f"Failed to parse D1 execute JSON output: {e}\nRAW OUTPUT: {out[start:]}")

            if not isinstance(parsed, list) or len(parsed) == 0:
                raise RuntimeError("Malformed D1 response: Returned empty or non-list JSON payload")

            for entry in parsed:
                if isinstance(entry, dict) and entry.get("success") is False:
                    raise RuntimeError(f"D1 execution reported statement failure: {entry}")

            return parsed
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def import_batch(self, candidate_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        if candidate_id not in VALID_CODEX_CANDIDATE_IDS and candidate_id not in VALID_CLOUDFLARE_CANDIDATE_IDS:
            raise ValueError(f"Invalid candidate identifier: {candidate_id}")
        
        cf_candidate_id = CODEX_TO_CLOUDFLARE_CANDIDATE.get(candidate_id, candidate_id)
        # Cloudflare D1 batch import API executes the SQL file atomically as a single transaction.
        # Explicit BEGIN TRANSACTION or COMMIT statements trigger SQLite error code 7500.
        statements = []

        jobs_imported = 0
        quals_updated = 0

        def esc(s):
            if s is None: return "NULL"
            return "'" + str(s).replace("'", "''") + "'"

        def num(n):
            if n is None: return "NULL"
            return str(n)

        for item in items:
            job = item['job']
            if 'qualification' in item:
                d1_qual = item['qualification']
                d1_job = codex_to_d1_job(job)
            else:
                dec = item.get('decision') or {}
                d1_job = codex_to_d1_job(job)
                observed = d1_job.get('discovered_at')
                d1_qual = codex_to_d1_qualification(candidate_id, d1_job['id'], dec, qualified_at=observed)

            # Resolve canonical job identity across different source IDs (by matching original_posting_url or source_url)
            src_url = d1_job['source_url']
            orig_url = d1_job['original_posting_url']
            url_match_conditions = []
            if orig_url:
                url_match_conditions.append(f"original_posting_url = {esc(orig_url)}")
                url_match_conditions.append(f"source_url = {esc(orig_url)}")
            if src_url and src_url != orig_url:
                url_match_conditions.append(f"original_posting_url = {esc(src_url)}")
                url_match_conditions.append(f"source_url = {esc(src_url)}")

            url_clause = f"OR ({' OR '.join(url_match_conditions)})" if url_match_conditions else ""
            target_lookup = f"""COALESCE(
                (SELECT id FROM jobs WHERE id = {esc(d1_job['id'])} {url_clause} LIMIT 1),
                {esc(d1_job['id'])}
            )"""

            j_sql = f"""INSERT INTO jobs (
                id, title, company, company_url, company_headquarters, source_adapter,
                source_url, original_posting_url, employment_type, workplace_type,
                location_restrictions, description, required_skills, salary_published,
                salary_raw_text, salary_min, salary_max, salary_currency, salary_period,
                discovered_at, last_verified_at, is_active, content_sha256, source_id,
                source_channel, provenance
            ) SELECT
                {target_lookup}, {esc(d1_job['title'])}, {esc(d1_job['company'])},
                {esc(d1_job['company_url'])}, {esc(d1_job['company_headquarters'])},
                {esc(d1_job['source_adapter'])}, {esc(d1_job['source_url'])},
                {esc(d1_job['original_posting_url'])}, {esc(d1_job['employment_type'])},
                {esc(d1_job['workplace_type'])}, {esc(d1_job['location_restrictions'])},
                {esc(d1_job['description'])}, {esc(d1_job['required_skills'])},
                {d1_job['salary_published']}, {esc(d1_job['salary_raw_text'])},
                {num(d1_job['salary_min'])}, {num(d1_job['salary_max'])},
                {esc(d1_job['salary_currency'])}, {esc(d1_job['salary_period'])},
                {esc(d1_job['discovered_at'])}, {esc(d1_job['last_verified_at'])},
                1, {esc(d1_job['content_sha256'])}, {esc(d1_job['source_id'])},
                {esc(d1_job['source_channel'])}, {esc(d1_job['provenance'])}
            ON CONFLICT(id) DO UPDATE SET
                title = COALESCE(NULLIF(excluded.title, ''), jobs.title),
                company = COALESCE(NULLIF(excluded.company, ''), jobs.company),
                company_url = COALESCE(NULLIF(excluded.company_url, ''), jobs.company_url),
                company_headquarters = COALESCE(NULLIF(excluded.company_headquarters, ''), jobs.company_headquarters),
                original_posting_url = COALESCE(NULLIF(excluded.original_posting_url, ''), jobs.original_posting_url),
                workplace_type = CASE 
                    WHEN excluded.workplace_type IS NOT NULL AND excluded.workplace_type != '' AND excluded.workplace_type != 'REMOTE_RESTRICTED' THEN excluded.workplace_type 
                    ELSE jobs.workplace_type 
                END,
                location_restrictions = COALESCE(NULLIF(excluded.location_restrictions, ''), jobs.location_restrictions),
                description = CASE 
                    WHEN excluded.description IS NOT NULL AND excluded.description != '' THEN excluded.description 
                    ELSE jobs.description 
                END,
                content_sha256 = CASE 
                    WHEN excluded.description IS NOT NULL AND excluded.description != '' THEN excluded.content_sha256 
                    ELSE jobs.content_sha256 
                END,
                salary_published = CASE 
                    WHEN excluded.salary_published = 1 THEN 1 
                    ELSE jobs.salary_published 
                END,
                salary_raw_text = COALESCE(NULLIF(excluded.salary_raw_text, ''), jobs.salary_raw_text),
                salary_min = COALESCE(excluded.salary_min, jobs.salary_min),
                salary_max = COALESCE(excluded.salary_max, jobs.salary_max),
                salary_currency = COALESCE(NULLIF(excluded.salary_currency, ''), jobs.salary_currency),
                salary_period = COALESCE(NULLIF(excluded.salary_period, ''), jobs.salary_period),
                last_verified_at = excluded.last_verified_at,
                is_active = 1
            WHERE jobs.content_sha256 IS NOT excluded.content_sha256
               OR jobs.title IS NOT excluded.title
               OR jobs.company IS NOT excluded.company
               OR jobs.original_posting_url IS NOT excluded.original_posting_url
               OR jobs.workplace_type IS NOT excluded.workplace_type
               OR jobs.location_restrictions IS NOT excluded.location_restrictions
               OR jobs.is_active IS NOT 1;"""
            statements.append(j_sql)

            q_sql = f"""INSERT INTO candidate_qualifications (
                candidate_id, job_id, qualification_status, strategy_lane,
                eligibility_status, eligibility_reason, qualification_reason,
                manual_override_status, manual_override_reason, qualified_at,
                last_reverified_at
            ) SELECT
                {esc(d1_qual['candidate_id'])}, {target_lookup},
                {esc(d1_qual['qualification_status'])}, {esc(d1_qual['strategy_lane'])},
                {esc(d1_qual['eligibility_status'])}, {esc(d1_qual['eligibility_reason'])},
                {esc(d1_qual['qualification_reason'])}, NULL, NULL,
                {esc(d1_qual['qualified_at'])}, {esc(d1_qual['last_reverified_at'])}
            ON CONFLICT(candidate_id, job_id) DO UPDATE SET
                qualification_status = CASE
                    WHEN candidate_qualifications.manual_override_status IS NOT NULL THEN candidate_qualifications.qualification_status
                    WHEN candidate_qualifications.qualification_status = 'APPLIED' THEN candidate_qualifications.qualification_status
                    WHEN EXISTS (SELECT 1 FROM applications WHERE candidate_id = candidate_qualifications.candidate_id AND job_id = candidate_qualifications.job_id) THEN candidate_qualifications.qualification_status
                    ELSE excluded.qualification_status
                END,
                strategy_lane = CASE
                    WHEN candidate_qualifications.manual_override_status IS NOT NULL THEN candidate_qualifications.strategy_lane
                    ELSE excluded.strategy_lane
                END,
                eligibility_status = CASE
                    WHEN candidate_qualifications.manual_override_status IS NOT NULL THEN candidate_qualifications.eligibility_status
                    ELSE excluded.eligibility_status
                END,
                eligibility_reason = CASE
                    WHEN candidate_qualifications.manual_override_status IS NOT NULL THEN candidate_qualifications.eligibility_reason
                    ELSE excluded.eligibility_reason
                END,
                qualification_reason = CASE
                    WHEN candidate_qualifications.manual_override_status IS NOT NULL THEN candidate_qualifications.qualification_reason
                    ELSE excluded.qualification_reason
                END,
                last_reverified_at = excluded.last_reverified_at
            WHERE candidate_qualifications.qualification_status IS NOT excluded.qualification_status
               OR candidate_qualifications.strategy_lane IS NOT excluded.strategy_lane
               OR candidate_qualifications.eligibility_status IS NOT excluded.eligibility_status
               OR candidate_qualifications.qualification_reason IS NOT excluded.qualification_reason;"""
            statements.append(q_sql)

            score_sql = f"""INSERT INTO candidate_job_scores (
                candidate_id, job_id, overall_score, skill_score, role_score,
                strategy_lane, score_breakdown, calculated_at
            ) SELECT
                {esc(d1_qual['candidate_id'])}, {target_lookup},
                {d1_qual['overall_score']}, 0, 0,
                {esc(d1_qual['strategy_lane'])}, {esc(d1_qual['score_breakdown'])},
                {esc(d1_qual['last_reverified_at'])}
            ON CONFLICT(candidate_id, job_id) DO UPDATE SET
                overall_score = excluded.overall_score,
                strategy_lane = excluded.strategy_lane,
                score_breakdown = excluded.score_breakdown,
                calculated_at = excluded.calculated_at
            WHERE candidate_job_scores.overall_score IS NOT excluded.overall_score
               OR candidate_job_scores.strategy_lane IS NOT excluded.strategy_lane
               OR candidate_job_scores.score_breakdown IS NOT excluded.score_breakdown;"""
            statements.append(score_sql)

            jobs_imported += 1
            quals_updated += 1

        d1_response = None
        rows_actually_changed = 0
        rows_written = 0
        rows_read = 0
        status = 'SUCCESS'
        error_message = None

        if statements:
            try:
                exec_res = self._execute_sql_file("\n".join(statements))
                d1_response = exec_res
                # Check D1 response objects for success and actual row mutations
                if isinstance(exec_res, list) and len(exec_res) > 0:
                    first = exec_res[0]
                    if not first.get("success", False):
                        status = "FAILED"
                        error_message = first.get("error") or "D1 execution returned success=False"
                    meta = first.get("meta", {})
                    rows_actually_changed = meta.get("changes", 0)
                    rows_written = meta.get("rows_written", 0)
                    rows_read = meta.get("rows_read", 0)
            except Exception as e:
                status = "FAILED"
                error_message = str(e)

        if status != 'SUCCESS':
            raise RuntimeError(f"D1 batch import failed for {cf_candidate_id}: {error_message}")

        return {
            'candidate_id': cf_candidate_id,
            'attempted_postings': jobs_imported,
            'attempted_qualifications': quals_updated,
            'rows_actually_changed': rows_actually_changed,
            'rows_written': rows_written,
            'rows_read': rows_read,
            'status': status,
            'error': error_message,
            'd1_response': d1_response
        }

