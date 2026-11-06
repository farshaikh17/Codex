// Small durable work units. No application/history writes and no model/API fees.
import { isBroad, broadURL, broadPage, normalizeBroad } from './broad-feeds.ts';
export const RULE_VERSION = 'cloud-conservative-review-1';
const PAGE = 10, MAX_BYTES = 512 * 1024, DAY_JOBS = 120, DAY_SOURCES = 48;
type DB = D1Database;
type Source = {id:string;kind:string;slug:string;name:string;cursor:number;failures:number;cursor_token?:string;cursor_started_at?:number};
export type Posting = {id:string;title:string;url:string;location:string;description:string;remote:boolean;salary?:any;company?:string;board?:boolean;observedAt?:string;sourceLabel?:string};
const iso = () => new Date().toISOString();
const epoch = () => Math.floor(Date.now()/1000);
const plain = (s:any) => String(s || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
const list = (s:any):string[] => {try{return Array.isArray(s)?s:JSON.parse(s||'[]')}catch{return []}};
export const relevant = (title:string) => /operations|implementation|integration|automation|business systems|crm|revops|solutions|technical delivery|electrical|power|energy|reliability|maintenance|plant|commissioning|switchgear|scada|utilities|asset performance|decarbon/i.test(title);
function officialURL(url:string) {
 try { const u=new URL(url); return u.protocol==='https:' && /(^|\.)(lever\.co|greenhouse\.io|smartrecruiters\.com|ashbyhq\.com)$/.test(u.hostname); }catch{return false;}
}
// Greenhouse's absolute_url is often the EMPLOYER's own careers page (for example https://jobs.example.com/jobs?gh_jid=123), which is a
// valid posting but not on an applicant-tracking host. Rather than discard it, the application link falls back to the posting's canonical
// page on Greenhouse itself, built only from the source slug and the posting id (never from posting text).
export function greenhouseBoardURL(slug:string,id:any){return `https://boards.greenhouse.io/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(String(id))}`;}
export function sourceURL(s:Source, detail?:string) {
 if(isBroad(s.kind))return broadURL(s,detail);
 const slug=encodeURIComponent(s.slug), id=detail?encodeURIComponent(detail):'';
 if(s.kind==='lever')return `https://api.lever.co/v0/postings/${slug}${id?'/'+id:`?mode=json&skip=${s.cursor}&limit=${PAGE}`}`;
 if(s.kind==='greenhouse')return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs${id?'/'+id:''}`;
 if(s.kind==='smartrecruiters')return `https://api.smartrecruiters.com/v1/companies/${slug}/postings${id?'/'+id:`?limit=${PAGE}&offset=${s.cursor}`}`;
 throw Error('Unsupported source kind');
}
export async function boundedJSON(url:string, transport:typeof fetch=fetch):Promise<any> {
 const r=await transport(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','User-Agent':'CareerJobEngine/2.0 public-job-discovery'}});
 if(!r.ok)throw Error(`Source HTTP ${r.status}`);
 if(Number(r.headers.get('content-length')||0)>MAX_BYTES){await r.body?.cancel();throw Error('Source response exceeds 512 KiB budget');}
 const reader=r.body?.getReader();if(!reader)throw Error('Empty response body');
 const chunks:Uint8Array[]=[];let size=0;
 try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES)throw Error('Source response exceeds 512 KiB budget');chunks.push(value);}}
 catch(e){await reader.cancel();throw e;}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function normalize(s:Source, x:any):Posting {
 if(!x?.id)throw Error('Posting missing stable ID');
 let p:Posting;
 if(s.kind==='lever')p={id:String(x.id),title:x.text,url:x.hostedUrl||x.applyUrl,location:x.categories?.location||'',description:plain([x.descriptionPlain||x.description,...(x.lists||[]).map((l:any)=>`${l.text} ${l.content}`),x.additionalPlain||x.additional].join(' ')),remote:x.workplaceType==='remote',salary:x.salaryRange};
 else if(s.kind==='greenhouse')p={id:String(x.id),title:x.title,url:officialURL(x.absolute_url)?x.absolute_url:greenhouseBoardURL(s.slug,x.id),location:x.location?.name||'',description:plain(x.content),remote:/remote/i.test(x.location?.name||'')};
 else {const loc=x.location||{};const sections=x.jobAd?.sections||{};p={id:String(x.id),title:x.name,url:x.ref?.startsWith('https://jobs.smartrecruiters.com/')?x.ref:`https://jobs.smartrecruiters.com/${encodeURIComponent(s.slug)}/${encodeURIComponent(x.id)}`,location:[loc.city,loc.region,loc.country].filter(Boolean).join(', '),description:plain(Object.values(sections).map((v:any)=>v.text).join(' ')),remote:loc.remote===true};}
 if(!p.title)throw Error('Posting missing title');
 if(!officialURL(p.url))throw Error('Posting application URL is not an official HTTPS URL of a supported applicant-tracking host');
 if(p.description.length>100000)throw Error('Posting description exceeds evaluation budget');
 return p;
}
export function page(s:Source, raw:any):{items:any[];next:number;complete:boolean} {
 if(isBroad(s.kind))return broadPage(s,raw);
 let all:any[], total:number;
 if(s.kind==='lever'){if(!Array.isArray(raw))throw Error('Malformed Lever listing');all=raw;total=s.cursor+all.length;return {items:all.slice(0,PAGE),next:all.length===PAGE?s.cursor+PAGE:0,complete:all.length<PAGE};}
 if(s.kind==='greenhouse'){if(!Array.isArray(raw?.jobs))throw Error('Malformed Greenhouse listing');all=raw.jobs;total=all.length;return {items:all.slice(s.cursor,s.cursor+PAGE),next:s.cursor+PAGE<total?s.cursor+PAGE:0,complete:s.cursor+PAGE>=total};}
 if(!Array.isArray(raw?.content)||typeof raw.totalFound!=='number')throw Error('Malformed SmartRecruiters listing');
 all=raw.content;total=raw.totalFound;if(all.length===0&&s.cursor<total)throw Error('Incomplete empty source page');
 return {items:all.slice(0,PAGE),next:s.cursor+all.length<total?s.cursor+all.length:0,complete:s.cursor+all.length>=total};
}

