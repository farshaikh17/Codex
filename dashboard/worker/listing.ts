// Pure helpers for job listings: fit classes, role families, pay classes, READY/score conflict explanations and the India Remote
// listing (filter, facet counts, sort, pagination). No database access here, so every rule can be tested on plain rows.

// ---- Fit -------------------------------------------------------------------------------------------------------------
export const FIT_VALUES = ['READY', 'STRETCH', 'REVIEW', 'NOT_FIT'] as const;
export type Fit = (typeof FIT_VALUES)[number];
/** One mapping, used for the `farhan_fit` field, the filter and the counts. READY_HIGH is a READY status. */
export function fitOf(status: string | null | undefined): Fit {
  if (status === 'READY' || status === 'READY_HIGH') return 'READY';
  if (status === 'STRETCH_READY') return 'STRETCH';
  if (status === 'NEEDS_REVIEW') return 'REVIEW';
  return 'NOT_FIT';
}
/** SQL for the same mapping (alias q = candidate_qualifications). */
export const FIT_SQL: Record<Fit, string> = {
  READY: `q.qualification_status IN ('READY','READY_HIGH')`,
  STRETCH: `q.qualification_status = 'STRETCH_READY'`,
  REVIEW: `q.qualification_status = 'NEEDS_REVIEW'`,
  NOT_FIT: `q.qualification_status NOT IN ('READY','READY_HIGH','STRETCH_READY','NEEDS_REVIEW')`,
};

// ---- Pay -------------------------------------------------------------------------------------------------------------
export type Pay = 'PUBLISHED' | 'UNPUBLISHED';
/** null = no filter, undefined = unsupported value. UNKNOWN is accepted as the older name of UNPUBLISHED. */
export function parsePay(value: string | null): Pay | null | undefined {
  if (value === null || value === '' || value === 'ALL') return null;
  if (value === 'PUBLISHED') return 'PUBLISHED';
  if (value === 'UNPUBLISHED' || value === 'UNKNOWN') return 'UNPUBLISHED';
  return undefined;
}
export const PAY_SQL: Record<Pay, string> = {
  PUBLISHED: 'COALESCE(j.salary_published, 0) = 1',
  UNPUBLISHED: 'COALESCE(j.salary_published, 0) = 0',
};

// ---- Role family -----------------------------------------------------------------------------------------------------
// Derived from the posting TITLE only, by the first matching rule below. A title no rule matches has no family (null); the
// interface says "Unclassified" and never invents one.
export const ROLE_FAMILIES: { key: string; label: string; re: RegExp }[] = [
  { key: 'TECHNICAL_ACCOUNT', label: 'Technical account / customer success', re: /\btechnical account\b|\bcustomer success\b/i },
  { key: 'REVENUE_SYSTEMS', label: 'Revenue systems / RevOps', re: /\brevenue (systems|operations|technology)\b|\brevops\b|\bsales (systems|operations)\b|\bbilling (systems|operations|analyst|specialist)\b/i },
  { key: 'CRM_GTM', label: 'CRM / go-to-market systems', re: /\bcrm\b|\bsalesforce\b|\bhubspot\b|\bgo[- ]to[- ]market\b|\bgtm\b|\bmarketing (systems|operations|automation)\b/i },
  { key: 'AI_OPERATIONS', label: 'AI operations / systems', re: /\b(ai|llm|genai|machine learning)\b.*\b(operations|ops|systems|automation|implementation|solutions|deployment)\b|\b(operations|ops|systems|automation|implementation|solutions)\b.*\b(ai|llm|genai)\b/i },
  { key: 'AUTOMATION', label: 'Automation / workflows / integrations', re: /\bautomation\b|\bworkflows?\b|\bintegrations?\b|\bno[- ]code\b|\blow[- ]code\b/i },
  { key: 'POWER_ENERGY', label: 'Power / energy / electrical', re: /\b(power(?! (bi|apps?|automate|platform|query|pages|virtual agents?))|energy|electrical|substation|grid|utilit(y|ies)|renewables?|solar|wind|decarboni[sz]ation|transmission|switchgear)\b/i },
  { key: 'RELIABILITY_MAINTENANCE', label: 'Reliability / maintenance / plant', re: /\b(reliability|maintenance|asset (performance|management)|plant|scada|commissioning|o&m)\b/i },
  { key: 'SOLUTIONS', label: 'Solutions engineering / consulting', re: /\bsolutions?\b|\bpre-?sales\b|\bsales engineer\b|\bforward[- ]deployed\b/i },
  { key: 'IMPLEMENTATION', label: 'Implementation / technical delivery', re: /\bimplementation\b|\bonboarding\b|\bdeployment\b|\btechnical delivery\b|\bdelivery (manager|lead|specialist)\b|\bprofessional services\b/i },
  { key: 'TECHNICAL_OPERATIONS', label: 'Technical / business operations', re: /\b(technical|business|it|systems|platform|tech|support) operations?\b|\btech ops\b|(?<!\b(?:hr|people|finance|legal|facilities|logistics|warehouse|retail|store|hotel)\s)\boperations (manager|analyst|lead|specialist|engineer|associate)\b/i },
];
export const ROLE_FAMILY_KEYS = new Set(ROLE_FAMILIES.map((f) => f.key));
export const UNCLASSIFIED = 'UNCLASSIFIED';
export function roleFamilyOf(title: string | null | undefined): { key: string; label: string } | null {
  const t = String(title || '').slice(0, 200);   // titles come from external feeds: bound the work the rules can do
  for (const f of ROLE_FAMILIES) if (f.re.test(t)) return { key: f.key, label: f.label };
  return null;
}
export const validRoleFamily = (v: string) => v === 'ALL' || v === UNCLASSIFIED || ROLE_FAMILY_KEYS.has(v);

