import hashlib
import json
import os
import sqlite3
import subprocess
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
    apply_url = job.get('apply_url') or source_url
    
    wp_raw = (job.get('workplace_type') or '').lower()
    if 'remote' in wp_raw:
        workplace_type = 'REMOTE'
    elif 'hybrid' in wp_raw:
        workplace_type = 'HYBRID'
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
        'overall_score': fit,
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
            return self.executor(sql_content)

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
            if start != -1:
                return json.loads(out[start:])
            return []
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def import_batch(self, candidate_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        if candidate_id not in VALID_CODEX_CANDIDATE_IDS and candidate_id not in VALID_CLOUDFLARE_CANDIDATE_IDS:
            raise ValueError(f"Invalid candidate identifier: {candidate_id}")
        
        cf_candidate_id = CODEX_TO_CLOUDFLARE_CANDIDATE.get(candidate_id, candidate_id)
        statements = ["BEGIN TRANSACTION;"]

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
                d1_qual = codex_to_d1_qualification(candidate_id, d1_job['id'], dec)

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
                is_active = 1;"""
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
                last_reverified_at = excluded.last_reverified_at;"""
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
                calculated_at = excluded.calculated_at;"""
            statements.append(score_sql)

            jobs_imported += 1
            quals_updated += 1

        statements.append("COMMIT;")
        self._execute_sql_file("\n".join(statements))
        return {
            'candidate_id': cf_candidate_id,
            'jobs_imported': jobs_imported,
            'qualifications_processed': quals_updated,
            'status': 'SUCCESS'
        }