// Ranking quality for Farhan (owner-approved 2026-11-05). The correction script (scripts/rescore_ranking_v2.mjs) uses these same functions,
// so stored rows and new evaluations can never disagree.
export const AVOID_TITLE_CAP=40, FOREIGN_LOCATION_PENALTY=15, RANKING_TAG='ranking_v2';
// Hard avoid: software, ML, security and test-automation role families are always capped.
const FARHAN_HARD_AVOID=/\b(software (?:engineer|developer|architect)|software development engineer|(?:back|front)[- ]?end|full[- ]?stack|devops|sre|site reliability|machine learning|ml (?:engineer|scientist)|data scientist|ai engineer|(?:cyber)?security (?:engineer|analyst|architect|specialist)|cyber ?security|infosec|sdet|qa engineer|test automation)\b/i;
// Soft avoid: finance, support and engineering-management families, capped unless the title also names one of his own target areas
// (implementation, solutions, onboarding, integration, automation, CRM, RevOps, operations, business systems, technical delivery).
const FARHAN_SOFT_AVOID=/\b(accountant|accounting (?:manager|analyst)|financial (?:analyst|controller)|finance (?:manager|analyst|controller|director)|controller,? finance|payroll (?:specialist|manager|analyst|administrator|accountant)|customer support|(?:technical |product )?support (?:engineer|specialist|representative|agent)|help ?desk|(?:software )?engineering manager|director of engineering|vp of engineering|head of engineering)\b/i;
const FARHAN_TARGET_WORDS=/\b(implementation|solutions?|onboarding|integrations?|automations?|crm|revops|operations|business systems|technical delivery)\b/i;
export function avoidedTitle(candidateId:string,title:string){
 if(candidateId!=='farhan_shaikh')return false;const t=title||'';
 return FARHAN_HARD_AVOID.test(t)||(FARHAN_SOFT_AVOID.test(t)&&!FARHAN_TARGET_WORDS.test(t));
}
const INDIA_PLACE=/\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|noida|gurugram|gurgaon|kolkata|ahmedabad|kochi|jaipur|coimbatore|madurai|tiruchirappalli|trichy|tamil nadu|karnataka|maharashtra|telangana|kerala|gujarat)\b/i;
const FOREIGN_NAME=/\b(united states|usa|united kingdom|uk|japan|tokyo|stockholm|sweden|philippines|manila|london|germany|berlin|munich|france|paris|spain|madrid|barcelona|netherlands|amsterdam|ireland|dublin|poland|warsaw|canada|toronto|vancouver|australia|sydney|melbourne|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|dallas|miami|emea|europe|latam|north america|americas|mexico|brazil|singapore|dubai|uae|united arab emirates)\b/i;
const FOREIGN_US_DOTTED=/(?:^|[^A-Za-z0-9])u\.s\.(?![A-Za-z0-9])/i;
const FOREIGN_US_BARE=/(?:^|[^A-Za-z0-9.])(?:US|EU)(?![A-Za-z0-9.])/;          // 'Remote - US', 'US Remote' (upper case only, so the word "us" is not matched)
const FOREIGN_STATE=/,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?![A-Za-z])/;   // US state codes (OR and IN are omitted: ambiguous with the word "or" and India's code; TN stays, with Tamil Nadu places in INDIA_PLACE so 'Coimbatore, TN' is not foreign)
const EXCLUSION_PLACE='(?:US|U\\.S\\.|USA|United States|UK|United Kingdom|EU|Europe|Canada|APAC|EMEA)(?![A-Za-z0-9])';
const EXCLUSION_PHRASE=new RegExp('\\b(?:excl\\.|(?:excluding|excl|except|outside(?: of)?|not including|other than|anywhere but|but not|not|no|non|ex)\\b)[\\s-]*(?:in\\s+)?(?:the\\s+)?'+EXCLUSION_PLACE+'(?:\\s*(?:,\\s*)?(?:,|and|or|&|/)\\s*(?:the\\s+)?'+EXCLUSION_PLACE+')*','gi');   // also consumes lists: \'excluding US and Canada\', \'non-US\', \'(excl. US)\'
/** True when the only stated location is outside India. A location that also names an Indian place is never foreign. */
export function foreignLocation(location:string){
 const l=(location||'').replace(EXCLUSION_PHRASE,' ');if(!l.trim()||INDIA_PLACE.test(l))return false;   // 'Remote, excluding the US' is not a US location
 return FOREIGN_NAME.test(l)||FOREIGN_US_DOTTED.test(l)||FOREIGN_US_BARE.test(l)||FOREIGN_STATE.test(l);
}
/** The Worker's remote test, expressed on what is stored: workplace_type REMOTE* (the posting's own remote flag) or remote wording in its location. */
export function remoteFromStored(workplaceType:string|null|undefined,location:string|null|undefined){
 return /^REMOTE/i.test(workplaceType||'')||/\b(remote|work from home|telecommut)/i.test(location||'');
}
/** Skill-based preliminary score, exactly as evaluate() computes it for a role-matched posting. */
export function roleScore(skills:number,eligible:boolean){return Math.min(90,40+skills*8+(eligible?10:0));}
/** The Worker's own test for an Indian location in evaluate(); narrower than indianPlace(), which is only used to decide that a location is NOT foreign. */
export function sanaIndiaCity(location:string|null|undefined){const l=location||'';return /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|delhi|noida|gurugram)\b/i.test(l)||/(?:^|, )in$/i.test(l);}
export function indianPlace(location:string|null|undefined){return INDIA_PLACE.test(location||'');}
export const SANA_OLD_ACCESS_REASON='Posting is in an accessible Indian location.';
export const SANA_UNKNOWN_ACCESS_REASON='Located in an Indian city. Whether a commercial airport is within about 2 hours of where the candidate would be based is not verified, so accessibility is unknown.';
// ---- Client search profiles (resold clients) ---------------------------------------------------------------------------
// The two original candidates keep their built-in rules below (search_profile NULL). Every other client carries a stored profile:
// plain keywords (never regular expressions) and one of two location policies, so an operator can onboard a client without code.
export type SearchProfile = { role_keywords: string[]; avoid_keywords: string[]; location_mode: 'REMOTE_FROM_HOME' | 'HOME_OR_RELOCATE'; home_country: string; foreign_penalty: boolean };
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cleanWords = (v: any) => (Array.isArray(v) ? v : []).map((w) => String(w).trim().replace(/\s+/g, ' ')).filter((w) => w.length >= 2 && w.length <= 60).slice(0, 40);
export function parseProfile(raw: any): SearchProfile | null {
 let p: any = raw;
 if (typeof raw === 'string') { try { p = JSON.parse(raw); } catch { return null; } }
 if (!p || typeof p !== 'object') return null;
 const role = cleanWords(p.role_keywords);
 if (!role.length) return null;
 const mode = p.location_mode === 'HOME_OR_RELOCATE' ? 'HOME_OR_RELOCATE' : 'REMOTE_FROM_HOME';
 const home = String(p.home_country || 'India').trim().slice(0, 40) || 'India';
 return { role_keywords: role, avoid_keywords: cleanWords(p.avoid_keywords), location_mode: mode, home_country: home, foreign_penalty: p.foreign_penalty !== false && home.toLowerCase() === 'india' };
}
export function phraseRegex(words: string[]): RegExp | null {
 const parts = words.map((w) => escapeRe(w).replace(/\s+/g, '\\s+'));
 return parts.length ? new RegExp(`(?:^|[^a-z0-9])(?:${parts.join('|')})(?![a-z0-9])`, 'i') : null;
}
function inHomeCountry(country: string, location: string) {
 return country.toLowerCase() === 'india' ? sanaIndiaCity(location) : new RegExp(`\\b${escapeRe(country)}\\b`, 'i').test(location || '');
}