// ---- READY / score conflicts -----------------------------------------------------------------------------------------
/** Explains, never repairs: a recorded READY/STRETCH status next to a screening score that does not support it. */
export function assessmentConflict(r: {
  qualification_status?: string | null; overall_score?: number | null; strategy_lane?: string | null; manual_override_status?: string | null;
}, threshold: number | null | undefined): { conflict: boolean; reason: string | null } {
  const status = r.qualification_status || '';
  const ready = status === 'READY' || status === 'READY_HIGH', stretch = status === 'STRETCH_READY';
  if (!ready && !stretch) return { conflict: false, reason: null };
  const score = r.overall_score ?? 0;
  const why: string[] = [];
  if (!score) why.push('no preliminary score is stored for it');
  else if (ready && typeof threshold === 'number' && score < threshold) why.push(`its preliminary score is ${score}, below the qualification threshold of ${threshold}`);
  if (r.strategy_lane === 'NOT_FIT') why.push('its strategy lane is NOT_FIT');
  if (!why.length) return { conflict: false, reason: null };
  const source = r.manual_override_status ? 'was set by a human decision' : 'comes from the qualification review';
  return {
    conflict: true,
    reason: `The recorded status ${ready ? 'READY' : 'STRETCH_READY'} ${source}, but ${why.join(' and ')}. The status and the score are shown exactly as recorded; the score is a separate screening figure and has not been changed to match the status.`,
  };
}

// ---- India Remote listing --------------------------------------------------------------------------------------------
export type LightRow = { id: string; title: string; company: string | null; discovered_at: string | null; pub: number; status: string; score: number; app_status: string | null };
export type ListingFilter = { fit: 'ALL' | Fit; family: string; pay: Pay | null; excludeApplied: boolean; sort: string; limit: number; offset: number };
export const SORTS = ['score_desc', 'date_desc', 'title_asc', 'company_asc'];

type Attr = { row: LightRow; fit: Fit; family: { key: string; label: string } | null; pay: Pay; applied: boolean };
const attrOf = (row: LightRow): Attr => ({
  row, fit: fitOf(row.status), family: roleFamilyOf(row.title), pay: row.pub ? 'PUBLISHED' : 'UNPUBLISHED',
  applied: !(row.app_status === null || row.app_status === undefined || row.app_status === 'SAVED'),
});
const cmp = (a: string | null | undefined, b: string | null | undefined) => String(a ?? '').localeCompare(String(b ?? ''));
function sortRows(list: Attr[], sort: string): Attr[] {
  const byId = (x: Attr, y: Attr) => cmp(x.row.id, y.row.id);
  const key: Record<string, (x: Attr, y: Attr) => number> = {
    score_desc: (x, y) => (y.row.score - x.row.score) || cmp(y.row.discovered_at, x.row.discovered_at),
    date_desc: (x, y) => cmp(y.row.discovered_at, x.row.discovered_at),
    title_asc: (x, y) => cmp(x.row.title, y.row.title),
    company_asc: (x, y) => cmp(x.row.company, y.row.company),
  };
  const first = key[sort] || key.score_desc;
  return [...list].sort((x, y) => first(x, y) || byId(x, y));
}

/** Applies the filters, returns the page of ids plus facet counts. A facet counts the rows that pass every OTHER filter, so
 *  the number beside an option is what choosing it would show (same predicate, same scope as the list). */
export function listIndiaRemote(rows: LightRow[], f: ListingFilter) {
  const all = rows.map(attrOf);
  const base = (a: Attr) => !(f.excludeApplied && a.applied);
  const okFit = (a: Attr) => f.fit === 'ALL' || a.fit === f.fit;
  const okFamily = (a: Attr) => f.family === 'ALL' || (f.family === UNCLASSIFIED ? a.family === null : a.family?.key === f.family);
  const okPay = (a: Attr) => f.pay === null || a.pay === f.pay;
  const matching = all.filter((a) => base(a) && okFit(a) && okFamily(a) && okPay(a));
  const fit: Record<string, number> = { ALL: 0, READY: 0, STRETCH: 0, REVIEW: 0, NOT_FIT: 0 };
  const pay: Record<string, number> = { ALL: 0, PUBLISHED: 0, UNPUBLISHED: 0 };
  const family = new Map<string, { key: string; label: string; count: number }>();
  for (const a of all) {
    if (!base(a)) continue;
    if (okFamily(a) && okPay(a)) { fit.ALL++; fit[a.fit]++; }
    if (okFit(a) && okFamily(a)) { pay.ALL++; pay[a.pay]++; }
    if (okFit(a) && okPay(a)) {
      const k = a.family?.key ?? UNCLASSIFIED;
      const e = family.get(k) || { key: k, label: a.family?.label ?? 'Unclassified', count: 0 };
      e.count++; family.set(k, e);
    }
  }
  const order = [...ROLE_FAMILIES.map((x) => x.key), UNCLASSIFIED];
  const families = order.filter((k) => family.has(k)).map((k) => family.get(k)!);
  const sorted = sortRows(matching, f.sort);
  return { total: sorted.length, ids: sorted.slice(f.offset, f.offset + f.limit).map((a) => a.row.id), facets: { fit, pay, role_family: families } };
}
