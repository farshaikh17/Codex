// The link a person opens for a posting. Pure: no I/O, the same answer at import (scripts/posting_urls.mjs) and when the Worker serves a row.
//
// Oracle Recruiting Cloud: the ATS dataset stores a posting as https://<host>/?keyword=&mode=jobs&lang=en&site_number=<site>#<id>. That
// address answers with a redirect to the Fusion application home page, not to the job. The candidate site's own posting page is
// https://<host>/hcmUI/CandidateExperience/en/sites/<site>/job/<id>, which opens the posting. Every other URL is returned unchanged.
const ORACLE_SITE = /^[A-Za-z0-9_.-]{1,60}$/;
const ORACLE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function postingUrl<T>(value: T): T | string {
  if (typeof value !== 'string' || !value.includes('oraclecloud.com')) return value;
  let u: URL;
  try { u = new URL(value); } catch { return value; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || !host.endsWith('.oraclecloud.com') || u.username || u.password || u.port) return value;
  if (u.pathname !== '/' && u.pathname !== '') return value;   // already a page of the career site (or something else): left alone
  const site = u.searchParams.get('site_number') || '';
  let id = '';
  try { id = decodeURIComponent(u.hash.slice(1)); } catch { return value; }
  if (!ORACLE_SITE.test(site) || !ORACLE_ID.test(id)) return value;
  return `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${id}`;
}