// This is a conservative discovery screen, not a substitute for full employer/candidate review.
export function evaluate(candidate:any,p:Posting) {
 const text=`${p.title} ${p.location} ${p.description}`, lower=text.toLowerCase();
 const negated=(pattern:RegExp)=>{const g=new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(lower))){const before=lower.slice(Math.max(0,m.index-55),m.index),after=lower.slice(m.index+m[0].length,m.index+m[0].length+45);if(/\b(no|not|without|unavailable|do not|cannot)\b[^.!?]*$/.test(before)||/^\s+(?:is |will be )?(?:not|unavailable|unsupported)\b/.test(after))return true;}return false};   // ANY denial of a sponsorship/relocation phrase wins over a welcoming one
 const india=sanaIndiaCity(p.location);
 const remote=p.remote||/\b(remote|work from home|telecommut)/i.test(p.location);
 const explicitIndiaRemote=india&&(remote||/\b(fully remote|100% remote|remote position|remote role|work from home)\b/i.test(p.description))||/\b(remote (?:in|from|within|[-–]) india|india[- ]remote|hiring (?:remote workers|remotely) (?:in|from) india)\b/i.test(text);
 const blocked=/\b(us|usa|u\.s\.|united states|uk|united kingdom|canada|europe|eu|germany|australia)\s+(?:residents?\s+)?only\b|must (?:reside|be based|be located) in (?:the )?(?:us|usa|united states|uk|europe)|not hiring (?:in|from) india|excluding india|except india/i.test(text);
 const security=/\b(?:active |must (?:have|hold) )?(?:secret|top secret) clearance|ts\/sci|\bitar\b|\b(?:us|uk) citizen(?:ship)? (?:only|required)\b/i.test(text);
 const sponsorship=/\b(visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome)\b/i.test(text)&&!negated(/visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome/);
 const globalRemote=/worldwide remote|remote worldwide|remote.?global|work from anywhere in the world/i.test(text);
 let eligibility='UNKNOWN',reason='No affirmative candidate-specific location evidence.';
 const prof=parseProfile(candidate.search_profile);
 if(security){eligibility='INELIGIBLE';reason='Explicit citizenship, security clearance or licensing restriction requires exclusion.';}
 else if(prof){
  const home=inHomeCountry(prof.home_country,p.location), country=prof.home_country;
  const homeRemote=home&&(remote||/\b(fully remote|100% remote|remote position|remote role|work from home)\b/i.test(p.description))||new RegExp(`\\b(remote (?:in|from|within|[-–]) ${escapeRe(country)}|${escapeRe(country)}[- ]remote)\\b`,'i').test(text);
  const blockedHome=prof.home_country.toLowerCase()==='india'&&blocked;
  if(prof.location_mode==='REMOTE_FROM_HOME'){
   if(blockedHome){eligibility='INELIGIBLE';reason=`Posting explicitly restricts work location outside ${country}.`;}
   else if(homeRemote&&!/\b(hybrid|on[- ]site|not remote|no remote)\b/i.test(p.location+' '+p.description)){eligibility='ELIGIBLE';reason=`Posting explicitly supports fully remote work from ${country}.`;}
  }else if(home){
   if(remote){eligibility='ELIGIBLE';reason=`Remote role in ${country}.`;}
   else reason=`Located in ${country}. Whether this location is workable for the candidate is not verified, so it is unknown.`;
  }else if(!blockedHome&&(sponsorship||globalRemote)){eligibility='ELIGIBLE';reason=sponsorship?'Posting affirmatively mentions sponsorship/relocation; eligibility still requires review.':'Posting explicitly advertises worldwide remote work.';}
 }
 else if(candidate.id==='farhan_shaikh'){
  if(blocked){eligibility='INELIGIBLE';reason='Posting explicitly restricts work location outside India.';}
  else if(explicitIndiaRemote&&!/\b(hybrid|on[- ]site|not remote|no remote)\b/i.test(p.location+' '+p.description)){eligibility='ELIGIBLE';reason='Posting explicitly supports fully remote work from India.';}
 }else if(india){
  // A fixed city list cannot establish that a commercial airport is within about 2 hours of the candidate, so an on-site or
  // hybrid role in an Indian city is UNKNOWN until that is verified. Only a role that is remote in India is affirmative.
  if(remote){eligibility='ELIGIBLE';reason='Remote role in India.';}
  else reason=SANA_UNKNOWN_ACCESS_REASON;
 }
 else if(!blocked&&(sponsorship||globalRemote)){eligibility='ELIGIBLE';reason=sponsorship?'Posting affirmatively mentions sponsorship/relocation; eligibility still requires review.':'Posting explicitly advertises worldwide remote work.';}
 const role=prof?!!phraseRegex(prof.role_keywords)?.test(p.title||''):candidate.id==='farhan_shaikh'?/operations|implementation|integration|automation|business systems|crm|revops|solutions|technical delivery/i.test(p.title):/electrical|power|energy|reliability|maintenance|plant|commissioning|utilities|asset performance|decarbon/i.test(p.title);
 const skills=list(candidate.primary_skills).filter(s=>lower.includes(s.toLowerCase()));
 let score=role?Math.min(90,40+skills.length*8+(eligibility==='ELIGIBLE'?10:0)):Math.min(35,skills.length*5);
 // Ranking quality (owner-approved 2026-11-05). Titles in the candidate's avoid list are capped below the review threshold, and a
 // posting whose only stated location is outside India loses a fixed amount unless it affirmatively supports remote work from India.
 // Both only lower the preliminary score. Eligibility, status and READY rules are not touched, and a human override still wins.
 const avoided=prof?!!phraseRegex(prof.avoid_keywords)?.test(p.title||''):avoidedTitle(candidate.id,p.title);
 const foreignOnly=(prof?prof.foreign_penalty:candidate.id==='farhan_shaikh')&&eligibility!=='ELIGIBLE'&&foreignLocation(p.location);
 if(avoided)score=Math.min(score,AVOID_TITLE_CAP);
 if(foreignOnly)score=Math.max(0,score-FOREIGN_LOCATION_PENALTY);
 // New discoveries are never auto-promoted to READY using a simplified scorer.
 return {status:eligibility==='INELIGIBLE'?'INELIGIBLE':role?'NEEDS_REVIEW':'HOLD',lane:role?'STRONGEST_FIT':'UNASSIGNED',eligibility,reason,score,skills,qualification_reason:(role?'Cloud discovery match. Full requirements, pay and experience require review before READY.':'Outside candidate target role family; retained for review.')+(avoided?' Title is on the candidate\'s avoid list (score capped).':'')+(foreignOnly?' Only stated location is outside India (score reduced).':'')};
}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
function canonical(url:string){const u=new URL(url),keys:string[]=[];u.searchParams.forEach((_,k)=>keys.push(k));for(const k of keys)if(/^(utm_|gh_src|source|ref|lever-source)/.test(k))u.searchParams.delete(k);u.hash='';u.pathname=u.pathname.replace(/\/$/,'');return u.toString().replace(/\/$/,'');}
export async function persist(db:DB,s:Source,p:Posting,now=iso()) {
 const fingerprint=await hash(JSON.stringify([p.title,p.location,p.description,p.remote,p.salary||null]));
 const mapped=await db.prepare('SELECT job_id,content_sha256 FROM cloud_job_evidence WHERE source_id=? AND posting_id=?').bind(s.id,p.id).first<any>();
 const rawId=`${s.kind}:${s.slug.toLowerCase()}:${p.id}`;
 const existing=mapped?await db.prepare('SELECT * FROM jobs WHERE id=?').bind(mapped.job_id).first<any>():await db.prepare('SELECT * FROM jobs WHERE id=? OR original_posting_url=? OR source_url=? OR original_posting_url=? OR source_url=? LIMIT 1').bind(rawId,p.url,p.url,canonical(p.url),canonical(p.url)).first<any>();
 const jobId=existing?.id||rawId;
 // Preserve all original text for evaluation/evidence, and only touch employer-owned fields.
 const statements:D1PreparedStatement[]=[];
 const unchanged=mapped?.content_sha256===fingerprint;
 if(!unchanged){
  statements.push(db.prepare(`INSERT INTO jobs(id,title,company,source_adapter,source_url,original_posting_url,employment_type,workplace_type,location_restrictions,description,required_skills,discovered_at,last_verified_at,is_active,content_sha256,source_id,source_channel,provenance)
   VALUES(?,?,?,?,?,?,'FULL_TIME',?,?,?,'[]',?,?,1,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET title=excluded.title,company=excluded.company,location_restrictions=excluded.location_restrictions,description=excluded.description,workplace_type=excluded.workplace_type,last_verified_at=excluded.last_verified_at,content_sha256=excluded.content_sha256,is_active=1,expired_at=NULL
   WHERE excluded.provenance='LIVE_PUBLIC' OR jobs.provenance='PUBLIC_FEED_UNVERIFIED'`).bind(jobId,p.title,p.company||s.name,s.kind,p.url,p.url,p.remote?'REMOTE_RESTRICTED':p.board?'UNKNOWN':'ONSITE',p.location,p.description,now,p.board?null:now,fingerprint,s.id,p.board?'PUBLIC_JOB_BOARD':'PUBLIC_ATS',p.board?'PUBLIC_FEED_UNVERIFIED':'LIVE_PUBLIC'));
  const candidates=await db.prepare('SELECT c.*, p.search_profile FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id').all<any>();
  if(p.board&&p.salary){const min=Number.isFinite(p.salary.min)?p.salary.min:null,max=Number.isFinite(p.salary.max)?p.salary.max:null;
   statements.push(db.prepare(`UPDATE jobs SET salary_published=?,salary_min=?,salary_max=?,salary_currency=?,salary_period=?,salary_raw_text=? WHERE id=? AND provenance='PUBLIC_FEED_UNVERIFIED'`).bind(min!==null||max!==null||p.salary.text?1:0,min,max,p.salary.currency||null,p.salary.period||null,p.salary.text||null,jobId));
  }
  for(const candidate of candidates.results){
   const result=evaluate(candidate,p);
   if(p.board){result.eligibility='UNKNOWN';result.reason=`Reported by ${p.sourceLabel}; employer availability and eligibility are unverified.`;result.status=result.status==='HOLD'?'HOLD':'NEEDS_REVIEW';result.qualification_reason='Cloud discovery match. Public job-board/startup announcement; employer verification, full requirements and compensation review pending.';}
   // Existing candidate decisions are preserved; cloud refresh never demotes/promotes them silently.
   statements.push(db.prepare(`INSERT INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,qualification_reason,last_reverified_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM applications WHERE candidate_id=? AND job_id=?)
    ON CONFLICT(candidate_id,job_id) DO UPDATE SET qualification_status=excluded.qualification_status,strategy_lane=excluded.strategy_lane,eligibility_status=excluded.eligibility_status,eligibility_reason=excluded.eligibility_reason,qualification_reason=excluded.qualification_reason,last_reverified_at=excluded.last_reverified_at
    WHERE candidate_qualifications.manual_override_status IS NULL AND (candidate_qualifications.qualification_reason LIKE 'Cloud discovery match.%' OR candidate_qualifications.qualification_reason='Outside candidate target role family; retained for review.')
    AND NOT EXISTS(SELECT 1 FROM applications WHERE candidate_id=excluded.candidate_id AND job_id=excluded.job_id)`).bind(candidate.id,jobId,result.status,result.lane,result.eligibility,result.reason,result.qualification_reason,now,candidate.id,jobId));
   statements.push(db.prepare(`INSERT INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,role_score,strategy_lane,score_breakdown,calculated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(candidate_id,job_id) DO UPDATE SET overall_score=excluded.overall_score,skill_score=excluded.skill_score,role_score=excluded.role_score,strategy_lane=excluded.strategy_lane,score_breakdown=excluded.score_breakdown,calculated_at=excluded.calculated_at
    WHERE candidate_job_scores.score_breakdown LIKE '%cloud-conservative-review-%' AND NOT EXISTS(SELECT 1 FROM applications WHERE candidate_id=excluded.candidate_id AND job_id=excluded.job_id)
    AND NOT EXISTS(SELECT 1 FROM candidate_qualifications WHERE candidate_id=excluded.candidate_id AND job_id=excluded.job_id AND manual_override_status IS NOT NULL)`).bind(candidate.id,jobId,result.score,Math.min(100,result.skills.length*20),result.lane==='STRONGEST_FIT'?70:0,result.lane,JSON.stringify({rule_version:RULE_VERSION,preliminary:true,ranking_v2:true,matched_skills:result.skills,missing_skills:[],note:'Conservative discovery screen; full qualification review pending.'}),now));
  }
 }
 else if(!p.board)statements.push(db.prepare('UPDATE jobs SET last_verified_at=? WHERE id=?').bind(now,jobId));
 statements.push(db.prepare(`INSERT INTO cloud_job_evidence(job_id,source_id,posting_id,content_sha256,fetched_at,rule_version) VALUES(?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET content_sha256=excluded.content_sha256,fetched_at=excluded.fetched_at,rule_version=excluded.rule_version`).bind(jobId,s.id,p.id,fingerprint,p.observedAt||now,RULE_VERSION));
 await db.batch(statements);
 return {job_id:jobId,jobs_new:existing?0:1,jobs_updated:existing&&!unchanged?1:0,jobs_unchanged:unchanged?1:0};
}
// ---- Assessment of collector imports ----------------------------------------------------------------------------------
// The GitHub collector imports postings as "[GITHUB_COLLECTOR] Unassessed" rows (score 0, location UNKNOWN) and nothing scored them.
// This step runs the same screen as discovery (evaluate()) over the stored title, location and description, a small batch at a time.
// It never promotes to READY (evaluate() cannot), never touches a row with a human override or an application, and only rewrites a
// row while it is still unassessed, so re-running is harmless and a later human or discovery decision is never overwritten.
export const ASSESS_BATCH = 40, ASSESS_EVERY_TICKS = 5;
// Reads go through the partial index (migration 0010) and only touch rows still waiting: INDEXED BY makes a missing index an error
// instead of a silent full scan of every qualification row.
const UNASSESSED = `q.qualification_reason LIKE '[GITHUB_COLLECTOR] Unassessed%'`;
export async function assessBacklog(db:DB, limit=ASSESS_BATCH, now=iso()) {
 const {results} = await db.prepare(`SELECT q.candidate_id, q.job_id, j.title, j.location_restrictions AS location, j.description, j.workplace_type, c.primary_skills, cp.search_profile
  FROM candidate_qualifications q INDEXED BY idx_cq_unassessed CROSS JOIN jobs j ON j.id = q.job_id CROSS JOIN candidates c ON c.id = q.candidate_id LEFT JOIN client_profiles cp ON cp.candidate_id = c.id
  WHERE ${UNASSESSED} AND q.manual_override_status IS NULL AND j.is_active = 1
   AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = q.candidate_id AND a.job_id = q.job_id)
  LIMIT ?`).bind(limit).all<any>();
 const rows = results || [];
 if (!rows.length) return { assessed: 0, by_status: {} as Record<string, number> };
 const statements: D1PreparedStatement[] = []; const byStatus: Record<string, number> = {};
 for (const r of rows) {
  const posting: Posting = { id: r.job_id, title: r.title || '', url: '', location: r.location || '', description: plain(r.description), remote: /^REMOTE/i.test(r.workplace_type || '') };
  const result = evaluate({ id: r.candidate_id, primary_skills: r.primary_skills, search_profile: r.search_profile }, posting);
  byStatus[result.status] = (byStatus[result.status] || 0) + 1;
  const guard = `candidate_id = ? AND job_id = ? AND manual_override_status IS NULL AND qualification_reason LIKE '[GITHUB_COLLECTOR] Unassessed%'
   AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_qualifications.candidate_id AND a.job_id = candidate_qualifications.job_id)`;
  // Score first (its guard reads the qualification row while it is still unassessed), then the qualification.
  statements.push(db.prepare(`UPDATE candidate_job_scores SET overall_score = ?, skill_score = ?, role_score = ?, strategy_lane = ?, score_breakdown = ?, calculated_at = ?
   WHERE candidate_id = ? AND job_id = ? AND EXISTS (SELECT 1 FROM candidate_qualifications x WHERE x.candidate_id = candidate_job_scores.candidate_id AND x.job_id = candidate_job_scores.job_id
    AND x.manual_override_status IS NULL AND x.qualification_reason LIKE '[GITHUB_COLLECTOR] Unassessed%')
   AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = candidate_job_scores.candidate_id AND a.job_id = candidate_job_scores.job_id)`)
   .bind(result.score, Math.min(100, result.skills.length * 20), result.lane === 'STRONGEST_FIT' ? 70 : 0, result.lane,
    JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, assessed_from: 'github_collector', matched_skills: result.skills, missing_skills: [], note: 'Conservative screen of a collector-imported posting; full qualification review pending.' }),
    now, r.candidate_id, r.job_id));
  statements.push(db.prepare(`UPDATE candidate_qualifications SET qualification_status = ?, strategy_lane = ?, eligibility_status = ?, eligibility_reason = ?, qualification_reason = ?, last_reverified_at = ? WHERE ${guard}`)
   .bind(result.status, result.lane, result.eligibility, result.reason, result.qualification_reason, now, r.candidate_id, r.job_id));
 }
 await db.batch(statements);
 return { assessed: rows.length, by_status: byStatus };
}

export async function runDiscovery(env:{DB:DB}, trigger='CRON', transport:typeof fetch=fetch, preferredSource?:string) {
 const db=env.DB, now=iso(), seconds=epoch(), token=crypto.randomUUID(), day=now.slice(0,10);
 const acquired=await db.prepare(`UPDATE cloud_automation SET lease_token=?,lease_until=?,day=?,jobs_today=CASE WHEN day=? THEN jobs_today ELSE 0 END,sources_today=CASE WHEN day=? THEN sources_today ELSE 0 END WHERE id=1 AND enabled=1 AND lease_until<? RETURNING *`).bind(token,seconds+180,day,day,day,seconds).first<any>();
 if(!acquired)return {status:'SKIPPED',reason:'Paused or another run holds lease'};
 let runId='',work:any=null,source:Source|null=null,kind='',started=Date.now();
 try {
  if(acquired.jobs_today>=DAY_JOBS)return {status:'IDLE',reason:'Daily posting budget reached; source collection also rests until tomorrow'};
  work=await db.prepare(`SELECT q.* FROM cloud_discovery_queue q JOIN cloud_sources s ON s.id=q.source_id WHERE q.state='PENDING' AND q.next_due<=? AND s.enabled=1 ORDER BY q.next_due,q.id LIMIT 1`).bind(seconds).first<any>();
  if(work){source=await db.prepare('SELECT * FROM cloud_sources WHERE id=? AND enabled=1').bind(work.source_id).first<Source>();kind='POSTING';}
  else if(acquired.sources_today<DAY_SOURCES){source=await db.prepare('SELECT * FROM cloud_sources WHERE enabled=1 AND next_due<=? ORDER BY next_due,id LIMIT 1').bind(seconds).first<Source>();kind='SOURCE';}
  // Reserve a regular source slot so queued jobs cannot starve new employers/boards.
  if(acquired.sources_today<DAY_SOURCES&&Math.floor(seconds/120)%5===0&&!preferredSource){const due=await db.prepare('SELECT * FROM cloud_sources WHERE enabled=1 AND next_due<=? ORDER BY next_due,id LIMIT 1').bind(seconds).first<Source>();if(due){source=due;work=null;kind='SOURCE';}}
  if(preferredSource&&trigger==='MANUAL'){
   source=await db.prepare('SELECT * FROM cloud_sources WHERE id=? AND enabled=1').bind(preferredSource).first<Source>();
   work=source?await db.prepare("SELECT * FROM cloud_discovery_queue WHERE source_id=? AND state='PENDING' AND next_due<=? ORDER BY next_due,id LIMIT 1").bind(source.id,seconds).first<any>():null;
   if(work)kind='POSTING';else if(source&&acquired.sources_today<DAY_SOURCES&&(source as any).next_due<=seconds)kind='SOURCE';else source=null;
  }
  if(!source)return {status:'IDLE',reason:'No due work or daily budget reached'};
  await db.prepare("UPDATE cloud_discovery_runs SET status='INTERRUPTED',completed_at=?,error_message='Previous lease expired before completion' WHERE status='RUNNING' AND started_at<?").bind(now,new Date(Date.now()-180000).toISOString()).run();
  runId=crypto.randomUUID();await db.prepare(`INSERT INTO cloud_discovery_runs(id,trigger_type,run_type,source_id,status,started_at) VALUES(?,?,?,?,'RUNNING',?)`).bind(runId,trigger,kind,source.id,now).run();
  let counts={jobs_seen:0,jobs_new:0,jobs_updated:0,jobs_unchanged:0},jobId:string|null=null;
  if(kind==='SOURCE'){
   // Charge attempts before network calls, including failures.
   await db.prepare('UPDATE cloud_automation SET sources_today=sources_today+1 WHERE id=1').run();
   if(source.kind==='jobicy'&&source.cursor_token&&seconds-(source.cursor_started_at||0)>82800){source.cursor_token=undefined;source.cursor=0;}
   const raw=await boundedJSON(sourceURL(source),transport), parsed:any=page(source,raw);
   const statements:D1PreparedStatement[]=[];
   for(const item of parsed.items){
    const title=item.jobTitle||item.text||item.title||item.name||'';if((source.kind!=='hnjobs'&&!relevant(title))||!item.id)continue;
    const postingId=String(item.id), id=`${source.id}:${postingId}`;
    statements.push(db.prepare(`INSERT INTO cloud_discovery_queue(id,source_id,posting_id,payload,state,next_due,updated_at) VALUES(?,?,?,?,'PENDING',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,state='PENDING',next_due=excluded.next_due,attempts=0,last_error=NULL,updated_at=excluded.updated_at`).bind(id,source.id,postingId,JSON.stringify(item),seconds,now));
   }
   counts.jobs_seen=parsed.items.length;
   const interval=source.kind==='remotive'?86400:43200;
   statements.push(db.prepare(`UPDATE cloud_sources SET cursor=?,cursor_token=?,cursor_started_at=?,next_due=?,failures=0,last_attempt_at=?,last_success_at=?,last_error=NULL,last_status=?,last_seen=? WHERE id=?`).bind(parsed.next,parsed.token||null,parsed.token?(source.cursor_token?source.cursor_started_at||seconds:seconds):0,seconds+(parsed.complete?interval:600),now,now,parsed.complete?(parsed.items.length?'SUCCESS':'EMPTY'):'PARTIAL',parsed.items.length,source.id));
   await db.batch(statements);
  }else{
   await db.prepare('UPDATE cloud_automation SET jobs_today=jobs_today+1 WHERE id=1').run();
   const cached=source.kind==='jobicy'||source.kind==='remotive';
   const raw=cached?JSON.parse(work.payload):await boundedJSON(sourceURL(source,work.posting_id),transport);
   const posting:Posting=isBroad(source.kind)?normalizeBroad(source,raw,cached?work.updated_at:now):normalize(source,raw);
   posting.description=plain(posting.description);if(!posting.description)throw Error('Posting detail missing description; held for retry');
   const result=await persist(db,source,posting);jobId=result.job_id;counts={jobs_seen:1,...result};
   await db.prepare(`UPDATE cloud_discovery_queue SET state='DONE',last_error=NULL,updated_at=? WHERE id=?`).bind(iso(),work.id).run();
  }
  const end=iso();await db.batch([
   db.prepare(`UPDATE cloud_discovery_runs SET status='SUCCESS',completed_at=?,duration_ms=?,job_id=?,jobs_seen=?,jobs_new=?,jobs_updated=?,jobs_unchanged=? WHERE id=?`).bind(end,Date.now()-started,jobId,counts.jobs_seen,counts.jobs_new,counts.jobs_updated,counts.jobs_unchanged,runId),
   db.prepare('UPDATE cloud_automation SET last_success_at=?,last_error=NULL,updated_at=? WHERE id=1 AND lease_token=?').bind(end,end,token)
  ]);
  return {status:'SUCCESS',run_id:runId,source_id:source.id,run_type:kind,duration_ms:Date.now()-started,...counts};
 }catch(error:any){
  const message=String(error.message||error).slice(0,500),end=iso();
  const statements=[db.prepare('UPDATE cloud_automation SET last_error=?,updated_at=? WHERE id=1 AND lease_token=?').bind(message,end,token)];
  if(runId)statements.push(db.prepare(`UPDATE cloud_discovery_runs SET status='ERROR',completed_at=?,duration_ms=?,error_message=? WHERE id=?`).bind(end,Date.now()-started,message,runId));
  if(work)statements.push(db.prepare(`UPDATE cloud_discovery_queue SET attempts=attempts+1,state=CASE WHEN attempts>=2 THEN 'FAILED' ELSE 'PENDING' END,next_due=?,last_error=?,updated_at=? WHERE id=?`).bind(seconds+3600,message,end,work.id));
  else if(source)statements.push(db.prepare(`UPDATE cloud_sources SET failures=failures+1,next_due=?,cursor_token=CASE WHEN ? THEN NULL ELSE cursor_token END,cursor_started_at=CASE WHEN ? THEN 0 ELSE cursor_started_at END,last_status='ERROR',last_attempt_at=?,last_error=? WHERE id=?`).bind(seconds+Math.min(86400,3600*2**Math.min(source.failures,4)),source.kind==='jobicy'&&message.includes('400')?1:0,source.kind==='jobicy'&&message.includes('400')?1:0,end,message,source.id));
  await db.batch(statements);return {status:'ERROR',run_id:runId,error:message};
 }finally{
  await db.prepare('UPDATE cloud_automation SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').bind(token).run();
 }
}
export async function automationStatus(db:DB) {
 const [config,latest,lastSuccess,pending,sources]=await Promise.all([
  db.prepare('SELECT * FROM cloud_automation WHERE id=1').first<any>(),
  db.prepare('SELECT * FROM cloud_discovery_runs ORDER BY started_at DESC LIMIT 1').first<any>(),
  db.prepare("SELECT * FROM cloud_discovery_runs WHERE status='SUCCESS' ORDER BY started_at DESC LIMIT 1").first<any>(),
  db.prepare("SELECT COUNT(*) count FROM cloud_discovery_queue WHERE state='PENDING'").first<any>(),
  db.prepare('SELECT COUNT(*) count FROM cloud_sources WHERE enabled=1').first<any>()
 ]);
 const enabled=!!config?.enabled;
 const coverage=await db.prepare(`SELECT (SELECT COUNT(*) FROM cloud_sources WHERE enabled=1 AND kind IN ('jobicy','remotive','hnjobs')) multi_employer_sources,(SELECT COUNT(*) FROM cloud_sources WHERE enabled=1 AND kind NOT IN ('jobicy','remotive','hnjobs')) direct_employer_sources,(SELECT COUNT(DISTINCT company) FROM jobs WHERE provenance='PUBLIC_FEED_UNVERIFIED') employers_discovered,(SELECT COUNT(*) FROM jobs WHERE provenance='PUBLIC_FEED_UNVERIFIED') broad_listings`).first<any>();
 return {coverage,config:{id:1,is_enabled:enabled,interval_seconds:120,verify_urls:false,reverify_inventory:false,last_run_at:latest?.started_at||null,next_run_at:enabled?new Date(Math.ceil(Date.now()/120000)*120000).toISOString():null,status:enabled?'ACTIVE':'PAUSED',updated_at:config?.updated_at||null},is_active:enabled,automation_state:enabled?'CLOUD DISCOVERY ACTIVE':'CLOUD DISCOVERY PAUSED',latest_run:latest,last_discovery_run:latest,last_successful_run:lastSuccess,next_scheduled_discovery:enabled?'Every 2 minutes; one bounded work unit per tick (UTC)':'Paused',last_weekly_refresh:null,current_run_status:latest?.status||'NEVER_RUN',last_error:config?.last_error||null,pending_jobs:pending?.count||0,source_count:sources?.count||0,daily_budgets:{posting_attempts:DAY_JOBS,source_pages:DAY_SOURCES},today:{day:config?.day,posting_attempts:config?.jobs_today||0,source_pages:config?.sources_today||0},qualification_mode:'conservative_review',schedules:{discovery:'Cloudflare cron: every 2 minutes',weekly_refresh:'Continuous rotating source refresh; no separate weekly bulk scan',server_startup:'Cloudflare managed; PC not required'}};
}
