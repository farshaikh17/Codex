// Small durable work units. No application/history writes and no model/API fees.
import { isBroad, broadURL, broadPage, normalizeBroad } from './broad-feeds.ts';
export const RULE_VERSION = 'cloud-conservative-review-1';
// The rules marker (plan R9): a score breakdown carrying {"<RULES_MARKER>": true} was scored under the current rules. The ONLY place it is written;
// scripts/dataset_apply.mjs imports it and engine/dataset_discovery.py reads it from this line. Bump it once per phase that changes evaluate()
// or a scoring rule (every stored row is then re-scored over the next runs). This module is not the Worker entry (worker/index.ts), so exporting is safe.
export const RULES_MARKER = 'profile_v26';
const PAGE = 10, MAX_BYTES = 512 * 1024, DAY_JOBS = 120, DAY_SOURCES = 48;
type DB = D1Database;
type Source = {id:string;kind:string;slug:string;name:string;cursor:number;failures:number;cursor_token?:string;cursor_started_at?:number};
export type Posting = {id:string;title:string;url:string;location:string;description:string;remote:boolean;salary?:any;company?:string;board?:boolean;observedAt?:string;sourceLabel?:string;source?:string};
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
// Owner rules 2026-11-07 added: business analyst, deal desk, sales, admin, junior/intern, data engineering, and roles that need
// hands-on Salesforce, HubSpot or Zoho administration or development.
const FARHAN_HARD_AVOID=/\b((?:clinical|construction|health(?:care)?|medical) (?:\w+ )?(?:program|project|operations) manager|project manager,? -? ?construction|(?:[a-z0-9+#.]+ )?developer|(?:salesforce|hubspot|zoho|netsuite|dynamics 365) crm (?:admin|administrator|developer|engineer)|business (?:systems )?analyst|sales engineer|pre-?sales|treasury|strategic solutions engineer|cyber[a-z]*|(?:payments?|compensation|pricing|tax|audit|legal|procurement|total rewards|benefits|payroll|travel|hr|people) (?:operations|analyst|specialist)|deal desk|account executive|sales (?:development|representative|executive|associate)|business development (?:representative|executive|associate)|inside sales|administrative assistant|office (?:administrator|assistant)|receptionist|data engineer|intern|internship|junior|apprentice(?:ship)?|trainee|sde|(?:salesforce|hubspot|zoho|netsuite|dynamics 365) (?:admin|administrator|developer|engineer)|software (?:engineer|developer|architect)|software development engineer|(?:back|front)[- ]?end|full[- ]?stack|devops|sre|site reliability|machine learning|ml (?:engineer|scientist)|data scientist|ai engineer|(?:cyber)?security (?:engineer|analyst|architect|specialist)|cyber ?security|infosec|sdet|qa engineer|test automation|qa automation|qa analyst|qa lead|quality assurance|test engineer|tester|solutions architect|systems architect|engineering manager|staff engineer|principal engineer|infrastructure|cloud operations|platform operations|product manager|clinical|territory operations|atqc|automation frameworks?)\b/i;   // jobs QA 13 Nov: other fields reached his lists through "operations", "solutions" or "architect"
// Jobs QA 13 Nov: "Commercial Operations Specialist" is capped unless the title also says RevOps / revenue operations ("... (RevOps)" is his field).
const FARHAN_REVOPS_ONLY_AVOID=/\bcommercial operations specialist\b/i, REVOPS_WORDS=/\brev(?:enue)?[- ]?ops\b|\brevenue operations\b/i;
// Soft avoid: finance, support and engineering-management families, capped unless the title also names one of his own target areas
// (implementation, solutions, onboarding, integration, automation, CRM, RevOps, operations, business systems, technical delivery).
const FARHAN_SOFT_AVOID=/\b(accountant|accounting (?:manager|analyst)|financial (?:analyst|controller)|finance (?:manager|analyst|controller|director)|controller,? finance|payroll (?:specialist|manager|analyst|administrator|accountant)|customer support|(?:technical |product )?support (?:engineer|specialist|representative|agent)|help ?desk|(?:software )?engineering manager|director of engineering|vp of engineering|head of engineering)\b/i;
const FARHAN_TARGET_WORDS=/\b(implementation|solutions?|onboarding|integrations?|automations?|crm|revops|operations|business systems|technical delivery|chief of staff|founder'?s? (?:office|associate)|gtm engineer)\b/i;
// Builder roles (owner rule 2026-11-07): implementation, automation, technical/revenue operations, GTM engineering, Founder's Office
// and Chief of Staff, in any industry.
// Plan S2 (phase 2): every title the daily searches fetch is recognised (delivery/program/project managers, professional services, technical account
// managers, customer engineers, GoHighLevel and tech-ops titles for Farhan; O&M, shift in-charge, rotating and static equipment, mechanical, thermal,
// solar, hydro, substation, switchgear, energy manager, operations engineer, transmission and renewables for Sana; jobs QA 8: a manager, engineer or
// executive of a plant discipline, 'Deputy Manager - Mechanical', 'Sr. Manager (C&I)', 'Instrumentation Executive'). test/discovery.test.mjs checks
// every search term against these rules.
export const FARHAN_ROLE=/operations|implementation|integration|automation|business systems|crm|revops|sales ops|marketing ops|systems architect|onboarding|solutions|technical delivery|chief of staff|founder'?s? (?:office|associate)|founding (?:operations|ops|generalist)|gtm engineer|go[- ]to[- ]market engineer|ai (?:ops|operations|workflow|implementation)|(?:technical )?(?:delivery|program|project) manager|professional services|technical account manager|customer engineer|gohighlevel|tech ops/i;
export const SANA_ROLE=/electrical|power|energy|turbine|boiler|(?:power|energy|turbine|hvdc|wind|solar|grid|substation|generator|boiler|plant)\W+(?:\w+\W+){0,3}field service|field service engineer\W+(?:\w+\W+){0,3}(?:power|energy|turbine|hvdc|wind|solar|grid|substation|generator|boiler|plant)|plant operator|control room|instandhaltung|wartung|kraftwerk|elektro|betriebsingenieur|zuverl.ssigkeit|anlagen|ing.nieur|centrale|onderhoud|elektrotechnisch|energiebesparing|energieeffizienz|reliability|maintenance|plant|commissioning|utilities|asset performance|decarboni[sz]|sustainab|clean ?tech|efficiency|net[- ]zero|emissions|(?:technical|engineering) consult|o ?& ?m\b|operations (?:and|&) maintenance|shift (?:in[- ]?charge|engineer)|rotating (?:equipment|machinery)|static equipment|mechanical (?:engineer|maintenance)|thermal (?:power|plant|station)|\(thermal\)|solar|\bhydro(?:gen|power|electric)?\b|substation|switchgear|energy manager|operations engineer|transmission (?:line|engineer|system|network|project)|renewable|(?:manager|engineer|executive)\W+(?:mechanical|\bc ?& ?i\b|instrumentation)|(?:mechanical|\bc ?& ?i|instrumentation)\W+(?:manager|executive|in[- ]?charge)/i;
// Jobs QA 8: the plant-discipline branch above ('Deputy Manager - Mechanical', 'Sr. Manager (C&I)') is not hers when the title also says sales, design,
// procurement or HVAC ('Manager - Instrumentation Sales', 'Engineer - Mechanical (HVAC Design)'). SANA_ROLE stays one plain alternation (the dataset
// prefilter reads it, without lookarounds), so the screen applies the exclusion here.
const SANA_DISCIPLINE_BRANCH='|(?:manager|engineer|executive)\\W+(?:mechanical|\\bc ?& ?i\\b|instrumentation)|(?:mechanical|\\bc ?& ?i|instrumentation)\\W+(?:manager|executive|in[- ]?charge)';
const SANA_ROLE_CORE=new RegExp(SANA_ROLE.source.replace(SANA_DISCIPLINE_BRANCH,''),'i');
if(SANA_ROLE_CORE.source===SANA_ROLE.source)throw new Error('SANA_DISCIPLINE_BRANCH is out of step with SANA_ROLE');
const SANA_DISCIPLINE_NOT=/\bsales\b|\bdesign\w*|\bprocurement\b|\bpurchas\w*|\bsourcing\b|\bhvac\b|\bestimat\w*|\bbusiness development\b/i;
/** Sana's role test on a title: SANA_ROLE, except a title that passes only through the plant-discipline branch and says sales, design, procurement or HVAC. */
export function sanaRoleTitle(title:string|null|undefined):boolean{const t=String(title||'');return SANA_ROLE.test(t)&&(!SANA_DISCIPLINE_NOT.test(t)||SANA_ROLE_CORE.test(t));}
// Employers the owner asked to skip (2026-11-07).
const FARHAN_SKIP_EMPLOYER=/^\s*ajaia\b/i;
// A location that names only the United States (owner rule 2026-11-07: US-only remote roles are rejected for Farhan).
const US_ONLY_PLACE=/\b(united states|usa|new york|nyc|bay area|silicon valley|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|dallas|miami|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;   // US state names too ('Remote - Pennsylvania'); Georgia is left out because it is also a country
const OPEN_PLACE=/\b(anywhere|worldwide|global|international|apac|asia|emea|europe|canada|uk|united kingdom|latam)\b/i;
export function usOnlyLocation(location:string){const l=(location||'').replace(EXCLUSION_PHRASE,' ');if(!l.trim()||indianPlace(l)||OPEN_PLACE.test(l))return false;return US_ONLY_PLACE.test(l)||FOREIGN_US_DOTTED.test(l)||FOREIGN_US_BARE.test(l)||FOREIGN_STATE.test(l);}
/** The largest 'N+ years' of experience a posting asks for (0 when it does not say). */
// Jobs QA 13 Nov: also "12+ years in software engineering" (a field noun instead of the word experience) and decimals ("1.5+ years").
export function yearsRequired(text:string){let best=0;const re=/(?<![\w.])(\d{1,2}(?:\.\d)?)\s*(?:\+|plus)?\s*(?:-|to|–)?\s*(?:\d{1,2}(?:\.\d)?\s*)?\+?\s*years?(?:'|’)?\s+(?:(?:of\s+)?(?:[a-z/&-]+\s+){0,4}?experience|(?:of\s+|in\s+)(?:[a-z/&-]+\s+){0,3}?(?:engineering|consulting|operations|maintenance)\b)/gi;let m:RegExpExecArray|null;while((m=re.exec(text||''))){const n=Number(m[1]);if(n>=1&&n<=25&&n>best)best=n;}return best;}
export const EXPERIENCE_OVER_PENALTY=15, EXPERIENCE_MATCH_BONUS=5;
// Roles pitched well below the candidate (spot check 2026-11-12: a diploma-trainee role was "Ready" for someone with 9 years; a 1-3 year junior
// role scored 79). Either the title says so, or the posting's own experience RANGE tops out at half the candidate's experience or less.
// Only applied to a candidate with at least 5 years. The score is capped like an avoid-list title; eligibility and status are unchanged.
export const UNDER_LEVEL_CAP=40, PLATFORM_GAP_CAP=59;   // jobs QA 2: 59, below Farhan's Worth-a-try floor (threshold 70 - 10)   // plan S7: a role built around a platform the profile does not list is capped (was a 20-point deduction)
const JUNIOR_TITLE=/\b(trainee|intern|internship|apprentice|apprenticeship|fresher|freshers|junior|jr|entry[- ]level|graduate engineer|graduate trainee|diploma trainee|werkstudent|praktikant|stagiaire|L1|L2)\b|\bassociate\b(?!\s+(?:director|vice|manager|principal|partner|general|head|lead))/i;
/** The top of the largest stated experience range ("2 to 4 years", "1-3 years"); 0 when the posting gives no range. */
export function yearsCeiling(text:string){let best=0;const re=/(?<![\w.])(\d{1,2}(?:\.\d)?)\s*(?:-|–|to)\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*years?\b/gi;let m:RegExpExecArray|null;while((m=re.exec(text||''))){const lo=Number(m[1]),hi=Number(m[2]);if(lo>=0&&hi>lo&&hi<=25&&hi>best)best=hi;}return best;}
export function underLevel(title:string,description:string,have:number){
 if(!(have>=5))return false;
 if(JUNIOR_TITLE.test(title||''))return true;
 const top=yearsCeiling(description||'');
 return top>0&&top<=have/2;
}
// A role built around one enterprise platform (title names it) that the candidate's skills do not list: "Workday Time & Absence Implementation Lead"
// matched Farhan's "implementation" and scored 80. Capped (plan S7), not excluded: a person may still want it.
const PLATFORMS=['workday','sap','servicenow','netsuite','peoplesoft','successfactors','dynamics 365','d365','salesforce','hubspot','zoho','oracle','guidewire','veeva','coupa','kronos','ukg','adp','snowflake','databricks','pega','appian','mulesoft','boomi','sharepoint','jira','zendesk','marketo','shopify','magento','odoo'];
export function platformGap(title:string,skills:unknown){
 const t=' '+String(title||'').toLowerCase().replace(/[^a-z0-9]+/g,' ')+' ';
 const mine=' '+list(skills).join(' ').toLowerCase().replace(/[^a-z0-9]+/g,' ')+' ';
 return PLATFORMS.find((p)=>t.includes(' '+p+' ')&&!mine.includes(' '+p+' '))||null;
}
// Sana's "reliability" means plant and asset reliability. Software reliability (SRE, DevOps, cloud) and product hardware testing match the
// word but not the work (owner review 2026-11-12: "Senior Site Reliability Engineer" and "Hardware Test and Reliability Engineer" in her top 100).
const SANA_AVOID=/\bhardware\b|\b(?:ai|cyber|information|it|network|cloud|application|data)\s+security\b|\bcybersecurity\b|\bsoftware\b|\bsite reliability\b|\bSRE\b|\bsoftware reliability\b|\breliability (?:software|data|platform)\b|\bhardware test|\btest (?:and|&) reliability\b|\bdevops\b|\bcloud\b|\bnetwork reliability\b|\b(?:it|network|security|data|platform) operations\b|\bpower (?:bi|apps?|platform|automate|electronics)\b|\bdeveloper\b|\bsales\b|\bmarketing\b|\baircraft\b|\baviation\b|\bplant[- ]based\b|\b(?:business|data|financial|finance|bi|sales|market(?:ing)?|research|it|systems?|credit|risk|reporting|esg)\s+analyst\b|\bsegment manager\b|\b(?:java|angular|databricks|snowflake|sfmc|grc|tenant migration)\b|\b(?:business|digital|enterprise|solutions?|it|data|cloud|technical)\s+architect\w*|\bdigital architecture\b|\bmarine\b|\byachts?\b|\basic\b|\bsilicon\b/i;   // jobs QA 13 Nov: IT stack, consulting architecture and marine / yacht electrical titles   // plan S4: one matching word (power, energy, plant, reliability) is not enough
// Plan A5: role families for the shortlist's variety rules (scripts/shortlist_select.mjs). The first match in this order wins; no match is
// 'unclassified'. Not used by evaluate() and not stored; the India Remote page filter keeps listing.ts ROLE_FAMILIES.
const FAMILIES:Record<string,[string,RegExp][]>={
 farhan_shaikh:[
  ['revops_crm',/rev(enue)? ?ops|revenue operations|\bcrm\b|sales op|marketing (ops|operations|automation)|gtm (engineer|operations)/i],
  ['implementation',/implement|onboarding|deployment (strategist|manager|lead|specialist)|professional services/i],
  ['automation_ai',/automation|\bai\b|workflow|no-?code|low-?code|integration/i],
  ['technical_delivery',/technical delivery|delivery (manager|lead)|program manager|project manager/i],
  ['business_systems',/business systems|systems (analyst|architect|administrator)|internal tools/i],
  ['solutions',/solutions?|technical account|customer engineer/i],
  ['operations_general',/operations|chief of staff/i],
 ],
 sana_ansari:[
  ['maintenance',/maintenance|o ?& ?m|breakdown|shutdown|turnaround|overhaul|rotating|static equipment/i],
  ['reliability_asset',/reliability|asset (performance|management|integrity)|condition monitoring|vibration/i],
  ['energy_decarb',/energy (efficiency|manager|management|audit|engineer)|decarboni[sz]|net[- ]?zero|carbon|emission|sustainability/i],
  ['plant_operations',/power plant|plant (operations|engineer)|shift (in-?charge|engineer)|control room|boiler|turbine|thermal|hydro|operations engineer/i],
  ['utilities',/utilit|hvac|water treatment|compressed air|facilit/i],
  ['commissioning_projects',/commissioning|project engineer|projects? manager|construction|erection|site engineer/i],
  ['electrical',/electrical|substation|switchgear|transmission|distribution|hvdc|protection/i],
  ['field_consulting',/field service|consultant|advisor|specialist/i],
 ],
};
export function familyOf(candidateId:string,title:string):string{
 for(const [key,re] of FAMILIES[candidateId]||[])if(re.test(title||''))return key;
 return 'unclassified';
}
// Plan A6: place bands for the shortlist's variety rules (scripts/shortlist_select.mjs), built on S1 (Indian places), S5 (worldwide wording) and S9
// (Gulf places). Not used by evaluate() and not stored.
//   gulf               a Gulf place
//   remote             remote and workable from India: India named, worldwide, or no other country named. For Farhan a worldwide posting is
//                      'remote_global' instead (his "at least 3 worldwide" rule counts those alone)
//   india_onsite       on site in India
//   abroad_with_route  on site abroad with a stated visa route
//   other              everything else (remote limited to another country, on site abroad with no route, no place at all)
const BAND_WORLDWIDE=/\b(?:anywhere|worldwide|global|fully remote)\b|work from anywhere|any time ?zone/i;
const BAND_ROUTE=/\b(?:visa sponsorship|sponsorship (?:is )?available|sponsor (?:your |a |the )?(?:work )?visa|work permit (?:support|sponsorship|provided)|employment visa|relocation (?:assistance|support|package|provided))\b/i;
const BAND_NO_ROUTE=/\b(?:no|not|unable to|cannot|can't|without|does not|do not|will not)\b[^.]{0,40}\b(?:visa|sponsor)/i;
/** Jobs QA 4: a place that is itself worldwide ('Anywhere in the World', 'Remote (Worldwide)', 'Remote, Global') and names no country or region.
 *  For Farhan's Stretch rule an unconfirmed row with such a place is as open to India as one naming India (scripts/shortlist_select.mjs). */
export function worldwidePlace(location:string|null|undefined){
 const l=location||'';return /\b(?:anywhere|worldwide|global)\b/i.test(l)&&!foreignLocation(l)&&!usOnlyLocation(l)&&!/\b(?:emea|europe|latam|americas|north america|canada|uk)\b/i.test(l);
}
export function placeBand(candidateId:string,location:string|null|undefined,workplace:string|null|undefined,remote:boolean|null|undefined,description:string|null|undefined):string{
 const loc=location||'',text=description||'';
 if(gulfPlace(loc))return 'gulf';
 const isRemote=!!remote||remoteFromStored(workplace,loc);
 if(isRemote){
  const lc=locationClass(text,loc);
  const placeFree=!foreignLocation(loc)&&!usOnlyLocation(loc)&&!indianPlace(loc);
  const worldwide=lc==='worldwide'||(placeFree&&(BAND_WORLDWIDE.test(loc)||(candidateId==='farhan_shaikh'&&/\b(?:apac|asia)\b/i.test(loc))));   // S5: 'Remote - APAC' counts for Farhan
  if(worldwide&&lc!=='us_only'&&lc!=='eu_only')return candidateId==='farhan_shaikh'?'remote_global':'remote';
  if(indianPlace(loc)||lc==='india_ok')return 'remote';
  if(!foreignLocation(loc)&&!usOnlyLocation(loc)&&lc==='unknown')return 'remote';
  return 'other';
 }
 if(sanaIndiaCity(loc))return 'india_onsite';
 if(loc.trim()&&BAND_ROUTE.test(text)&&!BAND_NO_ROUTE.test(text))return 'abroad_with_route';
 return 'other';
}
// Jobs QA 13 Nov: an IT "Technical Consultant" (Java, Databricks, SFMC...) is not her field; the title must also name her kind of plant or work.
const SANA_CONSULT=/\b(?:technical|engineering) consult/i, SANA_CONSULT_FIELD=/\b(?:power|energy|plant|utilit\w*|water|electrical|maintenance|reliability|o ?& ?m|boiler|turbine|thermal|grid|substation|decarboni[sz]\w*)\b/i;
export function avoidedTitle(candidateId:string,title:string){
 if(candidateId==='sana_ansari'){const t=title||'';return SANA_AVOID.test(t)||(SANA_CONSULT.test(t)&&!SANA_CONSULT_FIELD.test(t));}
 if(candidateId!=='farhan_shaikh')return false;const t=title||'';
 return FARHAN_HARD_AVOID.test(t)||(FARHAN_REVOPS_ONLY_AVOID.test(t)&&!REVOPS_WORDS.test(t))||(FARHAN_SOFT_AVOID.test(t)&&!FARHAN_TARGET_WORDS.test(t));
}
// Indian places (plan S1): the country, every state and union territory, the main cities, and the plant and industrial towns where Sana's
// employers post (Jamnagar, Mundra, Raigarh...). A name India shares with another country's place (INDIA_NAMESAKE: Punjab, Hyderabad, Kochi...) is
// not Indian when the location names another country and not India ('Lahore, Punjab, Pakistan', 'Kochi, Japan'); 'Bangalore / London' still is.
const INDIA_PLACE=new RegExp('\\b(?:'+[
 'india','bharat',
 // states and union territories
 'andhra pradesh','arunachal pradesh','assam','bihar','chhattisgarh','goa','gujarat','haryana','himachal pradesh','jharkhand','karnataka','kerala',
 'madhya pradesh','maharashtra','manipur','meghalaya','mizoram','nagaland','odisha','orissa','punjab','rajasthan','sikkim','tamil nadu','telangana',
 'tripura','uttar pradesh','uttarakhand','uttaranchal','west bengal','andaman','nicobar','chandigarh','dadra','nagar haveli','daman and diu','delhi','ncr',
 'jammu','kashmir','ladakh','lakshadweep','puducherry','pondicherry',
 // cities
 'bengaluru','bangalore','mumbai','bombay','pune','hyderabad','secunderabad','chennai','madras','noida','greater noida','gurugram','gurgaon','faridabad',
 'ghaziabad','kolkata','calcutta','ahmedabad','gandhinagar','kochi','cochin','jaipur','coimbatore','madurai','tiruchirappalli','trichy','thane','navi mumbai',
 'lucknow','kanpur','indore','bhopal','surat','rajkot','vijayawada','bhubaneswar','cuttack','patna','ranchi','raipur','guwahati','dehradun','ludhiana',
 'amritsar','mysuru','mysore','thiruvananthapuram','trivandrum','kozhikode','calicut','nellore','warangal','aurangabad','kolhapur','belagavi','belgaum',
 'hubli','dharwad','jodhpur','udaipur','ajmer','bikaner','varanasi','prayagraj','allahabad','agra','meerut','gwalior','jabalpur','durgapur','asansol','siliguri','haldia',
 // plant and industrial towns
 'jamnagar','dahej','bharuch','hazira','mundra','kandla','vadodara','baroda','ankleshwar','sanand','halol','raigarh','korba','bhilai','angul','jharsuguda',
 'talcher','paradip','rourkela','jamshedpur','bokaro','dhanbad','singrauli','sasan','vindhyachal','anpara','obra','panipat','mathura','bathinda','ropar',
 'rupnagar','nashik','chakan','ranjangaon','raigad','ratnagiri','tarapur','chandrapur','nagpur','hosur','ennore','tuticorin','thoothukudi','neyveli','mettur',
 'kudankulam','kakinada','krishnapatnam','vizag','visakhapatnam','ramagundam','kothagudem','bellary','ballari','toranagallu','udupi','mangaluru','mangalore',
 'baddi','haridwar','pantnagar','sricity','sri city',
].join('|')+')\\b','i');
const FOREIGN_NAME=/\b(latin america|south america|central america|caribbean|africa|balkans|nordics|scandinavia|dach|benelux|north macedonia|macedonia|kosovo|montenegro|nicaragua|mozambique|namibia|malawi|mongolia|fiji|türkiye|brasil|espana|osterreich|nederlands?|deutschland|españa|italia|österreich|schweiz|san jose|san diego|port harcourt|abuja|houston|phoenix|charlotte|united states|usa|united kingdom|uk|japan|tokyo|stockholm|sweden|philippines|manila|london|germany|berlin|munich|france|paris|spain|madrid|barcelona|netherlands|amsterdam|ireland|dublin|poland|warsaw|canada|toronto|vancouver|australia|sydney|melbourne|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|dallas|miami|emea|europe|latam|north america|americas|mexico|brazil|singapore|dubai|uae|united arab emirates|afghanistan|albania|algeria|andorra|angola|argentina|armenia|austria|azerbaijan|bahrain|bangladesh|belarus|belgium|bolivia|bosnia|botswana|bulgaria|cambodia|cameroon|chile|china|colombia|costa rica|croatia|cuba|cyprus|czechia|czech republic|denmark|dominican republic|ecuador|egypt|el salvador|estonia|ethiopia|finland|georgia|ghana|greece|guatemala|honduras|hong kong|hungary|iceland|indonesia|iran|iraq|israel|italy|ivory coast|jamaica|jordan|kazakhstan|kenya|korea|kuwait|latvia|lebanon|lithuania|luxembourg|malaysia|malta|mauritius|moldova|morocco|nepal|new zealand|nigeria|norway|oman|pakistan|panama|paraguay|peru|portugal|puerto rico|qatar|romania|russia|rwanda|saudi arabia|senegal|serbia|slovakia|slovenia|south africa|sri lanka|switzerland|taiwan|tanzania|thailand|tunisia|turkey|turkiye|uganda|ukraine|uruguay|uzbekistan|venezuela|vietnam|zambia|zimbabwe|athens|lisbon|porto|prague|budapest|bucharest|vienna|zurich|geneva|brussels|copenhagen|oslo|helsinki|cairo|lagos|nairobi|cape town|johannesburg|tel aviv|istanbul|riyadh|doha|bogota|buenos aires|santiago|lima|sao paulo|mexico city|kyiv|sofia|belgrade|zagreb|tallinn|riga|vilnius|krakow|abu dhabi|shanghai|beijing|seoul|taipei|bangkok|jakarta|kuala lumpur|hanoi|ho chi minh|auckland|wellington|brisbane|perth|adelaide|darwin|hobart|pretoria|durban|calgary|ottawa|montreal|cologne|hamburg|frankfurt|milan|rome|lyon|rotterdam|gothenburg|malmo|edinburgh|glasgow|manchester|birmingham|cardiff|belfast|bristol)\b/i;   // every country except India, and the main hiring cities: a posting whose only stated place is one of them is for that place
const FOREIGN_US_DOTTED=/(?:^|[^A-Za-z0-9])u\.s\.(?![A-Za-z0-9])/i;
const FOREIGN_US_BARE=/(?:^|[^A-Za-z0-9.])(?:US|EU|GB)(?![A-Za-z0-9.])/;          // 'Remote - US', 'US Remote' (upper case only, so the word "us" is not matched)
const FOREIGN_STATE=/,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?![A-Za-z])|^\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\s*-\s+[A-Z]/;   // jobs QA 13 Nov: Workday's 'AR - Little Rock' (code first) as well   // US state codes (OR and IN are omitted: ambiguous with the word "or" and India's code; TN stays, with Tamil Nadu places in INDIA_PLACE so 'Coimbatore, TN' is not foreign)
const EXCLUSION_PLACE='(?:US|U\\.S\\.|USA|United States|UK|United Kingdom|EU|Europe|Canada|APAC|EMEA)(?![A-Za-z0-9])';
const EXCLUSION_PHRASE=new RegExp('\\b(?:excl\\.|(?:excluding|excl|except|outside(?: of)?|not including|other than|anywhere but|but not|not|no|non|ex)\\b)[\\s-]*(?:in\\s+)?(?:the\\s+)?'+EXCLUSION_PLACE+'(?:\\s*(?:,\\s*)?(?:,|and|or|&|/)\\s*(?:the\\s+)?'+EXCLUSION_PLACE+')*','gi');   // also consumes lists: \'excluding US and Canada\', \'non-US\', \'(excl. US)\'
// A US state, Canadian province or Australian state written in full after a comma, as the last part of a place ('Houston, Texas', 'Calgary,
// Alberta, Canada', 'Perth, Western Australia'). It must end the place: end of text, a separator, a ZIP / postcode or a country, so a street
// ('12 Washington Street') or a name ('Indiana Jones') is not read as one. Georgia is already in FOREIGN_NAME (the country); Indore, Goa and other
// Indian places never match a whole state name, and a location that also names an Indian place is never foreign (indianPlace below).
const FOREIGN_STATE_NAME=new RegExp(',\\s*(?:'+[
 'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','hawaii','idaho','illinois','indiana','iowa',
 'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada',
 'new hampshire','new jersey','new mexico','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
 'south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming',
 'alberta','british columbia','manitoba','new brunswick','newfoundland(?: and labrador)?','nova scotia','ontario','prince edward island','quebec',
 'saskatchewan','new south wales','queensland','victoria','tasmania','western australia','south australia','northern territory',
].join('|')+')(?=\\s*(?:$|[,;/|()]|-\\s|\\d{4,5}\\b|(?:usa|us|united states|canada|australia)\\b))','i');
// Jobs QA 13 Nov: the job-site feed (SuccessFactors, EURES) gives a bare country code as the whole location ('SE', 'EG', 'UZ', 'SA'). Exactly two capital
// letters are a country abroad, except India's own code and the Indian state and union-territory codes (so 'MH', 'KA', 'TN' or 'GJ' stay Indian; the
// country codes they share, such as BR, NL, CH or TR, are left unread rather than risk reading an Indian state as abroad).
const BARE_CODE=/^\s*([A-Z]{2})\s*(?:\([^)]*\))?\s*$/, INDIA_CODES=new Set(['IN','AN','AP','AR','AS','BR','CG','CH','CT','DD','DH','DL','DN','GA','GJ','HP','HR','JH','JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL','OD','OR','PB','PY','RJ','SK','TG','TN','TR','TS','UK','UP','UT','WB']);
export function bareForeignCode(location:string|null|undefined){const m=BARE_CODE.exec(location||'');return !!m&&!INDIA_CODES.has(m[1]);}
// Jobs QA 3 (16 Nov): career sites write the country as an ISO code at the end of the place, often before a postcode ('Kabirwala, PK, 58150',
// 'Docklands, VIC, au', 'Rojana Industrial Park, TH', 'Bandar Lampung, NULL, id'; 'SE (SE110)' for the bare code). Those places were read as no place
// at all, so a job abroad escaped the visa-route cap that the same job written 'Turkey' or 'Australia' gets. Only codes that are not also an Indian
// state code (so 'TR', 'BR', 'CH', 'NL' or 'AR' stay unread, as for the bare code above); 'IN' is India.
const ABROAD_CODES=new Set(('AE AF AL AM AO AT AU AZ BA BD BE BG BH BO BW BY CA CD CL CM CN CO CR CU CY CZ DE DK DO DZ EC EE EG ES ET FI FJ FR GB GE GH GR GT HK HN HU ID IE IL IQ IR IS IT JM JO JP KE KG KH KR KW KZ LB LK LT LU LV LY MA MD ME MK MM MO MT MU MX MY NG NI NO NP NZ OM PA PE PG PH PK PL PR PT QA RO RS RU RW SA SE SG SI SN SV TH TT TW TZ UA UG US UY UZ VE VN ZA ZM ZW').split(' '));
// Three-letter codes too ('Taber, AB, CAN (Plant)', 'Limerick, IRL'), read as their two-letter code.
const ISO3:Record<string,string>={CAN:'CA',IRL:'IE',GBR:'GB',DEU:'DE',AUS:'AU',MEX:'MX',BRA:'BR',CHN:'CN',FRA:'FR',ESP:'ES',ITA:'IT',NLD:'NL',BEL:'BE',POL:'PL',SWE:'SE',NOR:'NO',DNK:'DK',FIN:'FI',AUT:'AT',CHE:'CH',PRT:'PT',CZE:'CZ',ROU:'RO',HUN:'HU',TUR:'TR',ZAF:'ZA',SGP:'SG',MYS:'MY',THA:'TH',IDN:'ID',PHL:'PH',VNM:'VN',JPN:'JP',KOR:'KR',NZL:'NZ',ARG:'AR',CHL:'CL',COL:'CO',PER:'PE',EGY:'EG',NGA:'NG',KEN:'KE',SAU:'SA',ARE:'AE',QAT:'QA',OMN:'OM',KWT:'KW',BHR:'BH',USA:'US'};
const TRAILING_CODE=/,\s*([A-Za-z]{2,3})\s*(?:\([^)]*\))?\s*(?:,\s*\d[\dA-Za-z -]{2,9})?\s*$/;
export function trailingCountryCode(location:string|null|undefined):string|null{const m=TRAILING_CODE.exec(location||'');if(!m)return null;const raw=m[1].toUpperCase(),c=raw.length===3?(ISO3[raw]||''):raw;return c&&(ABROAD_CODES.has(c)||(raw.length===3&&c!=='IN'))?c:null;}
// A US site written 'City ST' with no comma, as Workday lists them ('Indianapolis IN', 'Cleburne TX', 'Waukesha WI; +1 more'): the whole place, or
// the first of several. Upper-case state codes only, and not those that are also Indian state codes or common words.
const US_SITE=/\b[A-Z][a-z]+ (?:AL|AK|AZ|CA|CO|DE|FL|HI|IA|ID|IL|KS|KY|MA|MD|ME|MI|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TX|VA|VT|WA|WI|WV|WY)\s*(?:;|$)/;
// Other site formats of the same feeds: a country code first ('CN - Qingdao', 'CAN-Ontario-Guelph', 'US.NC.Raleigh'), a Canadian province code last
// ('Milton, ON'), and a US state code after an Indian city's namesake ('Delhi, NY': New York). Codes shared with Indian states are left unread.
const LEADING_CODE=/^\s*([A-Z]{2,3})\s*(?:-\s*|\s-\s+|\.)(?=[A-Z])/, PROVINCE_CODE=/,\s*(?:ON|BC|AB|QC|MB|NS|NB|PE)\s*$/;
const US_STATE_LAST=/,\s*(?:AL|AK|AZ|CA|CO|DE|FL|HI|IA|ID|IL|KS|KY|MA|MD|ME|MI|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TX|VA|VT|WA|WI|WV|WY)\s*(?:,\s*(?:US|USA))?\s*(?:\d{5})?\s*$/;
// 'Remote - Colorado', 'Remote (Texas)': remote within a US state, Canadian province or Australian state named in full.
const REMOTE_STATE_NAME=new RegExp(FOREIGN_STATE_NAME.source.replace(/^,\\s\*/,'\\bremote\\s*[-–(:]\\s*'),'i');
export function codedForeignPlace(location:string|null|undefined){
 const l=location||'';if(/\b(?:india|bharat)\b/i.test(l))return false;
 const m=LEADING_CODE.exec(l);if(m){const raw=m[1],c=raw.length===3?(ISO3[raw]||''):raw;if(c&&c!=='IN'&&(ABROAD_CODES.has(c)||raw.length===3))return true;}
 return PROVINCE_CODE.test(l)||US_STATE_LAST.test(l);
}
/** True when the only stated location is outside India. A location that also names an Indian place is never foreign. */
export function foreignLocation(location:string){
 const l=foldAccents(location).replace(/_/g,' ').replace(EXCLUSION_PHRASE,' ');if(!l.trim()||indianPlace(l))return false;   // 'Remote, excluding the US' is not a US location; jobs QA 4: 'DNU_United States - Remote'
 return bareForeignCode(l)||!!trailingCountryCode(l)||US_SITE.test(l)||codedForeignPlace(l)||REMOTE_STATE_NAME.test(l)||FOREIGN_NAME.test(l)||FOREIGN_US_DOTTED.test(l)||FOREIGN_US_BARE.test(l)||FOREIGN_STATE.test(l)||FOREIGN_STATE_NAME.test(l);
}
/** Plan B2: a location that gives no place ('3 Locations', or empty) and a description that names only places outside India and the Gulf is abroad
 *  for Sana's visa-route cap ('Maintenance Engineer, 4 Locations' whose text is all about sites in Texas). A description that also names an Indian or
 *  Gulf place is not, and neither is one that names no place at all. */
export const COUNT_LOCATION=/^\s*(?:\d+\s+locations?)?\s*$/i;
export function abroadByDescription(location:string|null|undefined,description:string|null|undefined){
 if(!COUNT_LOCATION.test(location||''))return false;
 const d=String(description||'').replace(EXCLUSION_PHRASE,' ');
 if(!d.trim()||INDIA_PLACE.test(d)||GULF_PLACE.test(d))return false;
 return FOREIGN_NAME.test(d)||FOREIGN_US_DOTTED.test(d)||US_ONLY_PLACE.test(d)||US_CITY_STATE.test(d)||US_CITY_COMMA_STATE.test(d)||US_TEXT.test(d);
}
// Jobs QA 13 Nov (SOLV Energy, Travelers): 'Little Rock, AR' in the text, 'nationwide', or a dollar salary ('$85,000'). Upper-case codes after a capitalised
// place name only (not ', CO2'); a rupee or 'Rs' salary is not a dollar one. Only read when the location itself gives no place (above).
const US_CITY_COMMA_STATE=/\b[A-Z][a-z]+(?: [A-Z][a-z]+)?,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?![A-Za-z0-9])/, US_TEXT=/\bnationwide\b|\$\s?\d{2,3},\d{3}\b/i;
// A US city with its state code and no comma, as postings list their sites ('Archbold OH, Troy OH, Centralia IL'). Upper case only; codes that are
// also common words or titles (IN, OR, ME, HI, OK, DE, PA, MD) are left out.
const US_CITY_STATE=/\b[A-Z][a-z]+(?: [A-Z][a-z]+)? (?:AL|AK|AZ|AR|CA|CO|CT|FL|GA|IA|ID|IL|KS|KY|LA|MA|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b(?![a-z])/;
/** The Worker's remote test, expressed on what is stored: workplace_type REMOTE* (the posting's own remote flag) or remote wording in its location. */
export function remoteFromStored(workplaceType:string|null|undefined,location:string|null|undefined){
 return /^REMOTE/i.test(workplaceType||'')||/\b(remote|work from home|telecommut)/i.test(location||'');
}
/** Skill-based preliminary score, exactly as evaluate() computes it for a role-matched posting. */
export function roleScore(skills:number,eligible:boolean){return Math.min(90,40+skills*8+(eligible?10:0));}
/** The Worker's own test for an Indian location in evaluate(): an Indian place (plan S1: states, cities and plant towns) or the country code 'IN' at the end. */
// Jobs QA 3 (16 Nov): 'Lafayette, IN', 'Hammond, IN' and 'WOODBURN, IN' are Indiana, US sites (Workday), read as India because 'IN' is also India's
// code ('Pithampur, IN', 'Patiala, IN' are Indian). A place that is only 'City, IN', with a city the rules do not know as Indian, is Indiana when the
// posting's text reads American (Indiana, the United States, a 401(k), a dollar amount) or it comes from Workday (whose Indian sites are written
// 'Pune, India' or 'IND - ...'; SuccessFactors writes the ISO code, 'Pithampur, IN'), and the text names no Indian place.
const CITY_IN=/^[^,]+,\s*IN\s*$/;
export function indianaPlace(location:string|null|undefined,description:string|null|undefined,source?:string|null,url?:string|null){
 const l=location||'',d=String(description||'');
 if(!CITY_IN.test(l)||indianPlace(l)||/\b(?:india|bharat)\b/i.test(d)||INDIA_PLACE.test(d))return false;
 return /^workday$/i.test(String(source||'').trim())||/\.myworkdayjobs\.com\b/i.test(String(url||''))||/\bindiana\b|\b(?:united states|usa)\b|\bu\.s\.|\b401\s?\(?k\)?(?![a-z])|\$\s?\d/i.test(d);
}
export function sanaIndiaCity(location:string|null|undefined){const l=location||'';return indianPlace(l)||/(?:^|, )in$/i.test(l)||sanaIndiaPin(l);}   // jobs QA 4: 'Bap, IN, 342301'
/** True when the location names a place in India (and not only a neighbour's place of the same name). Also decides that a location is NOT foreign. */
const INDIA_NAMESAKE=/\b(?:punjab|hyderabad|kochi|surat|kashmir|ncr)\b/gi;   // also places in Pakistan, Japan, Thailand and the Philippines (NCR = Metro Manila)
// Jobs QA 8 (recall audit): career sites write an Indian town the rules do not list as 'Town, <state code>, IN[, PIN]' ('Cuddalore, TN, IN',
// 'Sriperumbudur, TN, IN, 602105'); the state code was read as a US state (TN), so the job got the visa cap. A state code followed by the country
// code IN is India. 'Little India' is a district of Singapore, not India.
export const INDIA_STATE_CODED=/,\s*(?:AN|AP|AR|AS|BR|CG|CH|CT|DD|DL|DN|GA|GJ|HP|HR|JH|JK|KA|KL|LA|LD|MH|ML|MN|MP|MZ|NL|OD|OR|PB|PY|RJ|SK|TG|TN|TR|TS|UK|UP|UT|WB)\s*,\s*IN\s*(?:,\s*\d{3}\s?\d{3})?\s*$/i;
const LITTLE_INDIA=/\blittle\s+india\b/gi;
export function indianPlace(location:string|null|undefined){const l=String(location||'').replace(LITTLE_INDIA,' ');if(INDIA_STATE_CODED.test(l))return true;if(!INDIA_PLACE.test(l))return false;if(!/\b(?:india|bharat)\b/i.test(l)&&(US_STATE_LAST.test(l)||PROVINCE_CODE.test(l)))return false;   // jobs QA 3: 'Delhi, NY'
 if(/\b(?:india|bharat)\b/i.test(l)||!FOREIGN_NAME.test(l))return true;return INDIA_PLACE.test(l.replace(INDIA_NAMESAKE,' '));}
export const SANA_OLD_ACCESS_REASON='Posting is in an accessible Indian location.';
export const SANA_INDIA_ONSITE_REASON='On-site or hybrid in India: workable for the candidate (owner decision 2026-11-12).';
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

// A skill counts when its exact phrase appears (the original rule), or, for a multi-word skill, when at least two of its key
// words appear as words close together in the posting ("CRM Configuration" matches "configure the CRM"; "Workflow Automation"
// matches "automation of workflows"). A key word may take a short ending (configure/configuration) but must be a word of its own,
// so "sales" never matches "salary"; a single-word skill only ever matches exactly. Only adds matches (2026-11-06).
const SKILL_STOP=new Set(['and','the','for','with','of','in','on','to','a','an','assisted','based','team','skills','experience']);
const SKILL_WINDOW=80;
const stem=(w:string)=>{const t=w.replace(/(ations?|ing|ed|es|s)$/,'');return t.length>=4?t:w;};
const escRe=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// QA2 14 Nov: a named CRM or automation platform is evidence of the CV skill it stands for (HubSpot or ActiveCampaign work is CRM configuration).
const SKILL_ALIAS:Record<string,RegExp>={'crm configuration':/\b(?:hubspot|salesforce|activecampaign|pipedrive|zoho crm|highlevel|keap|close\.com)\b/,'workflow automation':/\b(?:zapier|make\.com|n8n|workato|power automate)\b/};
export function skillFound(skill:string,lower:string){
 const s=String(skill||'').toLowerCase().trim();
 if(!s)return false;
 if(lower.includes(s))return true;
 const raw=s.split(/[^a-z0-9+#]+/).filter(Boolean);
 if(raw.length<2)return false;
 const words=raw.filter(w=>w.length>=3&&!SKILL_STOP.has(w));
 if(words.length<2)return false;
 const hits=words.map(w=>{const re=new RegExp(`(?:^|[^a-z0-9])(${escRe(stem(w))}[a-z]{0,5})(?![a-z0-9])`,'g');const at:number[]=[];let m:RegExpExecArray|null;while((m=re.exec(lower))&&at.length<50)at.push(m.index);return at;});
 if(hits.some(h=>!h.length))return false;
 // all key words within one window of SKILL_WINDOW characters
 return hits[0].some(p=>hits.slice(1).every(h=>h.some(q=>Math.abs(q-p)<=SKILL_WINDOW)));
}
// ---- Daily-discovery context (owner rules 2026-11-07) -------------------------------------------------------------------
// globalHirers: employer names (normalised) that public, community-kept lists record as hiring worldwide (remoteintech/remote-jobs,
// ISC licence; yanirs/established-remote). rejected: per candidate, employers that rejected them before, with the date.
// yc: Y Combinator companies currently hiring (yc-oss/api), name key -> batch.
export type EvalContext = { globalHirers?: Set<string>; rejected?: Map<string, string | null>; yc?: Map<string, string>; ukSponsors?: Set<string> };
// ---- Signals added 2026-11-07 (owner-approved "10 ideas") ------------------------------------------------------------------
export const TIMEZONE_PENALTY = 10, AGENCY_PENALTY = 5, LANGUAGE_PENALTY = 10;
// Owner rule 2026-11-10 (Sana): a title that is electrical only ranks below mechanical, reliability, maintenance and energy roles.
export const ELECTRICAL_ONLY_PENALTY = 12;
// Jobs QA 13 Nov (live shortlist review): a design, study or simulation post ('Primary Design Engineer - Electrical', 'Power System Study Senior Expert')
// is near her field but not her work; it ranks below maintenance, O&M and reliability posts, without leaving the list.
export const DESIGN_ONLY_PENALTY = 8, DESIGN_ONLY_HEADROOM = 4;
const DESIGN_TITLE = /\b(?:design|study|studies|simulation|modell?ing)\b/i, HANDS_ON_TITLE = /maintenance|o ?& ?m\b|reliab|operations?|commissioning|shutdown|overhaul|asset/i;
const ELECTRICAL_TITLE = /\b(?:electrical|elektro\w*)\b/i, NON_ELECTRICAL_FIT = /mechanical|reliab|maintenance|rotating|turbine|boiler|plant|energy|efficiency|commission|operations?|process/i;
const EU_ONLY = /\b(must (?:be |reside |live )?(?:based |located |resident )?in (?:the )?(?:eu|eea|european union|europe)|(?:eu|eea|european union)[- ]?(?:only|based only|residents? only|work (?:permit|authori[sz]ation) required)|right to work in the (?:eu|uk|eea|netherlands|germany) (?:is )?required|(?:eu|eea) citizens? only)\b/i;
const TZ_RESTRICTED = /\b(?:(?:us|u\.s\.|north american?|eastern|pacific|central|est|pst|cst|cet|uk|european?) (?:time ?zones?|business hours|working hours|hours)|overlap with (?:us|u\.s\.|pacific|eastern|north american?|cet|european?) (?:time|hours|time ?zones?)|work(?:ing)? (?:us|u\.s\.|pst|est) hours|(?:between|within|at least) \d+ ?(?:hours?|hrs?) (?:of )?overlap)\b/i;
// Farhan's foreign-place rule (jobs QA 13 Nov): place words that keep a foreign place open to India, and text that hires from India or APAC.
const OPEN_PLACE_WORDS=/\b(?:india|apac|asia|worldwide|anywhere|global)\b/i;
const INDIA_HIRING_TEXT=/\b(?:based|located|living|resid\w*|candidates?|applicants?|hiring|hire|work(?:ing)?|time ?zones?)\b[^.!?]{0,40}\b(?:india|apac|asia)\b/i;
/** Where a remote posting really allows the person to be. Read from its own words only. */
export function locationClass(text: string, location: string): 'worldwide' | 'india_ok' | 'us_only' | 'eu_only' | 'timezone' | 'unknown' {
  const t = `${location || ''} ${text || ''}`;
  if (/\b(remote (?:in|from|within|[-–]) india|india[- ]remote|hiring (?:remote workers|remotely) (?:in|from) india|anywhere in india)\b/i.test(t)) return 'india_ok';
  if (/worldwide remote|remote worldwide|remote.?global|work from anywhere|anywhere in the world|fully distributed|any time ?zone|all time ?zones/i.test(t)) return 'worldwide';
  if (/\b(us|usa|u\.s\.|united states)\s+(?:residents?\s+)?only\b|must (?:reside|be based|be located|live) in (?:the )?(?:us|usa|united states)|authori[sz]ed to work in the (?:us|united states)/i.test(t)) return 'us_only';
  if (EU_ONLY.test(t)) return 'eu_only';
  if (TZ_RESTRICTED.test(t)) return 'timezone';
  return 'unknown';
}
// Plan S9: an engineering consultancy (Worley, Fichtner Consultants) is an employer, not a staffing agency, so a bare 'consultants' no longer counts.
const AGENCY_NAME = /\b(recruit(?:ing|ment|ers?)?|staffing|talent (?:solutions|partners|acquisition|group)|manpower|headhunt|placements?|hr (?:solutions|services|consultants?)|workforce|resourcing|executive search)\b/i;
const AGENCY_TEXT = /\b(our client|on behalf of (?:our|a) client|for one of our clients?|a leading client|client of ours|is recruiting (?:on behalf|for a))\b/i;   // 'for our clients' alone is how firms describe their own customers (plan S9)
/** A staffing agency or recruiter posting (common in Gulf O&M postings). */
export function agencyPosting(company: string, description: string) { return AGENCY_NAME.test(company || '') || AGENCY_TEXT.test((description || '').slice(0, 1500)); }
const LANG_RULES: [RegExp, string][] = [
  [/\b(flie(?:ß|ss)end(?:e|es|er)? deutsch|deutsch(?:kenntnisse)? (?:auf )?(?:c1|c2|muttersprach|verhandlungssicher|flie(?:ß|ss)end)|german (?:is )?(?:required|mandatory|essential|a must)|fluent (?:in )?german|verhandlungssicheres? deutsch)\b/i, 'German'],
  [/\b(dutch (?:is )?(?:required|mandatory|essential|a must)|fluent (?:in )?dutch|nederlands(?:e taal)? (?:is )?(?:vereist|verplicht)|vloeiend nederlands)\b/i, 'Dutch'],
  [/\b(french (?:is )?(?:required|mandatory|essential|a must)|fluent (?:in )?french|fran(?:ç|c)ais (?:courant|exig(?:é|e)|obligatoire|requis)|ma(?:î|i)trise du fran(?:ç|c)ais)\b/i, 'French'],
  [/\b(arabic (?:is )?(?:required|mandatory|essential|a must)|fluent (?:in )?arabic|arabic speakers? only)\b/i, 'Arabic'],
  [/\b(spanish (?:is )?(?:required|mandatory|essential|a must)|fluent (?:in )?spanish|espa(?:ñ|n)ol (?:nativo|fluido|imprescindible))\b/i, 'Spanish'],
];
const DE_WORDS = /\b(und|der|die|das|mit|für|wir|sie|ihre|unsere|bei|nicht|eine|einen|werden|sind|oder|auch|aus|dem)\b/g;
const FR_WORDS = /\b(et|les|des|pour|vous|nous|une|dans|est|sont|avec|sur|votre|notre|par|aux|cette|leur)\b/g;
const NL_WORDS = /\b(en|het|een|van|voor|wij|zijn|met|niet|ook|onze|jouw|bij|naar|wordt|worden|als|dat)\b/g;
/** A language the posting plainly requires, or is written in (German, Dutch, French, Arabic, Spanish); null when English or unclear. */
export function languageRequired(title: string, description: string): string | null {
  const t = `${title || ''} ${description || ''}`;
  for (const [re, name] of LANG_RULES) if (re.test(t)) return name;
  const body = (description || '').slice(0, 3000).toLowerCase(), words = Math.max(1, body.split(/\s+/).length);
  if (words < 40) return null;
  const score = (re: RegExp) => ((body.match(re) || []).length) / words;
  if (score(DE_WORDS) > 0.07) return 'German';
  if (score(FR_WORDS) > 0.07) return 'French';
  if (score(NL_WORDS) > 0.08) return 'Dutch';
  return null;
}
const COMPANY_SUFFIX = /(incorporated|inc|llc|ltd|limited|gmbh|corp|corporation|company|co|hq|io|ai|labs|technologies|technology|software|group|pvt|plc|sa|ag|bv)$/;
/** Employer name for matching across sources: 'Perion Network Ltd.' and the ATS slug 'perionnetworkltd' both give 'perionnetwork'. */
export function companyKey(name: string | null | undefined) {
  let k = String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  for (let i = 0; i < 2; i++) { const t = k.replace(COMPANY_SUFFIX, ''); if (t.length >= 3) k = t; }
  return k.length >= 3 ? k : '';
}
// Pay check. Rough conversion to rupees per month (reference rates, 2026-11); only a published pay range is ever compared.
const INR_PER: Record<string, number> = { INR: 1, USD: 85, EUR: 92, GBP: 108, AED: 23, SAR: 22.6, QAR: 23.3, OMR: 220, KWD: 276, BHD: 225, SGD: 64, AUD: 56, CAD: 61, NZD: 51, CHF: 96, JPY: 0.56, PHP: 1.5, MYR: 18 };
const perMonth = (period: string) => /year|annual|yr/.test(period) ? 1 / 12 : /month/.test(period) ? 1 : /week/.test(period) ? 4.33 : /day|daily/.test(period) ? 21.7 : /hour/.test(period) ? 173 : 0;
const GULF_PLACE=/\b(uae|united arab emirates|dubai|abu dhabi|sharjah|saudi|ksa|riyadh|jeddah|dammam|jubail|al[- ]jubail|yanbu|khobar|al[- ]khobar|ras tanura|qatar|doha|ras laffan|oman|muscat|sohar|kuwait|bahrain|manama|ruwais|mesaieed|duqm|salalah)\b/i, GULF_CODE=/,\s*(?:AE|QA|OM|KW|BH)\s*$|^\s*(?:SA|AE|QA|OM|KW|BH)\s*$/;   // jobs QA 13 Nov: a bare 'SA' (the job-site feed's whole location) is Saudi Arabia; ', SA' stays out (South Australia, South Africa)   // country codes upper case only; 'SA' is left out (South Australia, South Africa)   // plan S9: plant towns and country codes ('Ruwais, AE')
// From India, an on-site role abroad (outside the Gulf) with no stated visa route is not a realistic application: it stays in To review,
// ranked below every realistic role, and can never be shortlisted (owner review 2026-11-12: US maintenance jobs offering only
// "relocation assistance" were reaching Ready). Was a fixed 15-point deduction.
/** A place in the Gulf states (used by the screen's visa-route rule and, later, the shortlist's place bands). */
export function gulfPlace(location:string|null|undefined){return GULF_PLACE.test(location||'')||GULF_CODE.test(location||'')||(/[\u0600-\u06FF]/.test(location||'')&&['AE','QA','OM','KW','BH'].includes(trailingCountryCode(location)||''));}   // jobs QA 3: an Arabic place with its code ('مسقط, محافظة مسقط, om'); Latin-script codes stay upper case only, and 'SA' after a comma stays unread (South Australia)
// Gap fix (13 Nov): job boards that refuse the daily still-open check (403 / 999 / timeouts), so their postings are almost never "verified open in
// 4 days" (plan section 10, phase 3). Their job-site search (engine/jobsite_discovery.py) asks only for postings listed in the last 48 hours, so a
// row found in the last LISTED_DAYS was in the board's own listing then. For a Gulf place only, the shortlist (scripts/shortlist_select.mjs) counts
// that as verified for Stretch ("Worth a try"), never for Ready, and the card's why line says it could not be confirmed still open.
export const LISTED_ONLY_HOSTS=['bayt.com','indeed.com','linkedin.com'], LISTED_DAYS=2;
export function listedOnlyHost(url:string|null|undefined){
 let h='';try{h=new URL(String(url||'')).hostname.toLowerCase();}catch{return false;}
 return LISTED_ONLY_HOSTS.some((d)=>h===d||h.endsWith('.'+d));
}
/** A Gulf posting whose posting URL (the one the still-open check visits) is on a board in LISTED_ONLY_HOSTS. */
export function listedOnlyGulf(url:string|null|undefined,location:string|null|undefined){
 return gulfPlace(location)&&listedOnlyHost(url);
}
export const VISA_UNLIKELY_CAP = 45;
// Plan S9: a Gulf posting that gives preference to nationals (Saudization, Emiratization, Omanization) is capped like an unworkable route.
export const NATIONALS_PREFERENCE_CAP = 45;
const NATIONALS_PREFERENCE=/\bpreference (?:will be given |is given |shall be given )?to (?:\w+ )?nationals\b|\b(?:preference|priority|preferred|reserved)\b[^.]{0,40}\b(?:saudi|emirati|omani|qatari|kuwaiti|bahraini)[sz]ation\b|\b(?:saudi|emirati|omani|qatari|kuwaiti|bahraini)[sz]ation\b[^.]{0,40}\b(?:preference|priority|preferred|reserved)\b/i;   // a bare mention is boilerplate (tenth-man review)
const NATIONALS_TITLE=/\b(?:saudi|emirati|uae|qatari|omani|kuwaiti|bahraini)\s+nationals?\b/i;
const NATIONALS_TEXT=/\b(?:saudi|emirati|uae|qatari|omani|kuwaiti|bahraini)\s+nationals?\s+only\b|\b(?:only|exclusively)\s+(?:for\s+|open\s+to\s+)?(?:saudi|emirati|uae|qatari|omani|kuwaiti|bahraini)\s+(?:nationals?|citizens)\b|\bopen\s+(?:only\s+)?to\s+(?:saudi|emirati|uae|qatari|omani|kuwaiti|bahraini)\s+(?:nationals?|citizens)\s+only\b/i;
export const PAY_BELOW_FLOOR_PENALTY = 20, PAY_PREFERRED_BONUS = 5, GLOBAL_HIRER_BONUS = 5, YC_BONUS = 3;
/** Published pay as rupees per month {lo, hi}, or null when the posting gives no usable range. */
export function monthlyInr(salary: any): { lo: number; hi: number } | null {
  if (!salary || typeof salary !== 'object') return null;
  const rate = INR_PER[String(salary.currency || '').toUpperCase()], per = perMonth(String(salary.period || salary.interval || '').toLowerCase());
  const lo = Number(salary.min), hi = Number(salary.max);
  const a = Number.isFinite(lo) && lo > 0 ? lo : null, b = Number.isFinite(hi) && hi > 0 ? hi : null;
  if (!rate || !per || (a === null && b === null)) return null;
  const top = (b ?? a)! * rate * per, bottom = (a ?? b)! * rate * per;
  return top >= 1000 && top < 1e8 ? { lo: Math.round(bottom), hi: Math.round(top) } : null;   // implausible values are ignored
}
const lakhMonth = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}/month`;

// This is a conservative discovery screen, not a substitute for full employer/candidate review.
// Ranking v3 (owner review 2026-11-12: seven of Farhan's top jobs tied at 71). Two small, explainable bonuses separate the role-matched jobs:
// the title names one of the candidate's own target roles (whole phrase +TARGET_EXACT_BONUS, a distinctive word of one +TARGET_WORD_BONUS),
// and an experienced candidate (7+ years) sees a title pitched at their level (+SENIORITY_BONUS). Nothing here changes eligibility or status.
export const TARGET_EXACT_BONUS=8, TARGET_WORD_BONUS=4, SENIORITY_BONUS=3;
const GENERIC_TITLE_WORDS=new Set(['senior','sr','lead','manager','engineer','specialist','consultant','the','and','of','for','in','a','an','with','to','head','principal','staff','associate','director','officer','executive','analyst','coordinator','technical','industrial']);
const words=(s:string)=>String(s||'').toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
const szWords=(x:string)=>words(x).replace(/is(ation|ing|e|ed)\b/g,'iz$1');   // 'Decarbonisation' fits 'Decarbonization Engineer' (plan S11)
/** Plan S4's one-skill exception: the title contains a whole target role INCLUDING its qualifier ('Maintenance Engineer (Power Plant)' needs 'power plant'). */
export function exactWithQualifier(title:string,targets:unknown){
 const full=(x:string)=>' '+String(x||'').toLowerCase().replace(/is(ation|ing|e|ed)\b/g,'iz$1').replace(/[^a-z0-9]+/g,' ').trim()+' ';
 const t=full(title);
 return list(targets).some((raw)=>{const g=full(String(raw)).trim();if(!g)return false;return g.split(' ').every((w)=>t.includes(' '+w+' '))&&t.includes(' '+full(String(raw).replace(/\([^)]*\)/g,' ')).trim()+' ');});
}
// Jobs QA 13 Nov: for Farhan 'operations', 'solutions' and 'architect' are too common to make a title close to one of his targets (Infrastructure
// Operations, Solutions Architect); the +4 needs a distinctive word (implementation, crm, revenue, automation, delivery...). Sana keeps them.
export const FARHAN_GENERIC_TITLE_WORDS=new Set([...GENERIC_TITLE_WORDS,'operations','solutions','architect']);
// Sales, marketing, revenue and go-to-market operations are his RevOps field: 'Sales & Marketing Operations Manager' keeps the +4 (live list review).
const FARHAN_GTM_OPS=/\b(?:sales|marketing|revenue|rev|gtm|go[- ]to[- ]market|crm)\b(?:\s*(?:&|and|,|\/)\s*[a-z]+)?\s+op(?:eration)?s\b|\brevops\b/i;
/** Farhan's +4: a distinctive word of a target role, or a sales / marketing / GTM operations title. */
export function farhanTargetFit(title:string,targets:unknown):'exact'|'word'|null{return targetFit(title,targets,FARHAN_GENERIC_TITLE_WORDS)||(FARHAN_GTM_OPS.test(title||'')?'word':null);}
export function targetFit(title:string,targets:unknown,generic:Set<string>=GENERIC_TITLE_WORDS):'exact'|'word'|null{
 const t=' '+szWords(title)+' ';let partial=false;
 for(const raw of list(targets)){const g=szWords(String(raw));if(!g)continue;
  if(t.includes(' '+g+' '))return 'exact';
  for(const w of g.split(' '))if(w.length>2&&!generic.has(w)&&t.includes(' '+w+' '))partial=true;}
 return partial?'word':null;
}
export const TARGET_SKILL_MAX=2;
const SANA_TITLE_SKILLS:[string,RegExp][]=[
 ['O&M',/\bo ?& ?m\b|\boperations? (?:and|&) maintenance\b/i],
 ['Power Plant',/\b(?:power|thermal|captive|generating) (?:plant|station)s?\b|\bthermal power\b|\(thermal\)/i],
 ['Energy Audit',/\benergy audit/i],
 ['Energy Efficiency',/\benergy efficiency\b|\besco\b/i],
 ['Boiler & Turbine',/\bboilers?\b|\bturbines?\b/i],
 ['Maintenance',/(?<!operations? (?:and|&) )\bmaintenance\b/i],
 ['Reliability',/\breliability\b/i],
 ['Utilities',/\butilities\b|\bwater treatment\b|\bdm plant\b/i],
 ['Switchgear & Substations',/\bswitchgear\b|\bsubstations?\b|\btransformers?\b/i],
 ['Shutdowns',/\bshutdowns?\b|\boverhaul/i],
];
/** Jobs QA 13 Nov: the phrases of Sana's field named in a title, for a posting with no or a very short description (not already among the skills found). */
export function sanaTitleSkills(title:string,have:string[]):string[]{
 const mine=have.map((h)=>String(h).toLowerCase());
 return SANA_TITLE_SKILLS.filter(([name,re])=>re.test(title||'')&&!mine.some((h)=>h.includes(name.toLowerCase().split(' ')[0]))).map(([name])=>name);
}
const TARGET_SKILL_GENERIC=new Set(['maintenance','plant','operations','power','utilities','project','delivery','engineering','transition','energy']);
const sz=(x:string)=>x.replace(/is(ation|ing|e|ed)\b/g,'iz$1');   // decarbonisation / decarbonization
/** The distinctive phrases of the candidate's target roles (generic title words dropped) that the posting names and the skills do not already cover. */
export function targetSkills(targets:unknown,have:string[],lower:string):string[]{
 const text=sz(lower), mine=new Set(have.map((h)=>sz(String(h).toLowerCase()))), out:string[]=[];
 for(const raw of list(targets)){
  const phrase=words(String(raw)).split(' ').filter((w)=>w&&!GENERIC_TITLE_WORDS.has(w)).join(' ');
  if(!phrase||(!phrase.includes(' ')&&TARGET_SKILL_GENERIC.has(phrase)))continue;
  const key=sz(phrase);
  if(mine.has(key)||out.some((o)=>sz(o.toLowerCase())===key))continue;
  if(skillFound(key,text))out.push(phrase.replace(/\b\w/g,(c)=>c.toUpperCase()));
 }
 return out;
}
// Plan C1 (phase 4): what the job involves. Distinct duty phrases of the person's own work counted in the description; each entry counts once
// however often it appears. 'api' and 'pipeline' are left out for Farhan as too generic.
export const DUTY_PHRASES:Record<string,RegExp[]>={
 farhan_shaikh:[/\bconfigur/i,/\bimplement/i,/\bonboard(?:ing)? (?:customers|clients)\b/i,/\bworkflows?\b/i,/\bautomat/i,/\bintegrat/i,/\bzapier\b/i,/\bmake\.com\b/i,/\bn8n\b/i,
  /\bwebhooks?\b/i,/\bgo-?live\b/i,/\bsops?\b/i,/\bprocess (?:design|improvement)\b/i],
 sana_ansari:[/\bpreventive maintenance\b/i,/\bbreakdowns?\b/i,/\bshutdowns?\b/i,/\boverhaul/i,/\brotating equipment\b/i,/\bboilers?\b/i,/\bturbines?\b/i,/\bdcs\b/i,/\bscada\b/i,
  /\bswitchgear\b/i,/\btransformers?\b/i,/\broot cause\b/i,/\brca\b/i,/\breliability\b/i,/\benergy audits?\b/i,/\benergy efficiency\b/i,/\butilities\b/i,/\bcommissioning\b/i,
  /\bpermit to work\b/i,/\bcondition monitoring\b/i,/\bcarbon\b/i,/\bnet[- ]?zero\b/i,/\bemissions?\b/i,/\biso 50001\b/i,/\bheat rate\b/i,/\benergy management\b/i,/\bperformance monitoring\b/i],
};
// Plan C3: the bonuses above the role score stop at a plain ceiling of 92; a job naming many of the person's duties gets up to 3 more on top
// (max(0, min(3, duties - 5))), so the very best are told apart instead of tying at the ceiling. No age is used here (age lives only in the shortlist's order).
export const PLAIN_CEILING=92, SPREAD_MAX=3, SPREAD_FROM=5, SCORE_CEILING=95;
export function spreadBonus(duties:number|null,descriptionLength:number){return duties===null||descriptionLength<DUTY_MIN_TEXT?0:Math.max(0,Math.min(SPREAD_MAX,duties-SPREAD_FROM));}
export const DUTY_MANY=6, DUTY_SOME=3, DUTY_MANY_BONUS=6, DUTY_SOME_BONUS=3, DUTY_NONE_PENALTY=8, DUTY_MIN_TEXT=300, DUTY_NONE_TEXT=600;
/** Plan C1: how many distinct duty phrases of the person's work the description names (null when the person has no list). */
export function dutyCount(candidateId:string,description:string|null|undefined):number|null{
 const list=DUTY_PHRASES[candidateId];if(!list)return null;
 const d=String(description||'');return list.filter((re)=>re.test(d)).length;
}
/** Plan C1: the score change for what the job involves. 6+ duty phrases +6, 3-5 +3; none at all -8, only for a description over 600 characters whose
 *  title is not exactly one of the person's target roles. Nothing below 300 characters (too little text to judge). */
export function dutyAdjust(duties:number|null,descriptionLength:number,exactTitle:boolean){
 if(duties===null||descriptionLength<DUTY_MIN_TEXT)return 0;
 if(duties>=DUTY_MANY)return DUTY_MANY_BONUS;
 if(duties>=DUTY_SOME)return DUTY_SOME_BONUS;
 if(duties===0&&descriptionLength>DUTY_NONE_TEXT&&!exactTitle)return -DUTY_NONE_PENALTY;
 return 0;
}
// Plan C2 (phase 4): a title joining two unrelated functions ('Sales & Marketing Operations Manager', 'Finance and HR Operations Lead') loses a little,
// unless one of the person's target roles is contained exactly. Functions in one group are related ('Maintenance & Reliability', 'Revenue Operations
// & Sales Ops'); 'Operations & Maintenance' and 'O&M' are not mixed.
const FUNCTION_GROUPS:[string,string][]=[
 ['sales','sales|revenue|revops|business development|account management|commercial'],
 ['marketing','marketing|growth|brand|communications|content|seo|demand generation'],
 ['finance','finance|financial|accounting|accounts|treasury|tax|audit|payroll|billing'],
 ['people','hr|human resources|people|talent|recruiting|recruitment'],
 ['legal','legal|compliance|risk'],
 ['it','it|information technology|security|infrastructure'],
 ['data','data|analytics|insights|bi|business intelligence'],
 ['product','product|design|ux'],
 ['customer','customer success|customer support|customer service|support|service delivery'],
 ['supply','supply chain|procurement|purchasing|logistics|warehouse|inventory|sourcing'],
 ['quality','quality|qa|qc|hse|ehs|safety|health|environment'],
 ['admin','admin|administration|office|facilities'],
 ['plant','maintenance|o ?& ?m|reliability|production|manufacturing|projects?'],
];
// 'Operations', 'ops', 'engineering' and 'technical' go with any function (the operations of sales, the engineering of a product): never mixed.
const FUNC_ALT=FUNCTION_GROUPS.map(([,a])=>a).join('|');
const MIXED_TITLE=new RegExp(`\\b(${FUNC_ALT})(?:\\s+(?:operations|ops))?\\s*(?:&|\\band\\b|/|\\+)\\s*(${FUNC_ALT})\\b`,'gi');
const functionGroup=(w:string)=>{const t=w.toLowerCase();for(const [g,a] of FUNCTION_GROUPS)if(new RegExp(`^(?:${a})$`,'i').test(t))return g;return null;};
export const MIXED_TITLE_PENALTY=4;
/** Plan C2: the two unrelated functions a title joins ('Sales & Marketing ...' -> ['sales','marketing']), or null. */
export function mixedTitle(title:string|null|undefined):[string,string]|null{
 const t=String(title||'');MIXED_TITLE.lastIndex=0;let m:RegExpExecArray|null;
 while((m=MIXED_TITLE.exec(t))){const a=functionGroup(m[1]),b=functionGroup(m[2]);if(a&&b&&a!==b)return [a,b];MIXED_TITLE.lastIndex=m.index+m[1].length;}
 return null;
}
// Jobs QA 13 Nov: the dataset's remote flag is wrong for some postings whose own text sets the place ('The position is based in Bengaluru', '#LI-Onsite',
// 'hybrid working with two days a week from our London office'). The posting's text wins over the flag. A sentence that also says remote, or a
// denied mention, does not count. A bare 'hybrid working' is not read (phase 2 tenth-man review: 'we offer flexible hybrid working' is a company perk);
// Xelix's 'hybrid working with two days a week from our London office' is read through its office days.
const ONSITE_TEXT=/\bposition is based (?:in|at|out of)\b|#li[-_ ]?(?:onsite|on-site|hybrid)\b|\b(?:\d|one|two|three|four)\s*(?:-\s*(?:\d|two|three|four|five)\s*)?days?\s+(?:a|per|each)\s+week\s+(?:in|from|at)\s+(?:the|our)\s+(?:[\w-]+\s+){0,3}office/gi;
// Jobs QA 2 (14 Nov): Oracle, Workday and SuccessFactors set the dataset's remote flag on on-site postings (Mashreq, Bengaluru: nothing in the text
// says remote). For those sources the flag counts only when the text or the place also says remote.
// Ashby also sets isRemote on Hybrid postings. Dataset rows carry only that boolean.
const FLAG_DOUBTFUL_SOURCE=/^(?:ashby|oracle|oracle_?hcm|workday|successfactors)$/i, REMOTE_WORDS=/\b(?:remote(?:ly)?|work from home|wfh|home[- ]based|telecommut\w*)\b/i;
export function remoteFlagTrusted(source:string|null|undefined,description:string|null|undefined,location:string|null|undefined){
 return !FLAG_DOUBTFUL_SOURCE.test(String(source||'').trim())||REMOTE_WORDS.test(String(description||''))||REMOTE_WORDS.test(String(location||''));
}
/** The posting's own text places the job in an office (on site or hybrid), whatever the source's remote flag says. */
export function onsiteByText(description:string|null|undefined){
 const d=String(description||'').toLowerCase();ONSITE_TEXT.lastIndex=0;let m:RegExpExecArray|null;
 while((m=ONSITE_TEXT.exec(d))){
  const before=d.slice(Math.max(0,m.index-40),m.index), start=Math.max(d.lastIndexOf('.',m.index),d.lastIndexOf('\n',m.index))+1, end=d.slice(m.index).search(/[.!?\n]/), sentence=d.slice(start,end<0?d.length:m.index+end);
  if(/\b(?:no|not|never|isn't|without)\b[^.!?]*$/.test(before)||(/^(?:position is based|#li)/.test(m[0])&&/\b(?:remote|remotely|work from home|home[- ]based)\b/.test(sentence)))continue;
  return true;
 }
 return false;
}
// Live list review 13 Nov (a 'Remote' place, a US-only text): words that tie a remote job to one country other than India. US payroll and work-permit
// words (401(k), E-Verify, Form I-9, 'authorized to work in the US', 'based in the US'), or 'must be based / located / resident in <country>', 'right to
// work in <country>'. A text that also names India, APAC, Asia, worldwide or hiring globally, or a denied mention ('you do not need to be based in
// the US'), does not count.
const COUNTRY_TEXT=new RegExp('\\b401\\s?\\(?k\\)?(?![a-z])|\\be-?verify\\b|\\bform i-?9\\b|\\b(?:authori[sz]ed|eligible|legally (?:authori[sz]ed|able|permitted)) to work in the (?:us|u\\.s\\.?|united states)(?![a-z])'
 +'|\\b(?:remote(?:ly)?|work|based|located|reside|resident|live|living) (?:anywhere )?(?:in|within|from) the (?:contiguous |continental )?(?:us|u\\.s\\.?|united states)(?![a-z])'
 // Jobs QA 3: 'based remotely within the US', 'work from anywhere within the UK': remote within another named country.
 +'|\\b(?:remote(?:ly)?|anywhere) (?:in|within) (?:the )?'+FOREIGN_NAME.source.replace(/^\\b/,'')
 +'|\\bus[- ]based (?:candidates|applicants|remote|role|position|employees? only)\\b'
 +'|\\b(?:must|should|need to|required to|will need to) (?:be )?(?:based|located|resid(?:e|ent)|live|living) (?:in|within) (?:the )?'+FOREIGN_NAME.source.replace(/^\\b/,'')
 +'|\\bright to work in (?:the )?'+FOREIGN_NAME.source.replace(/^\\b/,'')
 // Integration 15 Nov (Arcadia, US healthcare): the employer's own contact number in the US format, '(781) 202-3600', in a 'Remote' posting with no
 // India / APAC / worldwide wording is a US-market job.
 +'|\\(\\d{3}\\)\\s?\\d{3}-\\d{4}(?!\\d)','gi');
export function remoteCountryByText(description:string|null|undefined){
 const d=String(description||'').toLowerCase();
 if(!d.trim()||/\b(?:india|apac|asia|worldwide|globally|anywhere in the world|any country)\b/.test(d))return false;
 COUNTRY_TEXT.lastIndex=0;let m:RegExpExecArray|null;
 while((m=COUNTRY_TEXT.exec(d))){const before=d.slice(Math.max(0,m.index-40),m.index);if(!/\b(?:no|not|never|without|don't|do not|needn't)\b[^.!?]*$/.test(before))return true;}
 return false;
}
// Jobs QA 5 (19 Nov, enspired 'Senior Virtual Power Plant Operations Expert', place 'Remote job': 'We can only consider candidates based in Austria,
// Belgium, Germany, the Netherlands, Slovakia, Spain, and the UK ... provided the candidate holds the right to work'): the posting admits only people
// who already live in, or may already work in, named countries. A requirement ('only consider candidates based in', 'must be based in', 'must have
// the right to work in', 'must hold a valid work permit for', 'must be eligible to work in <country> without sponsorship', 'EU work authorisation
// required') followed, in the same sentence, by places abroad and none in India. A denied one ('you do not need to be based in the UK'), 'eligible
// to work in India', the employer's own duties ('we must ensure our staff have the right to work') and a bare 'right to work' do not count. Gulf
// places count only when gulfOk is false (Farhan: remote from India only); for Sana a Gulf requirement is her own route.
const RTW_LEAD=new RegExp([
 '\\bonly\\b[^.!?;]{0,40}?\\b(?:candidates?|applicants?|applications|individuals|people|residents|talent|those)\\b(?: who (?:are|currently))?[^.!?;]{0,15}?\\b(?:based|located|resid\\w*|living|who live|who reside) (?:in|within)\\b',
 '\\b(?:candidates?|applicants?)\\b[^.!?;]{0,20}?\\b(?:based|located|resid\\w*|living) (?:in|within)\\b[^.!?;]{1,120}?\\bonly\\b',
 '\\b(?:must|need to|needs to|required to|will need to|should) (?:already )?(?:be )?(?:currently )?(?:based|located|resid(?:e|ent)|live|living) (?:in|within)\\b',
 '\\b(?:must|need to|needs to|required to|will need to) (?:already )?(?:have|hold|possess) (?:the |a |an |full |valid |existing |current |unrestricted |legal |permanent )*(?:right to (?:live and )?work|work(?:ing)? (?:permit|authori[sz]ation|visa)|permission to work|eligibility to work)(?: in| for| within)\\b',
 // the country before the permit: 'must hold a valid Guernsey employment permit', 'must have a Swiss work permit'
 '\\b(?:must|need to|needs to|required to|will need to) (?:already )?(?:have|hold|possess) (?:a |an |the )?(?:valid |current |existing )?(?=[a-z]+(?: [a-z]+)? (?:employment|work|residence) (?:permit|visa|authori[sz]ation)\\b)',
 '\\b(?:must|need to|needs to|required to) (?:already )?(?:be )?(?:legally )?(?:eligible|authori[sz]ed|entitled|permitted) to (?:live and )?work (?:in|within|for)\\b',
 '\\b(?:the )?(?:full |valid |existing |unrestricted |legal )*(?:right to work|work (?:permit|authori[sz]ation)) (?:in|for|within)\\b(?=[^.!?;]{1,80}?\\b(?:is |are )?(?:required|essential|mandatory|a must|needed)\\b)',
].join('|'),'gi');
const RTW_REGION=/\b(?:(?:eu|eea|uk|us|u\.s\.|european union|schengen|swiss|australian|canadian|british|german|dutch) (?:work (?:permit|authori[sz]ation|visa)|right to work|citizenship|passport|residency)(?: holders?)?(?: is| are)? (?:required|essential|mandatory|needed|a must|only))\b/i;
const RTW_FOREIGN=new RegExp(FOREIGN_NAME.source+'|\\b(?:eu|eea|schengen|european union|guernsey|isle of man|channel islands|swiss|british|german|dutch|australian|canadian)\\b|^\\s*(?:the\\s+)?(?:u\\.s\\.?|us)\\b','i');
export function rightToWorkAbroad(description:string|null|undefined,opts:{gulfOk?:boolean}={}){
 const d=String(description||'').toLowerCase().replace(/\]\([^)]*\)/g,' ').replace(/[*\[\]`#]+/g,' ').replace(/\s+/g,' ');if(!d.trim())return false;   // markdown emphasis and links read as plain words
 const denied=(i:number)=>/\b(?:no|not|never|without|don't|do not|doesn't|does not|needn't|isn't|aren't)\b[^.!?;]*$/.test(d.slice(Math.max(0,i-40),i));
 const m0=RTW_REGION.exec(d);if(m0&&!denied(m0.index))return true;
 RTW_LEAD.lastIndex=0;let m:RegExpExecArray|null;
 while((m=RTW_LEAD.exec(d))){
  if(denied(m.index))continue;
  const after=d.slice(m.index+m[0].length,m.index+m[0].length+160),cut=after.search(/[!?;]|\.(?:\s|$)(?<!\bu\.s\.(?:\s|$))/);
  const span=/\bonly\b/.test(m[0])&&/^\b(?:candidates?|applicants?)/.test(m[0])?m[0]:(cut<0?after:after.slice(0,cut));
  if(/\b(?:indian?|bharat)\b/.test(span)||INDIA_PLACE.test(span))continue;
  if(opts.gulfOk&&GULF_PLACE.test(span))continue;
  if(RTW_FOREIGN.test(span))return true;
 }
 return false;
}
// Jobs QA 3 (16 Nov): the posting's own 'Location:' line, which many postings with a bare 'Remote' place carry ('Location: Remote – United States',
// 'Location: United Kingdom', 'Location: Espoo, Finland', 'Location: India (remote)'). Only the words up to the next sentence or label are read.
const LOCATION_LINE=/\blocation\s*\**\s*:\s*\**\s*([^*|\n]{2,80})/i, LOCATION_LINE_END=/[.?!;]|\s(?:about|who|department|reports?|type|salary|engagement|employment|job|role|we|our|the|this|compensation|shift|status|work(?:ing)? (?:hours|schedule)|overview|position|team|function)\b/i;
export function textLocation(description:string|null|undefined){const m=LOCATION_LINE.exec(String(description||'').slice(0,3000));if(!m)return '';const v=m[1],e=v.search(LOCATION_LINE_END);return (e<0?v:v.slice(0,e)).trim();}
// The place parts of a title: bracketed parts and the last part after a dash or slash ('(US or Canada)', '- US Remote', 'Dublin / US Remote', '(Mexico)').
export function titlePlaces(title:string|null|undefined):string[]{
 const t=String(title||''),out:string[]=[];let m:RegExpExecArray|null;const br=/\(([^)]*)\)|\[([^\]]*)\]/g;
 while((m=br.exec(t)))out.push(m[1]??m[2]??'');
 const last=t.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').split(/\s[-–—|/]\s/);if(last.length>1)out.push(last[last.length-1]);
 return out.map((x)=>x.trim()).filter(Boolean);
}
/** Jobs QA 3: the title or the text's Location line names only places outside India (no India, APAC, Asia, worldwide, anywhere or global). */
export function foreignPlaceInPosting(title:string|null|undefined,description:string|null|undefined){
 const open=(x:string)=>OPEN_PLACE_WORDS.test(x)||indianPlace(x);
 const loc=textLocation(description);
 return (!!loc&&!open(loc)&&foreignLocation(loc))||titlePlaces(title).some((x)=>!open(x)&&foreignLocation(x));
}
// Jobs QA 3: principal, director and vice-president titles are far above Farhan's level (owner brief: not principal/director-level). They stay in
// To review below his Worth-a-try floor (threshold - 10), whatever their skills and taste. 'General manager' keeps plan S6 (threshold - 1); 'Head of'
// joined the far-above titles in jobs QA 4.
const FARHAN_FAR_ABOVE=/\b(?:director|principal|vp|svp|evp|vice[- ]president|chief(?! of staff)|head of)\b/i;   // jobs QA 4: 'Head of' too (brief: head-of is far above him)
export const FAR_ABOVE_GAP=16;   // 54 for him: below the floor of 60 even with the largest taste raise (+5, scripts/taste_rules.mjs)
// Jobs QA 3: a remote job for Farhan that names no India, APAC, Asia, worldwide or anywhere wording at all (place 'Remote', a US or European
// employer) is not ruled out, but it ranks below the remote jobs that do say they hire from India.
export const INDIA_UNCONFIRMED_PENALTY=10;
const HIRING_REACH=/\b(?:india|indian|apac|asia|asia[- ]pacific|worldwide|anywhere|global(?:ly)?|international(?:ly)?|any country|offshore|overseas)\b/i;
// Jobs QA 7: a US 'Operating Engineer' or 'Stationary Engineer' is a licensed shift operator's trade, under a watch engineer.
const SANA_BELOW_LEVEL=/\b(?:operating|stationary) engineers?\b|\btechnicians?\b|(?<!\b(?:system|grid|network|transmission|distribution|independent)\s)\boperators?\b|\bfield officers?\b/i;
const SENIOR_TITLE=/\b(senior|sr|lead|principal|staff|head|manager|director)\b/i;
const EXEC_TITLE=/\b(?:vp|svp|evp|vice[- ]president|chief(?! of staff)|plant head|(?<!assistant |deputy |asst\.? |dy\.? )general manager|head of)\b/i;   // AGM / DGM are mid-senior Indian grades   // plan S6 ('Chief of Staff' is a builder role, not an executive one)
// ---- Jobs QA 4 (17 Nov: every job on both live lists hand-judged by two reviewers) ----------------------------------------------------------
// Sana: titles of other job families that matched one of her words (power, energy, plant, utilities, O&M): procurement and tendering, quality,
// fleet and restaurant upkeep, ESG reporting, finance and market analysis, sales, BIM and drafting, telecom O&M (BSS, RAN), SAP, product test and
// development, manufacturing and process engineering, safety, project controls. An analyst title is another family unless it is about
// reliability, condition monitoring, performance or maintenance ('Reliability Analyst', a solar 'Performance Analyst' are hers).
const SANA_OFF_FIELD_TITLE=/\b(?:buyer|procurement|sourcing|purchasing|tender(?:ing)?|quality|qlty|qc|fleet|restaurant|residential|weatheri[sz]ation|esg|sustainability (?:manager|reporting|data|lead|consultant|specialist|director)|fp ?& ?a|finance|financial|equity|economist|investment|trader|trading|business development|bim|modell?er|designer|draughts\w*|drafts\w*|cad|bss|ran|telecom\w*|policy|regulatory|sap|test engineer|test equipment|failure analysis|npi|development engineer|product (?:design|development|engineering)|controls development|manufacturing engineer|process engineer|safety engineer|hse|ehs|project controls?|cost controls?|commercial|advisory|administrator|transactions?|due diligence)\b/i;
// Sana: what the description says the work is. Design and consultancy work (FEED, detail design, design packages, CAD tools), product development
// and product test labs, and power-system studies, against the hands-on plant work of her field (maintenance, breakdowns, shutdowns, O&M,
// troubleshooting, spares, CMMS, root cause, commissioning, plant equipment). Design-led when at least two distinct design phrases appear and they
// outnumber the hands-on ones; a commissioning title is hers whatever the design wording (commissioning starts from the design documents).
const SANA_DESIGN_WORK=[/\bdetail(?:ed)? (?:engineering )?design\b/i,/\bFEED\b/,/\bconcept(?:ual)? design\b/i,/\bbasic (?:and detail(?:ed)? )?engineering\b/i,/\bdesign (?:packages?|drawings|calculations?|deliverables|documents?|reports?)\b/i,
 /\btender(?:ing)? (?:design|engineering|documents?)\b|\btendering\b/i,/\b3D model/i,/\b(?:autocad|microstation|revit|smartplant|e3d|pdms|navisworks|aveva|etap|digsilent|pscad)\b/i,/\b(?:design|engineering) consultan/i,/\bdesign review/i,
 /\bproduct (?:development|design|engineering)\b/i,/\bnew product\b|\bNPI\b/i,/\bDFMEA\b|\bdesign for reliability\b/i,/\bsystem architecture\b/i,/\bprototyp/i,/\b(?:reliability|test(?:ing)?) lab/i,/\btype tests?\b/i,
 /\bproduct reliability\b/i,/\bvalidation (?:testing|activities|of (?:new )?products?)\b/i,/\b(?:power system|grid|load flow|short[- ]circuit) stud(?:y|ies)\b/i,/\bdrafting\b|\bdraughts/i,/\bcivil (?:works|construction|engineering)\b/i,
 /\bfoundations?\b/i,/\broads\b/i,/\bdrainage\b/i,/\bgeotechnical\b/i];
const SANA_HANDS_ON_WORK=[/\bpreventi?ve maintenance\b|\bpreventative maintenance\b/i,/\bbreakdowns?\b/i,/\bshutdowns?\b/i,/\boverhaul/i,/\btroubleshoot/i,/\bo ?& ?m\b|operations? (?:and|&) maintenance/i,
 /\bmaintenance (?:planning|activities|schedules?|team|of)\b/i,/\bspare parts?\b|\bspares\b/i,/\bcmms\b|\bsap[- ]pm\b|\bmaximo\b/i,/\broot cause/i,/\bcondition monitoring\b|\bvibration\b/i,
 /\bplant (?:operations?|availability|uptime)\b|\bdowntime\b|\buptime\b/i,/\bcommissioning\b/i,/\bpermit to work\b|\block ?out/i,/\butilities\b/i,/\b(?:pumps?|compressors?|boilers?|turbines?|chillers?)\b/i];
// Civil and construction execution (buildings, foundations, roads, drainage, route surveys), telecom network O&M (BSS, RAN, Nokia, Ericsson), and
// a seagoing engineer's licence (USCG, STCW, chief or second engineer) are other professions that share her words.
const SANA_CIVIL_WORK=[/\bcivil (?:works?|construction|engineering|structures?|infrastructure|activities|packages?)\b/i,/\bfoundations?\b/i,/\broads?\b/i,/\bdrainage\b/i,/\bgeotechnical\b/i,/\broute survey/i,/\bstructural\b/i,
 /\bearth ?works?\b/i,/\bbuilding construction\b/i,/\bpiling\b/i,/\breal estate\b/i];
const SANA_TELECOM_WORK=[/\bBSS\b/,/\bRAN\b/,/\btelecom/i,/\bnetwork uptime\b/i,/\bnokia\b/i,/\bericsson\b/i,/\bBTS\b/,/\bmicrowave (?:links?|network)\b/i];
const SANA_MARINE_LICENCE=/\bUSCG\b|\bSTCW\b|\bchief engineer\b[^.]{0,40}\blicen|\b(?:unlimited )?(?:2nd|second|1st|first|3rd|third) (?:assistant )?engineer\b[^.]{0,40}\b(?:licen|motor|unlimited|certificat)|\bmarine engineer/i;
const distinct=(res:RegExp[],t:string)=>res.filter((re)=>re.test(t)).length;
/** Jobs QA 4: the name of the other job family a Sana posting belongs to (title words, or what the description says the work is), or null. */
export function sanaOffField(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||'').replace(/_/g,' '),t=`${ti} ${String(description||'')}`;   // 'IN-Specialist 3_ESG _Climate & Energy_Advisory'
 if(SANA_OFF_FIELD_TITLE.test(ti)||(/\banalyst\b/i.test(ti)&&!/reliab|condition monitoring|performance|maintenance|vibration/i.test(ti)))return 'another job family';
 if(SANA_MARINE_LICENCE.test(t))return 'seagoing engineering';
 if(distinct(SANA_TELECOM_WORK,t)>=2)return 'telecom network';
 if(!/maintenance|o ?& ?m\b/i.test(ti)&&distinct(SANA_CIVIL_WORK,t)>=3)return 'civil and construction';
 const design=distinct(SANA_DESIGN_WORK,t);
 if(!/commission/i.test(ti)&&design>=2&&design>distinct(SANA_HANDS_ON_WORK,t))return 'design, product or consultancy';
 return null;
}
// Sana's level (brief: technician, operator, chargeman, fitter, trainee and intern are below her). Trade titles that SANA_BELOW_LEVEL did not read:
// chargeman, foreman, fitter, mechanic, electrician, artisan, boilermaker, welder, lead worker and 'Tech' ('O&M Tech - Renewables'). Not when the title
// also says engineer, manager, supervisor or specialist ('Mechanic Maintenance Engineer').
const SANA_TRADE_TITLE=/\b(?:charge ?m[ae]n|charge-?hand|fore(?:m[ae]n|person)|fitters?|mechanics?|electricians?|artisans?|boiler ?makers?|welders?|grinders?|plumbers?|wiremen|wireman|linem[ae]n|handym[ae]n|lead worker|craftsm[ae]n|tech)\b/i;
const SANA_TRADE_EXEMPT=/\b(?:engineers?|engineering|manager|supervisor|specialist)\b/i;
export function sanaTradeTitle(title:string|null|undefined){const t=String(title||'');return SANA_TRADE_TITLE.test(t)&&!SANA_TRADE_EXEMPT.test(t);}
// Jobs QA 8 (recall audit, 20 Nov): commissioning, testing and O&M of plant equipment is her work, but her CV skills and target roles never say so, so
// Gulf and India commissioning and O&M posts scored 43-55 ('Senior Testing & Commissioning Engineer, Medium Voltage', 'Instrument Engineer (Pre
// Commissioning Field)', 'Senior Manager O&M'). A commissioning, testing-and-commissioning or O&M title whose title or text names plant equipment or a plant
// counts up to two of these as skills. Not pipeline, telecom or network, building / MEP / data-centre / HVAC, software or computer-system
// commissioning, nor commissioning of services (an NHS 'People Commissioning' post).
const SANA_COMMISSION_TITLE=/\b(?:pre-?\s?)?commissioning\b|\btesting\s*(?:&|and)\s*commissioning\b|\bo\s?&\s?m\b|\boperations?\s+(?:and|&)\s+maintenance\b/i;
const SANA_COMMISSION_NOT=/\bpipelines?\b|\btelecom\w*|\bfib(?:re|er)\b|\b(?:5g|lte|ran|rf|bts|ftth)\b|\bnetworks?\b(?!\s+(?:protection|substations?))|\bbuildings?\b|\bmep\b|\bbms\b|\bbuilding management\b|\bhvac\b|\bfire (?:alarm|protection|fighting)\b|\bfit-?out\b|\bdata ?cent(?:er|re)s?\b|\bmission critical\b|\bsoftware\b|\bcomputer systems?\b|\bcsv\b|\bcqv\b|\bit systems?\b|\bpeople\b|\bservices? commissioning\b|\bcommissioning (?:of )?(?:health|care|social)\b|\bnhs\b|\bclinical\b|\bfacilities management\b|\blifts?\b|\belevators?\b/i;
const SANA_COMMISSION_STRONG_NOT=[/\b(?:oil|gas|crude|water|export|cross[- ]country|subsea|transmission|product) pipelines?\b|\bpipelines? (?:commissioning|construction|integrity|tie-?ins?|pre-?commissioning)\b|\bpigging\b/i,   // not a 'pipeline of projects'
 /\btelecom\w*|\bfib(?:re|er) optic|\bFTTH\b|\b5G\b|\bBTS\b/i,/\bMEP\b/,/\bBMS\b|\bbuilding management\b|\bbuilding services\b/i,/\bHVAC\b/i,/\bfit-?out\b/i,
 /\bdata ?cent(?:er|re)s?\b|\bhyperscale\b|\bmission critical\b|\bcolocation\b/i,/\bcommercial buildings?\b|\bhospitals?\b|\bhotels?\b|\bmalls?\b/i];
const SANA_COMMISSION_WEAK_NOT=[/\bsoftware\b/i,/\bcomputer systems?\b|\bCSV\b|\bCQV\b/,/\bfire (?:alarm|protection|fighting)\b/i];

const SANA_COMMISSION_PLANT=[/\bpower (?:plants?|stations?|generation)\b|\bthermal power\b|\bccgt\b|\bcombined cycle\b/i,
 /\bsubstations?\b|\bswitchgear\b|\btransformers?\b|\b(?:medium|high|low|extra high) voltage\b|\bgas[- ]insulated\b|\bcircuit breakers?\b|\b(?:protection )?relays?\b/i,/\b(?:E?HV|MV|LV)\b|\bGIS (?:substations?|switchgear|bays?)\b/,
 /\bturbines?\b|\bgenerators?\b|\bboilers?\b|\bcompressors?\b|\bpumps?\b|\brotating equipment\b|\bheat exchangers?\b/i,/\brefiner(?:y|ies)\b|\bpetrochemical\b|\bprocess plants?\b|\bgas (?:plants?|processing)\b|\bLNG\b|\boil (?:&|and) gas\b|\bupstream\b|\bdesalination\b|\bwater treatment\b|\bEPC\b/i,
 /\binstrument(?:s|ation)?\b|\banaly[sz]ers?\b|\bDCS\b|\bPLC\b|\bloop (?:checks?|tests?)\b|\bcontrol systems?\b/i,/\bsolar (?:plants?|farms?|parks?|pv)\b|\bwind (?:farms?|turbines?)\b|\brenewables?\b|\b(?:utility|utilities|power|process|treatment|manufacturing|chemical|steel|cement|production|industrial|captive|RO|STP|ETP|WTP|DM|desalination) plants?\b|\bplant (?:systems?|equipment|operations?|efficiency|availability|start-?up|commissioning|maintenance|area|performance)\b|\b(?:solar|wind|hydro|thermal|coal|gas)(?:,? (?:and|&) (?:solar|wind|hydro|gas))? (?:power )?plants?\b/i];
// Strong plant evidence (a power plant, refinery, process or utility plant): what must clearly outweigh a strong exclusion in the text.
const SANA_PLANT_STRONG=[/\bpower (?:plants?|stations?)\b|\bthermal power\b|\bccgt\b|\bcombined cycle\b/i,/\brefiner(?:y|ies)\b/i,/\bpetrochemical\b/i,/\bprocess plants?\b/i,/\bgas (?:plants?|processing)\b|\bLNG\b/i,
 /\bdesalination\b|\bwater treatment plants?\b/i,/\butility plants?\b|\butilities plant\b/i,/\bsolar (?:plants?|farms?|parks?)\b|\bwind farms?\b/i];

/** Jobs QA 8: the commissioning / O&M skills a Sana posting earns (none unless the title is a commissioning or O&M title and the work is plant work). */
export function sanaCommissioningSkills(title:string|null|undefined,description:string|null|undefined,have:string[]=[]):string[]{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' '),t=`${ti} ${d}`;
 if(!SANA_COMMISSION_TITLE.test(ti)||SANA_COMMISSION_NOT.test(ti))return [];
 // the title or text names plant equipment or a plant. One strong exclusion in the text (pipeline, telecom, building services / MEP / HVAC, a data
 // centre, commercial buildings) rejects unless strong plant evidence clearly outweighs it; two kinds of weaker wording (software, CSV, fire alarm) reject.
 if(!distinct(SANA_COMMISSION_PLANT,t))return [];
 const strongNot=distinct(SANA_COMMISSION_STRONG_NOT,d),strongPlant=distinct(SANA_PLANT_STRONG,t);
 if(strongNot&&!(strongPlant>=2&&strongPlant>strongNot))return [];
 if(distinct(SANA_COMMISSION_WEAK_NOT,d)>=2)return [];
 const mine=have.map((h)=>String(h).toLowerCase()),out:string[]=[];
 if(/commission/i.test(t)&&!mine.some((h)=>h.includes('commissioning')))out.push('Plant Commissioning');
 if(/\bo\s?&\s?m\b|\boperations?\s+(?:and|&)\s+maintenance\b/i.test(t)&&!mine.some((h)=>h==='o&m'))out.push('O&M');
 if(out.length<2&&/\btesting\b|\bpre-?\s?commissioning\b|\bstart-?up\b|\benergi[sz]ation\b|\bloop (?:checks?|tests?)\b|\bpunch ?lists?\b/i.test(t))out.push('Testing & Start-up');
 return out.slice(0,TARGET_SKILL_MAX);
}
// Jobs QA 8: a 'Field Service Engineer' title alone is also a lab, medical or IT-hardware post (Waters, Bruker, a scanner maker), so it is hers only
// for a maker of power equipment (Hitachi Energy, GE Vernova, Siemens Energy, ABB, BHEL...) whose text names power equipment, or when the text is about
// power-plant equipment itself (three distinct plant phrases and a plant or substation).
const POWER_OEM=/\b(?:hitachi(?: energy)?|ge vernova|gevernova|ge (?:power|renewable|grid)|siemens energy|siemens gamesa|abb|schneider(?: electric)?|doosan|bhel|bharat heavy electricals|mitsubishi (?:power|heavy)|ansaldo|w(?:a|ä)rtsil(?:a|ä)|man energy|solar turbines|baker hughes|thermax|isgec|triveni|kirloskar|vestas|nordex|suzlon|inox|enercon|alstom|hyosung|toshiba|voith|andritz|cg power|crompton greaves|tbea|aggreko|cummins|caterpillar)\b/i;
// A named energy division in the company or the text ('HITACHI ENERGY INDIA LIMITED'), never a bare 'energy' or 'power' ('check power supplies').
const POWER_OEM_NAMED=/\b(?:hitachi energy|siemens energy|siemens gamesa|ge vernova|ge (?:power|renewable energy|grid solutions|gas power)|mitsubishi power|doosan (?:enerbility|power systems)|bharat heavy electricals|bhel|abb (?:electrification|power grids|motion)|schneider electric)\b/i;
// Power equipment for a field service engineer: what a power-equipment maker's engineer services.
const FSE_POWER_EQUIPMENT=[/\bpower transformers?\b|\btransformers?\b/i,/\bswitchgear\b|\bgas[- ]insulated\b|\bGIS (?:substations?|switchgear|bays?)\b/,/\bcircuit breakers?\b/i,/\bsubstations?\b/i,/\b(?:gas|steam|wind|hydro) turbines?\b|\bturbines?\b/i,
 /\bgenerators?\b/i,/\bboilers?\b/i,/\bpower (?:plants?|stations?)\b/i,/\bHVDC\b|\bFACTS\b|\bSTATCOM\b/,/\bprotection relays?\b|\brelay (?:testing|settings)\b/i];
// Lab, medical, IT-hardware and robot field service: each only counts with its own context ('thermal imaging' or 'diagnostics' of transformers are power work).
const FSE_NOT_POWER=/\blab(?:oratory)? (?:instruments?|equipment|analy[sz]ers?)\b|\banalytical instruments?\b|\bmass spectromet\w*|\bchromatograph\w*|\bmicroscop\w*|\blife sciences?\b|\bmedical (?:devices?|equipment|imaging|systems?|technolog\w*)\b|\bdiagnostic imaging\b|\bin[- ]vitro diagnostics?\b|\bclinical\b|\bhospitals?\b|\bultrasound\b|\bMRI\b|\bCT scanners?\b|\bsemiconductor\b|\bwafers?\b|\bservers?\b|\bstorage arrays?\b|\bIT hardware\b|\bprinters?\b|\bATMs?\b|\brobot(?:s|ic|ics)?\b/i;
const FSE_POWER_STRONG=/\bpower (?:plants?|stations?)\b|\bsubstations?\b|\bpower transformers?\b|\bswitchgear\b|\bgas[- ]insulated\b/i;
export function sanaPowerFieldService(title:string|null|undefined,company:string|null|undefined,description:string|null|undefined):boolean{
 const ti=String(title||''),d=String(description||''),t=`${ti} ${d}`;
 if(!/\bfield service (?:engineer|specialist)s?\b/i.test(ti))return false;
 // a lab, medical, IT or robot context rules it out unless the text is about a power plant or substation equipment
 if(FSE_NOT_POWER.test(t)&&!FSE_POWER_STRONG.test(t))return false;
 const power=distinct(FSE_POWER_EQUIPMENT,t);
 if(POWER_OEM.test(String(company||''))&&(power>=1||POWER_OEM_NAMED.test(`${company||''} ${d}`)))return true;   // 'Hitachi' with 'HITACHI ENERGY INDIA LIMITED' in the text
 return power>=3&&/\bpower (?:plants?|stations?)\b|\bsubstations?\b/i.test(d);
}
// Jobs QA 8 (owner decision 20 Nov): the electrical-only reduction is for electrical design, studies, protection and switchgear sales. An electrical
// post whose text is hands-on maintenance of a plant, port, terminal or utility ('preventive and breakdown maintenance of port equipment', a power-plant
// electrical maintenance engineer) scores like any other maintenance post.
const ELECTRICAL_NOT_MAINTENANCE=/\bdesign\w*|\bcontrols?\b|\bautomation\b|\bintegration\b|\bavionics\b|\bharness\b|\bsystems? engineer\b|\bprotection\b|\brelay\b|\bstud(?:y|ies)\b|\bestimat\w*|\btender\w*|\bproposals?\b|\bsales\b|\bapplications?\b|\bpre-?sales\b|\bbid\b|\bdraught\w*|\bdraft\w*|\bcad\b|\bsubstation engineer\b|\bproduct\b|\bR&D\b/i;
const ELECTRICAL_MAINTENANCE_WORK=[/\bpreventi?ve\b|\bpreventative\b/i,/\bbreakdowns?\b/i,/\bcorrective\b/i,/\bpredictive\b|\bcondition monitoring\b/i,/\broutine (?:maintenance|inspections?)\b|\binspections?\b/i,
 /\bfault (?:diagnosis|finding|rectification)\b|\btroubleshoot/i,/\bshutdowns?\b|\boverhaul/i,/\bspare parts?\b|\bspares\b/i,/\bcmms\b|\bsap[- ]pm\b|\bmaximo\b/i,/\bdowntime\b|\buptime\b|\bMTBF\b|\bMTTR\b/i];
export function sanaElectricalMaintenance(title:string|null|undefined,description:string|null|undefined):boolean{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(ELECTRICAL_NOT_MAINTENANCE.test(ti)||!/\b(?:engineer\w*|manager|executive|officer|lead|specialist|planner|in[- ]?charge)\b/i.test(ti)||/\b(?:supervisor|technici?an|foreman|electrician)\b/i.test(ti))return false;   // her level: an engineer, executive or manager post
 if(!/\bplants?\b|\bports?\b|\bterminals?\b|\butilit(?:y|ies)\b|\bfactory\b|\bfactories\b|\bmanufactur\w*|\brefiner(?:y|ies)\b|\bpower (?:plants?|stations?)\b|\bsubstations?\b|\bproduction\b|\bmills?\b/i.test(d))return false;
 const hands=distinct(ELECTRICAL_MAINTENANCE_WORK,d),design=distinct(SANA_DESIGN_WORK,d);
 return hands>=2&&/\bmaintenance\b/i.test(d)&&hands>design;
}
// Both: a language other than English (or Hindi) that the posting requires in so many words ('native or professional fluency in Portuguese is
// required', 'communication skills in both Turkish and English', 'Fluent Serbian'). A language only welcomed ('is a plus', 'an advantage',
// 'preferred') is not read. Hard-ish: the score stays below the person's Worth-a-try floor.
const LANGS='turkish|portuguese|italian|polish|japanese|mandarin|chinese|cantonese|korean|russian|vietnamese|thai|bahasa(?: indonesia| melayu)?|malay|indonesian|czech|slovak|swedish|danish|norwegian|finnish|hebrew|greek|hungarian|romanian|ukrainian|bulgarian|croatian|serbian|tagalog|filipino|german|french|dutch|spanish|arabic';
const LANG_HARD=new RegExp(`\\b(?:(?:native|professional|business|full|working)[- ](?:level )?(?:or [\\w-]+ )?(?:fluency|proficiency) in (${LANGS})|fluen(?:t|cy) (?:in )?(?:both )?(${LANGS})|(${LANGS}) (?:language )?(?:is |are )?(?:required|mandatory|essential|a must)|(?:skills|proficiency|fluency) in both (${LANGS}) and english|(?:excellent |strong |full |good |fluent |native )?command of (?:both )?(${LANGS}) and english|(?:excellent |strong |full |good |fluent |native )?command of (?:both )?english and (${LANGS})|(?:proficient|fluent) in english and (${LANGS})|native or business[- ]fluent (${LANGS})|\\bnative[- ](?:level )?(${LANGS})\\b(?![- ]speakers? (?:are )?welcome)|(${LANGS})[- ]speak(?:ing|ers?)\\b)`,'gi');
const LANG_SOFT_AFTER=/^[^.;\n]{0,40}\b(?:is |are |would be )?(?:a plus|an advantage|advantageous|preferred|desirable|nice to have|a bonus|an asset|beneficial)\b/i;
export const LANGUAGE_HARD_GAP=11;
/** Jobs QA 4: a non-English language the posting plainly requires (title or text), or null. */
export function languageHardRequired(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||'').trim(),t=`${ti}\n${String(description||'')}`;LANG_HARD.lastIndex=0;let m:RegExpExecArray|null;
 while((m=LANG_HARD.exec(t))){
  const name=m.slice(1).find(Boolean)||'';if(LANG_SOFT_AFTER.test(t.slice(m.index+m[0].length)))continue;
  if(/speak/i.test(m[0])&&m.index>ti.length)continue;   // '<Language> speaking' only in the title ('Implementation Specialist - Dutch Speaking', '(French Speaker)')
  return name.replace(/\b\w/g,(c)=>c.toUpperCase());
 }
 return null;
}
// Both: a part-time, freelance or independent-contractor engagement of a few hours (brief: TYPE). The title says part-time, or the text says the
// role is part-time, freelance, an independent-contractor engagement, or up to 25 hours a week. Benefits boilerplate ('part-time employees who
// work 20 or more hours') is not read.
const GIG_TITLE=/\bpart[- ]time\b|\bfreelance\b/i;
const GIG_TEXT=/\bindependent contractors?\b|\bself[- ]employed contract|\bfreelance (?:opportunity|contract|role|position|basis|project|engagement|assignment)\b|\b(?:looking for|seeking|hire|hiring) an? freelance\b|\bpart[- ]time (?:employment|role|position|contract|basis|job|opportunity|engagement)\b|\b(?:role|position|job|this) is (?:a )?part[- ]time\b|\btype\s*:\s*part[- ]time\b|\(part[- ]time\)|\bpart[- ]time\s*\/\s*(?:fractional|contract)/i;
const GIG_HOURS=/\b(?:approximately |about |around |up to )?(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?hours? (?:per|a|\/|each) ?week\b/gi;
export function gigEngagement(title:string|null|undefined,description:string|null|undefined){
 const ti=String(title||''),d=String(description||'');
 if(GIG_TITLE.test(ti)||GIG_TEXT.test(d))return true;
 GIG_HOURS.lastIndex=0;let m:RegExpExecArray|null;
 while((m=GIG_HOURS.exec(d))){const before=d.slice(Math.max(0,m.index-40),m.index);if(/\b(?:or more|at least|minimum|benefits?|employees)\b/i.test(before+d.slice(m.index,m.index+m[0].length+25)))continue;const hi=Number(m[2]||m[1]);if(hi>0&&hi<=25)return true;}
 return false;
}
// Farhan: infrastructure and production operations (Linux servers, network, system health checks) is SRE / IT operations, not his field, whatever
// the title says ('Operations Engineer'); production AI engineering (RAG pipelines, vector stores, embeddings) under an 'AI ... Engineer' title is
// software work. Not when the title names his own work (implementation, automation, integration, CRM, RevOps, onboarding).
const FARHAN_INFRA_OPS=[/\blinux\b/i,/\bservers?\b/i,/\bserver health\b|\bhealth checks?\b/i,/\bproduction (?:environments?|applications)\b/i,/\b(?:system|application) logs?\b|\blog analysis\b/i,/\bcpu\b|\bdisk utili[sz]ation\b/i,/\bnetwork connectivity\b|\bthe network\b/i,/\bon[- ]call\b/i];
const FARHAN_AI_BUILD=[/\bRAG\b/,/\bvector (?:stores?|databases?|search)\b/i,/\bembeddings?\b/i,/\bfine[- ]tun/i,/\bprompt engineering\b/i,/\bLLMOps\b|\bMLOps\b/i];
const FARHAN_OWN_WORK=/implementation|automation|integration|\bcrm\b|rev(?:enue)? ?ops|revenue operations|onboarding|business systems|marketing ops|sales ops/i;
export function farhanOffField(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'');if(FARHAN_OWN_WORK.test(ti))return null;
 if(/\boperations? engineer|\bproduction support|\bapplication support|\bsystems? engineer/i.test(ti)&&distinct(FARHAN_INFRA_OPS,d)>=4)return 'infrastructure operations';
 if(/\bai\b[^,;|]*\bengineer\b/i.test(ti)&&distinct(FARHAN_AI_BUILD,d)>=2)return 'AI software engineering';
 return null;
}
// Jobs QA 6 (20 Nov, owner feedback: a 'GoHighLevel (GHL) Specialist — Automation & Customer Support (Gym Business)' on Farhan's Best matches,
// posted by a firm that 'places AI-fluent virtual assistants with growing businesses', hiring 'on behalf of our client, a US-based gym business',
// reporting to the gym owner and giving 'first-line support to the gym owner and staff'). A virtual-assistant placement, or a hands-on support or
// assistant post for one small business, is a gig below a 9-year technical operations lead (brief: VA gig = wrong type), whatever its tool words.
// Read as any of:
//   a virtual-assistant firm (by name or by its own words: 'places virtual assistants') hiring for an assistant or support post (assistant / VA /
//   front desk / receptionist / customer support in the title, first-line or front-desk support, assisting the owner) or one asking at most 3 years;
//   any firm hiring 'on behalf of our client' for such an assistant or support post;
//   first-line, front-desk or assistant support of the owner of a single small business (gym, clinic, salon, spa, studio, dental or medical practice,
//   coaching business);
//   an assistant or VA title asking at most 3 years.
// Not when the title is a senior, lead or manager post ('Senior Implementation Manager' through a staffing agency, 'Assistant Project Manager') and
// not an assistant one.
const VA_FIRM_NAME=/\bvirtual (?:assistants?|staff(?:ing)?)\b|\bva (?:staffing|services|agency)\b|\d+\s*va\b/i;
const VA_FIRM_TEXT=/\b(?:place|places|placing|match|matches|matching|provide|provides|providing|connect|connects|supply|supplies)\s+(?:(?!(?:to|for|with|by|from|of)\s)[\w-]+\s+){0,3}?(?:virtual assistants?|remote assistants?|vas)\b|\bvirtual (?:assistant|staffing) (?:agency|company|firm|services|placement|provider)\b|\bva (?:agency|placement|staffing)\b/i;
const CLIENT_HIRE=/\bon behalf of (?:our|a) client\b|\bfor (?:one of )?our clients?, an?\b|\bour client,? an? [\w-]+(?: [\w-]+){0,3} (?:business|company|practice|clinic|gym|agency|brand)\b/i;
const ASSIST_TITLE=/\bassistants?\b|\bfront[- ]desk\b|\breceptionist\b|\bcustomer (?:support|service)\b|\bsupport (?:agent|representative|rep|specialist)\b|\bhelp ?desk\b/i;
const ASSIST_TEXT=/\bfirst[- ]line (?:[\w-]+ ){0,2}support\b|\bfront[- ]desk\b|\breceptionist\b|\b(?:virtual|administrative|admin|executive|personal) assistant\b|\b(?:support|assist)(?:s|ing)? (?:to )?the (?:[\w-]+ )?owners?\b|\breports? (?:directly )?to\s*:?\s*(?:the )?(?:[\w-]+ )?owner\b/i;
const SMALL_BUSINESS=/\b(?:gym|fitness (?:studio|business|cent(?:er|re)|club)|clinic|salon|(?:med|day)?\s?spa|(?:yoga|pilates|dance|martial arts|tattoo) studio|dental (?:office|practice)|medical practice|chiropract\w*|coaching (?:business|company|practice)|boutique)\b/i;
const OWNER_SUPPORT=/\b(?:support|assist)(?:s|ing)? (?:to )?the (?:[\w-]+ )?owners?\b|\breports? (?:directly )?to\s*:?\s*(?:the )?(?:[\w-]+ )?owner\b|\b(?:the )?(?:gym|clinic|salon|spa|studio|practice|business) owner and (?:the )?(?:front[- ]desk|staff|team)\b/i;
const ASSIST_SENIOR=/\b(?:senior|sr|lead|principal|head|manager|director)\b/i;
const ASSIST_ROLE_WORD=/\bassistants?\b(?![^,;|()]{0,40}\b(?:manager|director|vice[- ]president)\b)/i;   // 'Assistant Project Manager' and 'Assistant Manager' are manager grades
const assistRole=(ti:string)=>ASSIST_ROLE_WORD.test(ti)||/\bVA\b/.test(ti);
export function farhanAssistantGig(title:string|null|undefined,description:string|null|undefined,company:string|null|undefined=''):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' '),co=String(company||'');
 if(ASSIST_SENIOR.test(ti)&&!assistRole(ti))return null;
 const years=yearsRequired(d),fewYears=years>0&&years<=3;
 const assist=ASSIST_TITLE.test(ti)||/\bVA\b/.test(ti)||ASSIST_TEXT.test(d);
 const vaFirm=VA_FIRM_NAME.test(co)||VA_FIRM_TEXT.test(d);
 if((vaFirm&&(assist||fewYears))||(CLIENT_HIRE.test(d)&&assist))return 'a virtual-assistant or staffing placement';
 if(SMALL_BUSINESS.test(`${ti} ${d}`)&&OWNER_SUPPORT.test(d)&&assist)return 'hands-on support for one small business';
 if(assistRole(ti)&&fewYears)return 'a hands-on assistant post';
 return null;
}
// ---- Jobs QA 7 (20 Nov: every job on both live lists, 80 jobs, re-judged by two reviewers; 33 should not have been shown) -----------------------
// The words of a denial just before a match ('you do not need to be US-based', 'no internal candidates only').
// ('not only an exceptional developer' is no denial)
const deniedBefore=(d:string,i:number)=>/\b(?:no|not(?! only)|never|without|don't|do not|doesn't|does not|needn't|isn't|aren't)\b[^.!?;]*$/i.test(d.slice(Math.max(0,i-40),i));
const anyNotDenied=(re:RegExp,d:string)=>{const g=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(d)))if(!deniedBefore(d,m.index))return true;return false;};
// Both: a posting open only to the employer's own staff ('we seek applications from interested employees for this role', 'internal candidates
// only'). Not a job either person can apply to.
const INTERNAL_ONLY=/\b(?:seek|invite|invites|inviting|accept(?:ing)?|welcome|encourage)s? applications? from (?:interested |eligible |internal |our |existing |current )*(?:employees|staff|associates|colleagues)\b|\binternal (?:candidates|applicants|employees|associates) only\b(?!\s+(?:need|needs|have|has|must|should|require|required)\b)|\bonly (?:open to |for )?internal (?:candidates|applicants|employees|associates)\b|\bopen (?:only )?to internal (?:candidates|applicants|employees|associates)(?: only)?\b|\binternal (?:job )?posting only\b|\bthis is an internal (?:posting|position|vacancy|job|opening)\b/i;
export function internalOnly(description:string|null|undefined){return anyNotDenied(INTERNAL_ONLY,String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' '));}
// Farhan's place: the text keeps a remote job in the United States, whatever an aggregator's tag says ('Anywhere in the World' on We Work Remotely
// for 'Headquarters: Burlington, MA OR US Remote'; 'Remote (Worldwide)' for 'The US base salary range ... a comprehensive US benefits package ...
// 401(k)'; 'Fully Remote' for 'LOCATION Remote position within the United States'). Strong US-only words only: US Remote / Remote - US, a remote
// position within the United States, a US salary range or US benefits package, a 401(k), US work authorisation. Not when the text names India,
// APAC or Asia, or says it hires outside the US.
// The place words ('OR US Remote', 'Remote position within the United States') hold unless the text names India, APAC or Asia or hiring outside the
// US; the pay and benefits words (a US salary range, US benefits, a 401(k), US work authorisation) only when it also says nothing of hiring
// globally, worldwide or anywhere ('We hire globally; 401(k) for US staff' is open).
const US_REMOTE_PLACE=[/\bremote (?:position|role|job|opportunity|work|employee)?\s*(?:is\s+)?(?:located\s+|based\s+)?(?:with)?in the (?:united states|u\.s\.a?\.?|usa)(?![a-z])/i,
 /(?<![A-Za-z.])(?:US|USA|U\.S\.)[- ]Remote\b|\bRemote\s*(?:[-–(:]\s*|\s)(?:US|USA|U\.S\.)(?![A-Za-z])|\bRemote-US\b/];
// 'US' is matched in capitals only ('Why Join Us Benefits' is not a US benefits package).
const US_REMOTE_PAY=[/(?<![A-Za-z.])(?:US|U\.S\.) (?:[Bb]ase )?(?:[Ss]alary|[Pp]ay|[Cc]ompensation) [Rr]anges?\b|(?<![A-Za-z.])(?:US|U\.S\.)[- ](?:based )?[Bb]enefits\b/,/\b401\s?\(?k\)?(?![a-z])/i,
 /\b(?:legally )?(?:authori[sz]ed|eligible) to work in the (?:united states|us|u\.s\.)(?![a-z])/i];
const US_TEXT_OPEN=/\b(?:india|indian|apac|asia|asia[- ]pacific|outside (?:of )?the (?:us|u\.s\.|united states)|any country|all countries)\b/i;
const US_TEXT_GLOBAL=/\b(?:globally|worldwide|anywhere in the world|work from anywhere|international(?:ly)? (?:candidates|applicants|hires?|team members))\b/i;
export function usRemoteByText(description:string|null|undefined){
 const d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(!d.trim()||US_TEXT_OPEN.test(d))return false;
 return US_REMOTE_PLACE.some((re)=>anyNotDenied(re,d))||(!US_TEXT_GLOBAL.test(d)&&US_REMOTE_PAY.some((re)=>anyNotDenied(re,d)));
}
// Job boards and aggregators: their place tags ('Anywhere in the World', 'Remote, India') are their own reading, not the employer's.
export const AGGREGATOR_SOURCE=/^(?:indeed|weworkremotely|realworkfromanywhere|remoteok|remotive|himalayas|workingnomads|jobspresso|wellfound|linkedin|builtin|glassdoor|naukri|foundit|adzuna|arbeitnow|jobicy|nodesk|remote_?boards|watch_?boards|watchboards|workable)$/i;
// Farhan's place: office or hybrid wording tied to this job. The posting's Location line says hybrid / on-site / office ('Location: Bangalore,
// Hybrid.'); a Workday remote type in the text ('Hybrid: Work in Office Part-Time'); or a 'Work Location: <city>' line with office working
// ('We offer a blended approach to office working ... Work Location: Pune'). A place written '<City> Office' is an office ('Bengaluru Office').
const OFFICE_WORD=/\b(?<!home |remote |virtual )office\b|\bhybrid\b|\bon[- ]?site\b|\bin[- ]office\b/i;
// remote first: 'Remote: Home Office' and 'Work from home' are remote; hybrid or on-site words still say office
export function officePlace(location:string|null|undefined){const l=String(location||'');if(/\bhybrid\b|\bon[- ]?site\b|\bin[- ]office\b/i.test(l))return true;if(/\bremote\b|\bhome[- ]office\b|\bwork(?:ing)? from home\b|\bwfh\b/i.test(l))return false;return OFFICE_WORD.test(l);}
const OFFICE_WORKING=/\bblended approach to (?:office )?working\b|\boffice working\b|\b(?:collaborate|connect|work) (?:and connect |and collaborate )?in (?:one of )?our (?:thriving |vibrant |modern )?offices?\b|\bwork in office part[- ]time\b|\bhybrid\s*:\s*work in office\b/i;
const WORK_LOCATION=/\bwork(?:ing)? location\s*\**\s*:\s*\**\s*([^.\n|*]{2,60})/i;
export function officeByPlaceText(description:string|null|undefined){
 const d=String(description||'').replace(/\s+/g,' ');
 const loc=textLocation(d);if(loc&&/\b(?:hybrid|on[- ]?site|in[- ]office|office[- ]based)\b/i.test(loc)&&!deniedBefore(loc,loc.search(/hybrid|on[- ]?site|office/i)))return true;
 if(/\bwork in office part[- ]time\b|\bhybrid\s*:\s*work in office\b/i.test(d))return true;
 const w=WORK_LOCATION.exec(d);return !!w&&!/\b(?:remote|work from home|wfh|anywhere)\b/i.test(w[1])&&OFFICE_WORKING.test(d);
}
// Farhan's field: an engineering seat that asks for real programming ('an exceptional developer', '3+ years of back-end development', '5+ years of
// software or integration engineering', '12+ years in software engineering', 'Strong programming skills in Python, JavaScript/TypeScript', 'Strong
// Python programming'). His automation and integration work is low-code with light scripting (brief: production code is not his field).
const FARHAN_PROGRAMMING=[/\bexceptional (?:software )?developer\b/i,
 /\b\d{1,2}\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?(?: of)?(?: professional| hands-on| proven| relevant)?(?: experience)?(?: in| with| of)? (?:back[- ]?end|front[- ]?end|full[- ]?stack|software|application) (?:or [\w-]+ |and [\w-]+ |\/ ?[\w-]+ )?(?:development|engineering|programming)\b/i,
 /\bstrong programming skills\b/i,/\bstrong (?:python|java|javascript|typescript|golang|c#|c\+\+|ruby|node(?:\.js)?) (?:programming|development|coding)\b/i];
// Telecom radio account work ('a strong history with Telecom RF & Machine Learning', 'experience with RAN/RF'); finance ERP administration asked
// in years ('5+ years of dual functional and technical NetSuite administration').
const TELECOM_RF=/\bRF\b|\bRAN\b/, TELECOM_WORD=/\btelecom\w*\b|\bcellular\b/i;
const ERP_ADMIN_YEARS=/\b\d{1,2}\s*\+?\s*years?\b[^.;]{0,60}\b(?:netsuite|sap|oracle (?:erp|financials|fusion)|dynamics(?: 365)?|erp)\b[^.;]{0,20}\badministration\b/i;
export function farhanEngineeringField(title:string|null|undefined,description:string|null|undefined):string|null{
 const d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(FARHAN_PROGRAMMING.some((re)=>anyNotDenied(re,d)))return 'software engineering';
 if(TELECOM_RF.test(d)&&TELECOM_WORD.test(d))return 'telecom radio (RF) specialist';
 if(ERP_ADMIN_YEARS.test(d))return 'finance ERP administration';
 if(farhanCrmDevelopment(title,d))return 'CRM development (CI/CD, custom code)';   // jobs QA 9
 if(farhanFinanceProductImplementation(title,d))return 'finance or ERP product implementation';   // jobs QA 9
 const qa10=farhanOtherFieldQa10(title,d);if(qa10)return qa10;   // jobs QA 10
 return null;
}
// ---- Jobs QA 9 (21 Nov: both live lists, 65 jobs, re-judged by two reviewers after the v23 rules rebuild; 14 should not have been shown) ------
// Farhan's field: a CRM consultant / specialist / architect / developer title whose text asks developer work on the platform: CI/CD pipelines,
// DevOps, the PowerApps Component Framework (PCF), plug-ins or custom code ('Design, implement, and maintain CI/CD pipelines', 'custom application
// development', 'custom components ... using the PowerApps Component Framework (PCF)'). Two kinds of that work; his CRM work is configuration.
const CRM_PLATFORM_TITLE=/\bcrm\b|\bdynamics\b|\bsalesforce\b|\bhubspot\b|\bzoho\b/i, CRM_SEAT_TITLE=/\b(?:consultant|specialist|architect|developer)\b/i;
const CRM_DEV_WORK=[/\bCI\s?\/\s?CD\b|\bcontinuous integration\b|\bcontinuous (?:deployment|delivery)\b/i,/\bdevops\b/i,/\bPCF\b|\bpowerapps component framework\b/i,
 /\bplug-?ins?\b|\bcustom (?:code|coding|application development|components?|controls?)\b/i,/(?:\bC#|\.NET\b|\bJavaScript\b|\bTypeScript\b|\bX\+\+)[^.;]{0,30}\b(?:development|programming|coding)\b/i];
// An operations, admin or automation title ('HubSpot CRM Operations Specialist' with custom code actions) is his own work; elsewhere CI/CD or PCF
// must be one of the kinds, or three kinds are named ('custom code' and 'partner with DevOps' alone are not developer work).
const CRM_OWN_TITLE=/\b(?:operations|ops|admin(?:istrator)?|automation|revops)\b/i;
export function farhanCrmDevelopment(title:string|null|undefined,description:string|null|undefined):boolean{
 const ti=String(title||''),d=String(description||'');
 if(farhanSalesforceCode(d))return true;   // jobs QA 10: Salesforce code asked as hands-on work, whatever the title (Firework, see farhanSalesforceCode)
 if(!CRM_PLATFORM_TITLE.test(ti)||!CRM_SEAT_TITLE.test(ti)||CRM_OWN_TITLE.test(ti))return false;
 const kinds=distinct(CRM_DEV_WORK,d);
 return kinds>=3||(kinds>=2&&(CRM_DEV_WORK[0].test(d)||CRM_DEV_WORK[2].test(d)));
}
// Farhan's field: implementation of a specialist finance or ERP product whose experience the posting asks ('1+ years of Kyriba or TMS
// implementation experience'; NetSuite, SAP, Workday Financials / HCM, Oracle EBS). Asked as years of the product or as its implementation
// experience, in an implementation / consultant / analyst post that names the product or finance work. His CRM platforms are not in the list
// (owner: the Zoho / HubSpot / Salesforce platform cap stays as it is).
const FINANCE_PRODUCT='kyriba|treasury management systems?|TMS(?= implementation| experience| or kyriba| and kyriba|\\s*\\(treasury)|netsuite|sap(?: s/4 ?hana| fico| ariba| successfactors)?|workday(?: financials| hcm| financial management)?|oracle (?:ebs|e-business suite|fusion|financials|cloud erp)|coupa|blackline|anaplan|onestream';
const FINANCE_PRODUCT_ASKED=new RegExp(`\\b\\d{1,2}\\s*\\+?\\s*(?:-\\s*\\d{1,2}\\s*)?years?\\b[^.;]{0,30}?\\b(?:${FINANCE_PRODUCT})\\b|\\b(?:${FINANCE_PRODUCT})\\b(?: or [\\w/-]+)? (?:implementation|configuration) experience\\b`,'i');
const FINANCE_PRODUCT_TITLE=new RegExp(`\\b(?:${FINANCE_PRODUCT})\\b`,'i');
// A requirement only welcomed ('NetSuite implementation experience is a plus', 'preferred') or denied is not one. TMS counts only as a treasury
// management system (beside Kyriba or treasury words), never a transportation management system.
const FINANCE_SOFT_AFTER=/^[^.;\n]{0,40}\b(?:a plus|plus|an advantage|advantageous|preferred|desirable|nice to have|a bonus|beneficial|an asset)\b/i;
export function farhanFinanceProductImplementation(title:string|null|undefined,description:string|null|undefined):boolean{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(!/\b(?:implementation|implementer|consultant|analyst|specialist|functional)\b/i.test(ti))return false;
 if(/\btransportation management\b|\bTMS\b[^.;]{0,20}\b(?:freight|logistics|shipping|carriers?)\b/i.test(d)&&!/\bkyriba\b|\btreasury\b/i.test(d))return false;
 const g=new RegExp(FINANCE_PRODUCT_ASKED.source,'gi');let m:RegExpExecArray|null,asked=false;
 while((m=g.exec(d))){if(FINANCE_SOFT_AFTER.test(d.slice(m.index+m[0].length))||deniedBefore(d,m.index))continue;asked=true;break;}
 return asked&&(FINANCE_PRODUCT_TITLE.test(ti)||/\b(?:treasury|finance|financial|accounting|erp|payroll|hcm)\b/i.test(d));
}
// Farhan, a stretch (Worth a try at most): a marketing-automation platform he has not used, required ('Pardot administration: Salesforce
// connector, Engagement Studio', '3+ years of Marketo', 'Eloqua certification required'). Not when only welcomed ('a plus', 'preferred') or
// offered as one choice ('Marketo or HubSpot').
const MAP_PLATFORM='pardot|marketo|eloqua|account engagement';
const MAP_REQUIRED=new RegExp(`\\b(?:${MAP_PLATFORM})\\b[^.;]{0,12}\\badmin(?:istration|istrator|istering)?\\b|\\badminist(?:er|ering|ration of)\\s+(?:${MAP_PLATFORM})\\b|\\b\\d{1,2}\\s*\\+?\\s*years?\\b[^.;]{0,30}\\b(?:${MAP_PLATFORM})\\b|\\b(?:${MAP_PLATFORM})\\b[^.;]{0,20}\\b(?:certification|certified|expertise|experience) (?:is )?(?:required|mandatory|a must)\\b`,'gi');
const MAP_SOFT_AFTER=/^[^.;\n]{0,40}\b(?:a plus|an advantage|advantageous|preferred|desirable|nice to have|a bonus|beneficial)\b|^[^.;\n]{0,25}\bor (?:hubspot|gohighlevel|similar|equivalent)\b/i;
const MAP_CHOICE_BEFORE=/\b(?:hubspot|gohighlevel|ghl|similar)\b[^.;]{0,25}\bor\s+(?:[\w-]+\s+){0,2}?(?:pardot|marketo|eloqua|account engagement)\b/i;   // 'HubSpot or Marketo'
export function farhanMarketingPlatformRequired(description:string|null|undefined):string|null{
 const d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');MAP_REQUIRED.lastIndex=0;let m:RegExpExecArray|null;
 while((m=MAP_REQUIRED.exec(d))){
  if(MAP_SOFT_AFTER.test(d.slice(m.index+m[0].length))||MAP_CHOICE_BEFORE.test(d.slice(Math.max(0,m.index-40),m.index+m[0].length))||deniedBefore(d,m.index))continue;
  return (new RegExp(MAP_PLATFORM,'i').exec(m[0])?.[0]||'').replace(/\b\w/g,(c)=>c.toUpperCase());
 }
 return null;
}
// Farhan, a stretch: an agency placing someone with its client ('We are hiring a marketing consultant for our client', 'on behalf of our client')
// framed as a contract, or as coordination of creative marketing work ('the creative side of marketing projects', 'creative teams', twice).
const CLIENT_PLACEMENT=/\b(?:hiring|recruiting|seeking|looking for)\b[^.;]{0,60}?\bfor (?:our|a|one of our) client(?:,|\s+(?:who|that|which|based|in)\b)|\bon behalf of (?:our|a|one of our) clients?\b|\bplaced (?:with|at) (?:our|a) client\b|\bdeployed (?:at|to|with) (?:our|a) client\b/i;   // placement wording; 'onboarding for our clients' is not
const CONTRACT_FRAMING=/\bcontract(?:ual)? (?:role|position|basis|engagement|assignment)\b|\bopen to (?:a )?contract\b|\b(?:long|short)[- ]term contract\b/i;
const CREATIVE_WORK=/\bcreative (?:side|teams?|marketing|production|aspects|elements|projects|deliverables)\b|\bcreative, (?:and )?production\b/gi;
export function farhanClientPlacement(description:string|null|undefined):boolean{
 const d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(!CLIENT_PLACEMENT.test(d))return false;
 return CONTRACT_FRAMING.test(d)||(d.match(CREATIVE_WORK)||[]).length>=2;
}
// Farhan's level: a post for recent graduates or early-career people ('Recent graduate or early-career candidate in Computer Science'), or a
// specialist / coordinator post asking at most 2 years for high-volume email and phone outreach ('2+ years', 'Remote with high email and phone volume').
const EARLY_CAREER=/\brecent (?:college |university )?grad(?:uate)?s?\b|\bnew grad(?:uate)?s?\b|\bearly[- ]career (?:candidates?|professionals?|talent|role|position|hires?)\b|\bentry[- ]level (?:role|position|candidates?|opportunity)\b/i;
const OUTREACH_VOLUME=/\bhigh (?:email|call|phone|ticket|outreach)\b|\b(?:email|phone|call) (?:and (?:email|phone|call) )?volume\b|\bmulti-touch\b|\boutbound (?:calls|outreach|dialing)\b|\bcold (?:calls?|calling|outreach)\b/i;
export function farhanBelowLevel(title:string|null|undefined,description:string|null|undefined,need:number):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(anyNotDenied(EARLY_CAREER,d))return 'a recent-graduate or early-career post';
 // the years as written ('2+ years in customer onboarding' is not read by yearsRequired(), which wants 'experience' after the years)
 const few=need>0?need<=2:/\b[12]\s*\+?\s*years?\b/i.test(d)&&!/\b(?:[3-9]|1\d)\s*\+?\s*(?:-\s*\d+\s*)?years?\b/i.test(d);
 if(/\b(?:specialist|coordinator|associate|representative)\b/i.test(ti)&&!/\b(?:senior|sr|lead|principal|manager|head)\b/i.test(ti)&&few&&OUTREACH_VOLUME.test(d))return 'an outreach post asking at most 2 years';
 return null;
}
// Farhan, kept but not in Best matches (a stretch for him): an analyst post built on SQL and a BI tool; a Salesforce developer seat (Apex with SOQL or
// Lightning Web Components); an integration post that requires a vendor's certification (Workato, MuleSoft, Boomi); a technical pre-sales seat
// asking strong proficiency in a programming language.
const IPAAS_CERT=/\b(?:workato|mulesoft|boomi|celigo|tray\.io|informatica)\b[^.;]{0,25}\bcertifi(?:cation|ed)\b(?![^.;]{0,40}\b(?:preferred|a plus|plus|nice|bonus|advantage|desirable)\b)/i;
export function farhanStretchOnly(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(/\banalyst\b/i.test(ti)&&/\bSQL\b/.test(d)&&/\bBI\b|business intelligence|tableau|looker|power ?bi\b/i.test(d))return 'an SQL and BI reporting post';
 if(/\bApex\b/.test(d)&&/\bSOQL\b|\bLWC\b|lightning web components/i.test(d))return 'a Salesforce developer seat (Apex)';
 if(IPAAS_CERT.test(d))return 'an integration post that requires a vendor certification';
 if(/\bstrong proficiency in (?:javascript|typescript|python|java)\b/i.test(d))return 'a technical seat asking strong programming proficiency';
 const map=farhanMarketingPlatformRequired(d);if(map)return `a post that requires ${map}, a marketing-automation platform the profile does not list`;   // jobs QA 9
 if(farhanClientPlacement(d))return 'an agency placement with a client (contract or creative-marketing coordination)';   // jobs QA 9
 return farhanStretchOnlyQa10(ti,d);   // jobs QA 10
}
// Sana's field: other professions that share her words. A software or analytics vendor's implementation post ('implementation of UptimeAI's
// AI-powered industrial analytics platform', 'analytical models'); a BI or analytics post ('Analytics' in the title, or Power BI / Tableau / cloud IoT
// tools in the text); design work in a product company ('design and project execution experience in an engineering or product-based organization');
// café, restaurant and retail outlet upkeep; a construction contractor's plant and equipment fleet; container-terminal cranes (RTG, RMG, STS); a
// control and instrumentation post that asks a C&I or electronics degree; OT cybersecurity (firewalls, VPNs, CERT-In); machine-tool overhaul
// (spindles, ball screws, LM guides).
const SANA_BI_TOOLS=[/\bpower ?bi\b/i,/\btableau\b/i,/\baws\b/i,/\bazure\b/i,/\bpython\b/i,/\bSQL\b/,/\bdashboards?\b/i,/\biot platforms?\b|\bazure iot\b/i];
const SANA_RETAIL=[/\bQSR\b/,/\bcaf(?:e|é)s?\b/i,/\brestaurants?\b/i,/\boutlets?\b/i,/\bretail\b/i,/\bstore (?:renovations?|openings?|maintenance)\b|\bstores\b/i];
const SANA_CRANES=[/\bRTGC?s?\b/,/\bRMGC?s?\b/,/\bSTS\b/,/\bcontainer terminals?\b/i,/\bquay cranes?\b|\bship[- ]to[- ]shore\b/i,/\bport (?:equipment|cranes?)\b/i];
const SANA_STUDIES=[/\bpower systems? stud(?:y|ies)\b/i,/\bload[- ]flow\b/i,/\bshort[- ]circuit (?:stud|analys|calc)/i,/\b(?:dynamic|transient|voltage|rms) stability\b/i,/\bgrid (?:connection|integration|impact) stud/i,/\btransmission (?:planning|stud)/i];
const SANA_MACHINE_TOOL=[/\bspindles?\b/i,/\bball ?screws?\b/i,/\bLM guides?\b|\blinear guides?\b/i,/\bmachine geometry\b|\bbacklash\b/i];
export function sanaOtherProfession(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 const own=/maintenance|o ?& ?m\b|reliability|operations/i.test(ti);
 if(/\bimplementation\b/i.test(ti)&&/\b(?:ai|analytics|software|saas|digital|iot|cloud)(?:[- ]powered)?\s+(?:[\w-]+\s+){0,3}platform\b|\banalytical models?\b/i.test(d))return 'software platform implementation';
 if(/\banalytics\b/i.test(ti)||(!own&&distinct(SANA_BI_TOOLS,d)>=3))return 'data and analytics';
 if(/\bdesign and project execution\b|\bproduct[- ]based (?:organi[sz]ation|company)\b/i.test(d))return 'design, product or consultancy';
 // power-system studies for a consultancy ('Power Systems Studies team', load flow / short-circuit / stability studies in PSS/E or DIgSILENT)
 if(!/maintenance|o ?& ?m\b|commissioning/i.test(ti)&&(distinct(SANA_STUDIES,d)>=3||(distinct(SANA_STUDIES,d)>=1&&/\bPSS\W?E\b|\bDIgSILENT\b|\bPSCAD\b|\bPowerFactory\b/i.test(d))))return 'design, product or consultancy';
 if(distinct(SANA_RETAIL,d)>=3)return 'retail and restaurant upkeep';
 if(/\bconstruction (?:plant|equipment)\b|\bplant and equipment\b[^.]{0,60}\bconstruction\b|\bheavy (?:equipment|machinery)\b[^.]{0,60}\bconstruction sites?\b/i.test(d))return 'construction equipment fleet';
 if(distinct(SANA_CRANES,`${ti} ${d}`)>=2)return 'container-terminal cranes';
 if(/instrumentation|\bC ?& ?I\b/i.test(ti)&&!/\belectrical\b/i.test(ti)&&/\b(?:degree|diploma|b\.? ?e\b|b\.? ?tech|bachelor'?s?)[^.;]{0,50}\b(?:C ?& ?I|control (?:and|&) instrumentation|instrumentation(?: engineering)?|electronics (?:and|&) communication|E ?& ?C|ECE)\b/i.test(d))return 'control and instrumentation';
 if(/\bcyber ?security\b/i.test(d)&&/\bfirewalls?\b|\bVPNs?\b|\b62443\b|\bCERT-In\b|\bSIEM\b/i.test(d))return 'OT cybersecurity';
 if(distinct(SANA_MACHINE_TOOL,d)>=2)return 'machine-tool (CNC) overhaul';
 const qa9=sanaOtherProfessionQa9(ti,d);if(qa9)return qa9;   // jobs QA 9
 return sanaOtherProfessionQa10(ti,d);   // jobs QA 10
}
// ---- Jobs QA 9 (Sana) ------------------------------------------------------------------------------------------------------------------------
// Other professions that share her words:
//   a civil discipline in the title ('Maintenance Engineer-Civil');
//   field-instrument work under a general plant title: the text names instruments at least four times and more often than electrical or mechanical work
//   ('maintenance, troubleshooting & calibration of field instruments', 'Instrumentation asset', 'instrumentation Vendors');
//   tool-room design ('Design and Built Tool Room - Design and modify production jigs, fixtures, gauges');
//   a product architect or designer title ('Senior Engineer II, Product Architect - Smart Energy');
//   design for a consultancy or maker, three kinds of it ('Design mechanical piping and equipment', 'Develop P&IDs', 'Professional Engineering
//   registration', Caesar II / AutoPipe / Thermoflow, 'experience in mechanical design for turbine-generator groups', 'calculation notes');
//   laundry and hospital facilities ('Experience in large laundry management is required', healthcare linen);
//   an owner's-engineer consultancy for battery storage ('Owner's Engineer ... on at least three (3) utility-scale renewable energy projects', BESS);
//   software consulting for asset management ('Utilities EAM and Field Service Consultant': IBM Maximo, SAP PM/EAM, Infor EAM, go-live support).
// Not when the title is her own work (maintenance, O&M, operations, reliability, commissioning), except the civil title and laundry / hospital work.
const SANA_POWER_DESIGN=[/\bP ?& ?IDs?\b/,/\bdesign (?:mechanical |electrical )?(?:piping|equipment)\b|\bpiping design\b/i,
 /\bexperience in (?:mechanical |electrical )?design\b|\b(?:mechanical|electrical) design (?:for|of)\b|\b(?:mechanical|electrical) design software\b|\bdesign experience\b/i,
 /\bprofessional engineer(?:ing)? (?:registration|licen[cs]e)\b|\bPE (?:registration|licen[cs]e)\b/i,/\bcaesar ii\b|\bautopipe\b|\bthermoflow\b|\bcadworx\b|\bsmart ?plant 3d\b|\bfinite element\b/i,
 /\bsizing calculations?\b|\bcalculation notes?\b/i,/\bengineering (?:services|deliverables)\b|\bproject deliverables\b/i];
const SANA_EAM_SOFTWARE=[/\bmaximo\b/i,/\bSAP (?:PM|EAM|S\/4)/,/\binfor (?:EAM|cloudsuite)\b/i,/\bIFS\b/,/\benterprise asset management (?:platforms?|solutions?|software|systems?)\b/i,/\bfield service (?:management|software|solutions?|transformation)\b/i,
 /\bgo-?live\b/i,/\bsolution (?:configuration|design)\b|\bfunctional design\b/i,/\btechnology (?:implementations?|transformation)\b/i];
const SANA_OWN_TITLE=/maintenance|o ?& ?m\b|operations|reliability|commission/i;
// Tool-room design: a design verb next to jigs, fixtures, gauges or tooling ('Design and modify production jigs, fixtures'; 'designated' is no design).
const TOOL_DESIGN=/\bdesign(?:s|ed|ing|er)?\b[^.;]{0,40}\b(?:jigs?|fixtures?|gauges?|tooling)\b|\b(?:jigs?|fixtures?|tooling)\b[^.;]{0,20}\bdesign(?:s|ed|ing)?\b/i;
// Laundry and hospital work is the job itself ('Experience in large laundry management is required', 'maintain the hospital facilities'), never a
// perk or the township around a plant ('township, school and hospital facilities', 'medical and hospital facilities for employees').
const LAUNDRY_WORK=/\blaundry (?:management|industry|plants?|operations|facilit(?:y|ies)|equipment|processing)\b|\bexperience in (?:a |large |industrial )*laundr(?:y|ies)\b|\b(?:healthcare )?linen (?:facilit(?:y|ies)|processing|services?|plants?)\b/i;
const HOSPITAL_WORK=/\b(?:maintain(?:s|ing)?|maintenance of|run(?:s|ning)?|operat(?:e|es|ing)|keep(?:s|ing)?|manag(?:e|es|ing)|upkeep of|engineering (?:team|services) (?:of|for))\b[^.;]{0,40}\b(?:hospital|healthcare) (?:facilit(?:y|ies)|buildings?|campus(?:es)?|plant rooms?)\b|\bhospital (?:engineering|maintenance)\b/i;
const PERKS_NEAR=/\b(?:township|school|schools|benefits?|perks?|amenities|medical (?:and|&) hospital|for (?:employees|staff|families)|accommodation|housing)\b/i;
const anyOutsidePerks=(re:RegExp,d:string)=>{const g=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(d)))if(!PERKS_NEAR.test(d.slice(Math.max(0,m.index-60),m.index+m[0].length+40)))return true;return false;};
export function sanaOtherProfessionQa9(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(/\bcivil\b/i.test(ti)&&!/\bmechanical\b|\belectrical\b|\bC ?& ?I\b|\bI ?& ?C\b|\bE ?& ?I\b|\binstrument/i.test(ti))return 'civil engineering';   // civil the only discipline ('Civil | Mechanical | Electrical | C&I' is not)
 const instruments=(d.match(/\binstrument\w*/gi)||[]).length,elecMech=(d.match(/\belectrical\b|\bmechanical\b|\bmotors?\b|\bswitchgear\b|\btransformers?\b|\bpumps?\b|\bcompressors?\b|\bturbines?\b/gi)||[]).length;
 if(!/\belectrical\b|\bmechanical\b/i.test(ti)&&!SANA_OWN_TITLE.test(ti)&&!/\binstrument/i.test(ti)&&instruments>=4&&instruments>elecMech)return 'control and instrumentation';   // not an instrument commissioning title (jobs QA 8 recall)
 if(/\btool ?room\b/i.test(d)&&TOOL_DESIGN.test(d))return 'tool-room and jig design';   // before the own-title exemption: the posts are titled 'Senior Maintenance Engineer'
 if(/\bproduct (?:architect|design(?:er)?|development)\b|\barchitect\b/i.test(ti))return 'design, product or consultancy';
 if(anyOutsidePerks(LAUNDRY_WORK,d)||(/\bmaintenance|facilit/i.test(ti)&&anyOutsidePerks(HOSPITAL_WORK,d)))return 'laundry and hospital facilities';
 if(SANA_OWN_TITLE.test(ti))return null;
 if(distinct(SANA_POWER_DESIGN,d)>=3)return 'design, product or consultancy';
 if(/\bowner['’]?s'? engineer/i.test(d)&&/\bBESS\b|\bbattery (?:energy )?storage\b/i.test(`${ti} ${d}`))return 'owner\'s-engineer consultancy';
 if(/\bconsultant\b/i.test(ti)&&distinct(SANA_EAM_SOFTWARE,d)>=3)return 'asset-management software consulting';
 return null;
}
// Sana's level: a post for diploma and ITI holders ('Diploma in Electrical/Mechanical Engineering or relevant ITI holders with minimum 3 years')
// is a technician's grade, when the text names no engineering degree.
// Only when the diploma / ITI is the applicant's own qualification ('Diploma ... or relevant ITI holders with minimum 3 years', 'Qualification: ITI'),
// not the team they lead ('supervise ITI fitters'), and the text asks no engineering degree (B.E., B.Tech, M.E., M.Tech, a bachelor's, 'Graduate
// in Electrical Engineering').
const ITI_APPLICANT=/\b(?:diploma|ITI)\b[^.;]{0,60}\b(?:or|\/)\s+(?:relevant\s+|equivalent\s+)?ITI\b|\bITI (?:holders?|certificate|qualified|pass(?:ed)?|trade (?:certificate|holders?))\b|\b(?:qualifications?|requirements?|eligibility|education)\s*:?\s*[^.;]{0,30}\b(?:diploma|ITI)\b/i;
const ENGINEERING_DEGREE=/\bB\.?\s?E\b|\bBSc\b|\bB\.Sc\b/;
const ENGINEERING_DEGREE_I=/\bb\.\s?e\.|\bb\.?\s?tech\b|\bm\.\s?e\.|\bm\.?\s?tech\b|\bbachelor|\bdegree\b|\bgraduate (?:in|of) [^.;]{0,40}\bengineering\b|\bgraduate engineer|\bengineering graduate/i;
export function sanaTechnicianQualification(description:string|null|undefined):boolean{
 const d=String(description||'').replace(/\s+/g,' ');
 return /\bITI\b/.test(d)&&ITI_APPLICANT.test(d)&&!ENGINEERING_DEGREE.test(d)&&!ENGINEERING_DEGREE_I.test(d);   // 'BE' in capitals ('may be based' is no degree)
}
// Both: the experience asked is far above the person's: 20 years or more, or 8 or more beyond theirs ('a minimum twenty (20+) years [15 years for
// UAE Nationals] experience in the Oil & Gas'). Written figures in brackets are read, bracketed asides dropped, and the longer route for a diploma
// holder is not the requirement ('B.E. with 15+ years; Diploma with 20+ years' asks 15).
export const FAR_ABOVE_YEARS_ABS=20, FAR_ABOVE_YEARS_GAP=8;
const YEARS_ASKED=/\b(?:minimum|min\.?|at least|requires?|required|must|you (?:have|bring|will have|should have)|should have|experience\s*:|qualifications?|candidates? (?:with|having)|applicants? (?:with|having))\b[^.;]*$/i;
const YEARS_COMPANY=/\b(?:we|our|us|company|firm|group|organi[sz]ation|business|brand|leader|player|provider|manufacturer|has|boasts?|with over|for over|more than)\b[^.;]{0,40}$/i;
export function yearsFarAbove(description:string|null|undefined,have:number):number{
 const d=String(description||'').replace(/\((\d{1,2})\s*\+?\s*\)/g,' $1+ ').replace(/\[[^\]]{0,60}\]/g,' ').replace(/\bdiploma\b[^.;]{0,60}?\bwith\s+\d{1,2}\s*\+?\s*years?[^.;]*/gi,' ').replace(/\s+/g,' ');
 // only a figure asked of the applicant: 'N+ years', or one after 'minimum' / 'at least' / 'experience:' ('founders ... with over 20 years of
 // experience' is the company's story, not a requirement)
 let need=0;const re=/(?<![\w.])(\d{1,2})\s*(\+|plus)?\s*(?:(?:-|to|–)\s*\d{1,2}\s*\+?\s*)?years?\b/gi;let m:RegExpExecArray|null;
 while((m=re.exec(d))){const n=Number(m[1]),before=d.slice(Math.max(0,m.index-45),m.index);
  if(n<1||n>30||/\b(?:founded|founders?|alumni|history|legacy|heritage|since|over the (?:past|last))\b/i.test(before))continue;
  if(!yearsRequired(d.slice(m.index,m.index+m[0].length+60))&&!/\bexperience\s*:\s*\(?\s*$/i.test(before))continue;   // the figure is years of experience ('Experience: 20 - 25 Years')
  // asked of the applicant: requirement words, a qualification line, or a bullet; never a figure whose subject is the company ('a power company with
  // 25+ years of experience', 'we have 20+ years')
  const asked=YEARS_ASKED.test(before)||/\b(?:degree|bachelor|b\.?\s?e\b|b\.?\s?tech|diploma|engineering)\W*$/i.test(before)||/(?:^|[•●▪·*\-–]\s*)$/.test(before);
  if(!asked&&(!m[2]||YEARS_COMPANY.test(before)))continue;
  if(YEARS_COMPANY.test(before)&&!YEARS_ASKED.test(before))continue;
  need=Math.max(need,n);}
 return need>=FAR_ABOVE_YEARS_ABS||(have>0&&need>=have+FAR_ABOVE_YEARS_GAP)?need:0;
}
// Sana, kept but not in Best matches (Worth a try at most): maintenance of discrete-manufacturing lines built on CNC machines, servo drives, robots
// and PLC programming; a narrow specialism (power-electronics converters, a vibration-analyst certification, HVDC transmission, battery storage);
// building facilities for a real-estate services firm; an electrical-licence trade post; a head, director or plant-manager title; and a posting whose
// own ceiling is below her profile ('Experience Minimum: 5 Maximum: 8', an age limit).
const SANA_DISCRETE=[/\bCNC\b/,/\bVMC\b|\bHMC\b/,/\bservo\b/i,/\brobot(?:s|ic|ics)?\b/i,/\bPLC (?:ladder|program\w*|logic)\b|\bladder logic\b|\bTIA portal\b/i,/\bNC control\b|\b8[24]0D\b/,/\bwelding\b/i,/\bMES\b/,/\bpress (?:machines?|shop|lines?)\b|\bpresses\b/i,/\blaser (?:cutting|machines?)\b|\btube mill\b|\bslitting lines?\b/i];   // jobs QA 9: PLC program, MES, presses, laser / tube-mill lines
const FM_EMPLOYER=/\b(?:jll|cbre|cushman|colliers|sodexo|knight frank|savills|compass group|iss facility)\b/i;
export function sanaStretchOnly(title:string|null|undefined,description:string|null|undefined,company:string|null|undefined,have:number,location:string|null|undefined=undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(distinct(SANA_DISCRETE,d)>=3)return 'machine and robot-line maintenance in discrete manufacturing';
 if(/\bconverter specialist\b|\bIGBTs?\b|\bpower electronics\b/i.test(`${ti} ${d}`))return 'a power-electronics converter specialism';
 if(/\bvibration analyst\b[^.;]{0,30}\b(?:level|cat(?:egory)?)\s*(?:II|III|IV|2|3|4)\b/i.test(d))return 'a vibration-analyst certification';
 if(/\bHVDC\b/.test(ti))return 'HVDC transmission service';
 if(/\bBESS\b|\bbattery (?:energy )?storage\b/i.test(ti))return 'battery storage';
 if(FM_EMPLOYER.test(String(company||''))&&/\bbuildings?\b/i.test(d))return 'building facilities for a real-estate services firm';
 if(/["“”']\s?[ABC]\s?["“”'] ?licen[cs]e\b|\b(?:wireman|electrical supervisor) licen[cs]e\b/i.test(d))return 'an electrical-licence trade post';
 if(/^\s*head\b(?!\s+(?:office|quarters))|\bhead (?!office|quarters|count)[a-z]|\bdirector\b|\b(?:power )?plant manager\b|\bplant head\b/i.test(ti)&&!/\b(?:deputy|assistant|asst|associate)\b/i.test(ti))return 'a head, director or plant-manager post';
 const mx=/\bexperience\b[^.;]{0,40}?\bmax(?:imum)?\.?\s*:?\s*(\d{1,2})\b/i.exec(d);if(mx&&have>0&&Number(mx[1])<have)return 'a stated experience ceiling below her years';
 if(/\bage (?:limit|bar)\b|\bmaximum age\b|\bage\s*:?\s*(?:below|under|up ?to|not more than|max(?:imum)?)\s*\d{2}\b/i.test(d))return 'an age limit';
 return sanaStretchOnlyQa9(ti,d,company,location);   // jobs QA 9
}
// Jobs QA 9 (Sana), kept but not in Best matches (Worth a try at most):
//   a degree in mechanical engineering only ('Diploma / B.E. in Mechanical Engineering'; not '... Mechanical, Electrical or a related field');
//   years asked in a specialist sub-domain she has not worked in ('At least 5 years in a Solar Asset Management', '5 Years of experience in
//   HVDC', '10-14 years in ... electricity procurement', '4+ years of hands-on furnace maintenance', BESS), or a robotic-cleaning (ARCS) title;
//   commissioning for an advisory or consulting firm (Deloitte, Accenture, PwC ...);
//   an 'Executive' or 'Senior Executive' grade at a consumer-goods or paints maker;
//   an empty place with an employer named for a country abroad ('TAQA Arabia', Egypt-based): read like an unknown place abroad;
//   remote operations-centre (ROC) monitoring of plants.
const SANA_NICHE='solar asset management|solar (?:plant )?(?:o ?& ?m|operations)|HVDC|BESS|battery (?:energy )?storage|robotic cleaning|(?:renewable )?energy procurement|electricity procurement|power procurement|PPAs?|(?:induction|electric arc|arc|reheating|glass|melting|heat[- ]treatment|industrial) furnaces?|furnace maintenance';   // a boiler furnace is her plant (see below)
const SANA_NICHE_YEARS=new RegExp(`\\b\\d{1,2}\\s*\\+?\\s*(?:(?:-|to|–)\\s*\\d{1,2}\\s*)?\\+?\\s*years?\\b[^.;]{0,70}?\\b(?:${SANA_NICHE})\\b`,'i');
// The degree names mechanical as its subject ('Diploma / B.E. in Mechanical Engineering', 'B.E. / Mechanical', 'BE Mechanical Engineer',
// 'Bachelor's degree (Mechanical)'); 'Degree holders with strong mechanical aptitude' is not.
const DEGREE_WORD=String.raw`(?:diploma|b\.?\s?e\b\.?|b\.?\s?tech\b\.?|bachelor of (?:engineering|technology)|bachelor['’]?s?(?: degree)?|degree|graduate)`;   // jobs QA 10: 'Bachelor of Engineering in Mechanical Engineering'
const MECH_DEGREE=new RegExp(String.raw`\b${DEGREE_WORD}(?:\s*(?:\/|or|,)\s*${DEGREE_WORD})*\s*(?:(?:in|of)\s+|\(\s*|[-–:\/]\s*|(?<=\b(?:b\.?\s?e|b\.?\s?tech)\.?)\s+)mechanical\b(?:\s+engineer(?:ing)?)?`,'gi');
const MECH_DEGREE_OTHER=/\b(?:electrical|EEE|electronics|instrumentation|chemical|mechatronics|industrial|production|power|related|relevant|equivalent|other|any (?:engineering|discipline))\b/i;   // another discipline offered beside mechanical
const CONSULTING_EMPLOYER=/\b(?:deloitte|pwc|price ?waterhouse|kpmg|ernst (?:&|and) young|\bey\b|accenture|mckinsey|boston consulting|bain|capgemini|grant thornton)\b/i;
const CONSUMER_GOODS_EMPLOYER=/\b(?:asian paints|berger paints|kansai nerolac|nerolac|akzo ?nobel|indigo paints|perfetti|nestl[eé]|hindustan unilever|unilever|britannia|dabur|marico|godrej consumer|procter|colgate|mondelez|pepsico|coca[- ]cola|parle|ferrero|kellogg|emami|jyothy|tata consumer|itc limited)\b/i;
const EMPLOYER_ABROAD_NAME=/\b(?:arabia|egypt|misr|africa|nigeria|kenya|morocco|maroc|algeria|tunisia|jordan|lebanon|iraq|turkey|t[uü]rkiye|pakistan|bangladesh)\b/i;
export function sanaStretchOnlyQa9(title:string|null|undefined,description:string|null|undefined,company:string|null|undefined,location:string|null|undefined=undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' '),co=String(company||'');
 MECH_DEGREE.lastIndex=0;let m:RegExpExecArray|null;
 while((m=MECH_DEGREE.exec(d))){const around=d.slice(Math.max(0,m.index-30),m.index)+' '+m[0]+' '+(/^(?:[^.;]|\.(?=\S)){0,50}/.exec(d.slice(m.index+m[0].length))?.[0]||'');if(!MECH_DEGREE_OTHER.test(around))return 'a mechanical-only degree requirement';}
 const niche=SANA_NICHE_YEARS.exec(d);
 if(niche&&!(/furnace/i.test(niche[0])&&/\bboilers?\b|\bpower (?:plants?|stations?)\b/i.test(d)))return 'years asked in a specialist sub-domain she has not worked in';
 // remote operations / monitoring centre work: plant data watched from a centre, not plant maintenance ('monitoring plant operations through ROC,
 // dashboards and historian systems')
 if((/\bROC\b/.test(`${ti} ${d}`)||/\bremote operations? cent(?:er|re)s?\b|\b(?:remote )?monitoring cent(?:er|re)s?\b|\bremote (?:plant )?monitoring\b/i.test(`${ti} ${d}`))&&/\bmonitor(?:s|ing)?\b[^.;]{0,60}\b(?:operations|plants?|performance|KPIs?)\b/i.test(d))return 'remote operations-centre monitoring';
 if(/\bARCS\b|\brobotic cleaning\b/i.test(ti))return 'a robotic-cleaning (ARCS) specialism';
 if(/commission/i.test(ti)&&(CONSULTING_EMPLOYER.test(co)||/\badvisory\b/i.test(ti)))return 'commissioning for an advisory or consulting firm';
 if(/\b(?:sr\.?|senior)?\s*executive\b/i.test(ti)&&!/\b(?:manager|head|lead)\b/i.test(ti)&&(CONSUMER_GOODS_EMPLOYER.test(co)||/\bFMCG\b|\bpaints? (?:manufacturing|industry|plants?)\b/i.test(d)))return 'an executive-grade post at a consumer-goods or paints maker';
 if(location!==undefined&&!String(location||'').trim()&&EMPLOYER_ABROAD_NAME.test(co)&&!INDIA_PLACE.test(d)&&!/\b(?:india|bharat)\b/i.test(d))return 'an employer abroad with no place stated';
 return sanaStretchOnlyQa10(ti,d);   // jobs QA 10
}
// ---- Jobs QA 10 (22 Nov: both live lists, 92 jobs, re-judged by two reviewers after the previous rules release and the wide-intake rebuild) --------
// Farhan, another field (capped like an avoid-list title):
//   a strategy / operations title that asks years in consulting or market research ('a minimum of 6 years in Strategy or Management Consulting',
//   'At least 5 years experience in Marketing Strategy, Research roles'); 'ideally in consulting' alone is a stretch (farhanStretchOnlyQa10);
//   a support, solutions or consultant title that asks infrastructure or security engineering: three kinds of it (production Kubernetes clusters,
//   cloud IAM and VPC networking, Terraform / infrastructure as code, SOC / SIEM tooling), or two named incident-response platforms (RTIR, MISP,
//   OpenCTI, Wazuh, Security Onion ...);
//   a project, programme or delivery manager title asking years (or 'Mandatory:') in another domain: finance / economics / public policy,
//   pharma / clinical research / life sciences, information security / GRC (ISO 27001, SOC 2), data warehousing / ETL / data architecture;
//   a specialist platform asked with years or a required certification ('5+ years of hands-on ServiceNow experience', 'ServiceNow Certified
//   System Administrator (CSA) Required', 'SAP Certification (required)'); his CRM platforms are not in the list;
//   an engineer title asking strong coding and a mandatory developer certification ('Strong development skills in TypeScript and JavaScript',
//   'At least one mandatory Microsoft certification: PL-400 ... or PL-500');
//   a recruiting or staffing title asking years in recruitment ('6–12 years of experience in IT recruitment, technical staffing');
//   hardware or chip design (RTL, ASIC, SoC design, synthesis and timing, STA, the semiconductor industry), three kinds.
const QA10_SOFT_AFTER=/^[^.;\n]{0,40}\b(?:a plus|plus|an advantage|advantageous|preferred|desirable|nice to have|a bonus|beneficial|an asset|optional)\b/i;
const firstAsked=(re:RegExp,d:string)=>{const g=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(d))){if(QA10_SOFT_AFTER.test(d.slice(m.index+m[0].length))||deniedBefore(d,m.index))continue;return m[0];}return null;};   // the first match neither welcomed only nor denied
const askedNotSoft=(re:RegExp,d:string)=>firstAsked(re,d)!==null;
const STRATEGY_CONSULTING_YEARS=/\b(?:minimum|at least|min\.?)\s+(?:of\s+)?\d{1,2}\s*\+?\s*years?\b[^.;]{0,30}\b(?:in|of|with)\s+(?:[\w-]+\s+){0,2}?(?:strategy|management) consulting\b|\b\d{1,2}\s*\+?\s*years?(?: of)?(?: experience)?(?: in| with)\s+(?:marketing strategy|market research|(?:strategy|management) consulting)\b/i;
const FARHAN_INFRA_SEC=[/\bproduction kubernetes\b|\bkubernetes clusters?\b/i,/\bIAM\b[^.;]{0,60}\bVPCs?\b|\bVPCs?\b[^.;]{0,60}\bsecurity groups?\b/i,/\bterraform\b|\bHCL\b|\binfrastructure[- ]as[- ]code\b/i,/\bSIEM\b|\bSOAR\b|\bSOC\b[^.;]{0,20}\b(?:operations|analyst|tooling|workflows)\b/];
const CIRT_PLATFORMS=[/\bRTIR\b/,/\bMISP\b/,/\bOpenCTI\b/i,/\bWazuh\b/i,/\bSecurity Onion\b/i,/\bGraylog\b/i,/\bT-?POT\b/,/\bTARANIS\b/i,/\bGhidra\b/i];
const OTHER_DOMAIN=String.raw`finance|economics|public policy|pharma\w*|biotech\w*|clinical (?:research|trials?|studies)|life sciences|drug development|information security|IT compliance|GRC|cyber ?security|data[- ]warehous\w*|ETL|data model(?:l)?ing|data architecture`;
const DOMAIN_YEARS=new RegExp(String.raw`\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?\b[^.;]{0,90}?\b(?:${OTHER_DOMAIN})\b|\bmandatory\b\s*:?[^.;]{0,80}?\b(?:${OTHER_DOMAIN})\b`,'i');
const FARHAN_OWN_PLATFORM=/\b(?:hubspot|salesforce|zoho|gohighlevel|ghl|zapier|make\.com|n8n|workato)\b/i;
const SPECIALIST_PLATFORM=String.raw`servicenow|successfactors|sap(?: [a-z0-9/]{2,12})?|workday(?: [a-z]{3,12})?|oracle (?:hcm|erp|fusion|ebs|e-business suite|cloud)|netsuite|coupa|anaplan|kyriba|guidewire|pega(?:systems)?|veeva`;
const SPECIALIST_REQUIRED=new RegExp(String.raw`\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?\b(?: of)?(?: hands-on| professional| proven| relevant)?\s+(?:${SPECIALIST_PLATFORM})\b|\b(?:${SPECIALIST_PLATFORM})\b[^.;]{0,80}?\bcertifi(?:cation|ed)\b[^.;]{0,60}?(?:\(\s*)?\b(?:required|mandatory)\b`,'i');
const STRONG_CODING=/\bstrong (?:development|programming|coding|software development) skills in (?:typescript|javascript|python|java|c#|c\+\+|go|golang)\b|\bstrong (?:typescript|javascript|python|java|c#) (?:development|programming|coding) skills\b/i;
const DEV_CERT_REQUIRED=/\bmandatory\b[^.;]{0,40}\bcertification\b|\bcertification\b[^.;]{0,20}\b(?:is )?(?:required|mandatory)\b|\b(?:PL-400|PL-500|PL-600|AZ-204|PD1|PD2)\b[^.;]{0,30}\b(?:required|mandatory)\b/i;
const RECRUIT_YEARS=/\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?(?: of)?(?: experience)?\s+in\s+(?:[\w-]+\s+){0,2}?(?:recruitment|recruiting|staffing|talent acquisition)\b/i;
const CHIP_DESIGN=[/\bRTL\b/,/\bASIC\b/,/\bSoC\b|\bSOC (?:design|RTL|integration|architecture)\b/,/\bsynthesis\b[^.;]{0,40}\btiming\b|\btiming (?:constraints|closure)\b/i,/\bSTA\b/,/\bsemiconductor (?:industry|companies|company|startup)\b/i,/\b(?:system)?verilog\b|\bVHDL\b/i,/\btape-?outs?\b|\bphysical design\b|\bDFT\b/i];
export function farhanOtherFieldQa10(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(/\bstrateg/i.test(ti)&&askedNotSoft(STRATEGY_CONSULTING_YEARS,d))return 'strategy consulting and market research';
 if(/\b(?:support|solutions?|consultant|operations|technical)\b/i.test(ti)&&(distinct(FARHAN_INFRA_SEC,d)>=3||distinct(CIRT_PLATFORMS,d)>=2))return 'infrastructure or security engineering';
 if(/\b(?:project|program(?:me)?|delivery)\s+(?:manager|management|lead)\b|\bPMO?\b/i.test(ti)){const m=firstAsked(DOMAIN_YEARS,d);if(m)return `project management in another domain (${(new RegExp(String.raw`\b(?:${OTHER_DOMAIN})\b`,'i').exec(m)?.[0]||'another field').toLowerCase()})`;}
 const sp=firstAsked(SPECIALIST_REQUIRED,d);if(sp){const name=new RegExp(String.raw`\b(?:${SPECIALIST_PLATFORM})\b`,'i').exec(sp)?.[0]||'a specialist platform';if(!FARHAN_OWN_PLATFORM.test(name))return `specialist platform work (${name}: years or a certification required)`;}
 if(/\bengineer\b/i.test(ti)&&STRONG_CODING.test(d)&&DEV_CERT_REQUIRED.test(d))return 'software development with a required developer certification';
 if(/\brecruit\w*|\bstaffing\b|\btalent acquisition\b/i.test(ti)&&RECRUIT_YEARS.test(d))return 'recruitment and staffing';
 if(distinct(CHIP_DESIGN,`${ti} ${d}`)>=3)return 'hardware or chip design';
 return null;
}
// Farhan's CRM development (why Firework's 'Sales & Marketing Operations Manager' escaped farhanCrmDevelopment in QA 9): that rule reads only a
// CRM consultant / specialist / architect / developer title, never an operations one, and its kinds of developer work had no Salesforce code
// ('Apex', 'SOQL', 'Lightning Web Components') and no 'custom development' or 'custom functionality'. Salesforce code asked as hands-on work
// ('Hands-on proficiency with Salesforce configuration, Salesforce Flow, Apex, SOQL, and custom development', 'Develop custom functionality using
// Apex, SOQL, and Lightning Web Components') is developer work whatever the title. Apex only welcomed ('a plus') stays a stretch.
const SALESFORCE_CODE=/\bApex\b[^.;]{0,40}\b(?:SOQL|LWC|Lightning Web Components)\b|\b(?:SOQL|LWC|Lightning Web Components)\b[^.;]{0,40}\bApex\b/;
const CUSTOM_DEV=/\bcustom (?:development|functionality|code|coding|components?)\b|\bhands-on (?:proficiency|experience|development)\b[^.;]{0,80}\bApex\b|\bdevelop(?:s|ing)?\b[^.;]{0,30}\busing\b[^.;]{0,10}\bApex\b/i;
export function farhanSalesforceCode(description:string|null|undefined):boolean{
 const d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 const g=new RegExp(SALESFORCE_CODE.source,'g');let m:RegExpExecArray|null;
 while((m=g.exec(d))){if(QA10_SOFT_AFTER.test(d.slice(m.index+m[0].length))||deniedBefore(d,m.index))continue;const around=d.slice(Math.max(0,m.index-120),m.index+m[0].length+60);if(CUSTOM_DEV.test(around))return true;}
 return false;
}
// Farhan, a stretch (Worth a try at most):
//   delivery of AI / machine-learning projects that asks the ML engineering itself (three kinds: machine-learning fundamentals with model development,
//   MLOps / LLMOps, Databricks / MLflow, Docker / Kubernetes, NLP or computer vision);
//   remote only 'depending on project and business requirements';
//   hands-on building of agentic or RAG systems (LangChain / LangGraph, RAG pipelines, knowledge graphs, multi-agent orchestration, two kinds);
//   a strategy title built on sales and finance modelling with a consulting, investment-banking or private-equity background.
const FARHAN_ML_WORK=[/\bmachine learning (?:fundamentals|models?)\b[^.;]{0,60}\bmodel (?:development|training|evaluation|deployment)\b|\bmodel development, evaluation\b/i,/\bMLOps\b|\bLLMOps\b/,/\bDatabricks\b|\bMLflow\b|\bSageMaker\b|\bVertex AI\b/i,/\bDocker\b[^.;]{0,20}\bKubernetes\b|\bKubernetes\b[^.;]{0,20}\bDocker\b/i,/\bNLP\b[^.;]{0,30}\bcomputer vision\b|\bcomputer vision\b[^.;]{0,30}\bNLP\b/i];
const AGENT_BUILD=[/\blang(?:chain|graph)\b|\bllamaindex\b|\bcrewai\b|\bautogen\b/i,/\bRAG (?:pipelines?|architectures?|systems?)\b/,/\bknowledge graphs?\b/i,/\bmulti-agent (?:orchestration|systems?)\b/i,/\bvector (?:databases?|stores?)\b/i];
const REMOTE_DEPENDS=/\bremote (?:work |working )?(?:opportunit(?:y|ies)|options?|arrangements?)?\s*(?:depending|dependent|based) on (?:the )?(?:project|client|business)/i;
export function farhanStretchOnlyQa10(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(distinct(FARHAN_ML_WORK,d)>=3)return 'delivery of machine-learning work that asks ML engineering (models, MLOps)';
 if(REMOTE_DEPENDS.test(d))return 'a post that is remote only depending on the project';
 if(/\bhands-on (?:experience )?(?:building|developing|with)\b[^.;]{0,40}\b(?:agentic|multi-agent|AI agents?|RAG|LLM)/i.test(d)&&distinct(AGENT_BUILD,d)>=2)return 'hands-on building of agentic or RAG systems';
 if(/\bstrateg/i.test(ti)&&/\bfinancial (?:and operating )?models?\b|\bquota setting\b/i.test(d)&&/\b(?:consulting|investment banking|private equity)\b/i.test(d))return 'sales strategy and finance modelling (a consulting or banking background)';
 return null;
}
// Farhan's place:
//   remote words that describe other teams ('Experience successfully working with distributed teams as the delivery teams are fully remote') say
//   nothing of this job;
//   a remote job locked to one country other than India wins over an India entry in a multi-place string ('Remote - Bengaluru; Remote - Mexico'
//   with 'This is a remote position open to candidates based in Mexico'; an aggregator's 'Anywhere in the World' for 'This is a fully remote
//   opportunity and can be worked from any location in the United States').
export const OTHER_TEAMS_REMOTE=/\b(?:the |our |their |its |client |customer )?(?:[\w-]+ ){0,2}(?:teams?|colleagues|staff|engineers|developers|workforce|employees|members|consultants)\s+(?:are|is|work|working|operate|that are|who are)\s+(?:fully |100% |mostly |largely |primarily |entirely )?remote(?:ly)?\b/gi;
const COUNTRY_LOCK=/\b(?:position|role|job|opportunity|vacancy)\s+(?:is\s+)?open\s+(?:only\s+)?to\s+(?:candidates|applicants|people|individuals|those)\s+(?:who are\s+)?(?:based|located|residing|living)\s+in\s+(?:the\s+)?([A-Z][\w .,&-]{1,60}?)(?=[.;!)*]|\s*$|\s+(?:only|and|who)\b)|\bcan be (?:worked|performed|done) from any (?:location|where|state|city) (?:in|within|across) (?:the\s+)?([A-Z][\w .&-]{1,40}?)(?=[.;!)*,]|\s*$)|\bthis job is geo-?locked\b/gi;
export function remoteLockedElsewhere(description:string|null|undefined):string|null{
 const d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');COUNTRY_LOCK.lastIndex=0;let m:RegExpExecArray|null;
 while((m=COUNTRY_LOCK.exec(d))){if(deniedBefore(d,m.index))continue;const place=(m[1]||m[2]||'another country').trim();if(/\b(?:india|apac|asia|anywhere|worldwide|world|globe)\b/i.test(place))continue;return place;}
 return null;
}
// Sana, another profession (capped like an avoid-list title):
//   control and instrumentation: an instrumentation title whose minimum qualification is an instrumentation degree ('Minimum qualification:
//   B.E./B.Tech. Instrumentation & Control Engineering'; the full stops of 'B.Tech.' no longer hide it) or that writes DCS / PLC logic ('Preparation
//   and modification of master SCADA/DCS logic', 'Downloading and uploading the program on DCS, PLC');
//   reliability at an AI or software vendor whose job is building its product ('supporting the development of <vendor>'s reliability & predictive
//   maintenance solution', with AI/ML or GenAI work);
//   production or plant management of electronics assembly (SMT, reflow, AOI, PCB, pick-and-place, solder paste: three kinds) under a title that is not
//   maintenance or reliability;
//   reliability in a product-testing or validation lab (shaker rigs, vibration test fixtures, thermal chambers, SOLIDWORKS: three kinds);
//   investment and technical advisory consulting (financial modelling, asset valuation, lender's or independent engineering reviews, due diligence,
//   investment decisions: three kinds).
const CI_DEGREE=/\b(?:degree|diploma|b\.? ?e\b|b\.? ?tech\b|bachelor'?s?)\.?\s*(?:\/\s*(?:b\.? ?e\b|b\.? ?tech\b)\.?\s*)?(?:in\s+)?(?:C ?& ?I\b|control (?:and|&) instrumentation|instrumentation(?: (?:and|&) control)?(?: engineering)?|electronics (?:and|&) communication|E ?& ?C\b|ECE\b)/i;
const CI_LOGIC=/\b(?:DCS|PLC|SCADA)(?:\s*\/\s*(?:DCS|PLC|SCADA))?\s+logic\b|\b(?:download|upload)\w*\b[^.;]{0,40}\bprogram\b[^.;]{0,20}\b(?:DCS|PLC)\b|\bprogramming (?:of |on )?(?:the )?(?:DCS|PLC)\b/i;
const VENDOR_BUILD=/\b(?:development|delivery|building) of\b(?:[^.;]|\.(?=\S)){0,80}\b(?:solutions?|platforms?|products?|software)\b/i, VENDOR_AI=/\bGen ?AI\b|\bAI\s*\/\s*ML\b|\bAI\/\s*GenAI\b|\bsoftware know-how\b/i;
const SMT_WORK=[/\bSMT\b/,/\breflow\b/i,/\bAOI\b/,/\bPCBA?s?\b/,/\bpick[- ]and[- ]place\b/i,/\bsolder paste\b|\bwave soldering\b/i,/\bSPI\b/];
const TEST_LAB=[/\bshakers?(?: rigs?| tables?)?\b/i,/\bvibration (?:test(?:ing|s)?|lab|profiles?)\b/i,/\bthermal chambers?\b|\bclimatic chambers?\b/i,/\btest fixtures?\b/i,/\bSOLIDWORKS\b/i,/\bvalidation (?:lab|tests?|testing)\b|\bDVP\b/i];
const ADVISORY_WORK=[/\bfinancial model(?:l)?ing\b|\bfinancial (?:and economic|consulting) (?:analysis|studies)\b/i,/\basset valuations?\b|\bvaluation assessments?\b/i,/\blender'?s? (?:technical )?reviews?\b|\bindependent engineer(?:ing)?\b/i,/\bdue diligence\b/i,/\binvestment (?:decisions|recommendations|banking)\b|\binvestors\b/i,/\bNPV\b|\bIRR\b/];
export function sanaOtherProfessionQa10(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if(/instrument|\bC ?& ?I\b/i.test(ti)&&!/\belectrical\b|\bmechanical\b|commission/i.test(ti)&&(CI_DEGREE.test(d)||CI_LOGIC.test(d)))return 'control and instrumentation';
 if(/\breliability\b/i.test(ti)&&VENDOR_BUILD.test(d)&&VENDOR_AI.test(d))return 'software product (a reliability solution vendor)';
 if(!/maintenance|reliability|o ?& ?m\b/i.test(ti)&&distinct(SMT_WORK,`${ti} ${d}`)>=3)return 'electronics assembly manufacturing';
 if(distinct(TEST_LAB,d)>=3)return 'product testing and validation';
 if(distinct(ADVISORY_WORK,d)>=3)return 'investment and technical advisory consulting';
 return null;
}
// Sana's level: a technician's grade under an engineer title. An ITI candidate is accepted beside the engineer ('Graduate engineer ... with 2–3
// years' experience; OR Diploma engineer with 3–5 years' experience; OR ITI candidate with 8–10 years'), or the graduate route asks at most 3 years
// with a diploma route offered beside it.
const ITI_ROUTE=/\b(?:or|\/)\s+(?:relevant\s+)?ITI\b(?:\s+(?:candidates?|holders?|qualified))?[^.;]{0,30}\bwith\b|\bITI (?:candidates?|holders?)\s+with\s+\d/i;
const GRADUATE_FEW=/\b(?:graduate|degree|bachelor'?s?|B\.?\s?Tech|B\.?\s?E)\b\.?(?:[^.;]|\.(?=\S)){0,60}?\bwith\s+(\d{1,2})\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*years?\b/i;
export function sanaTechnicianGrade(description:string|null|undefined):boolean{
 const d=String(description||'').replace(/\s+/g,' ');
 if(ITI_ROUTE.test(d))return true;
 const g=GRADUATE_FEW.exec(d);return !!g&&Number(g[2]||g[1])<=3&&/\bOR\s+(?:a\s+)?diploma\b|\bdiploma (?:engineers?|holders?) with\b/i.test(d);
}
// Sana, kept but not in Best matches (Worth a try at most):
//   an Executive or Senior Executive grade (title, or the text's own job title: 'Job Description: Maintenance Executive') asking a minimum of 4
//   years or fewer, or accepting a diploma ('Diploma / Bachelor's Degree');
//   a junior engineer post that supports a senior engineer ('Support Senior Engineer', 'tasks as assigned by Senior Engineer');
//   maintenance for a heavy-fabrication shop (welding, rolling, fit-up, blasting, painting: four kinds);
//   engineering services for an IT or office campus ('Position: Campus Head - Engineering Services');
//   a specialist refrigeration or coating process ('ultra-low temperature refrigeration', cryogenic cooling, coating processes);
//   a consultant or advisory title at a consultancy (advisory or consulting practice, 'our clients'): consultancy is capped;
//   years asked in a dedicated reliability role ('Overall 10 years of experience with 5 years in Reliability field').
const EXEC_GRADE_TEXT=/\b(?:job description|position|designation|role|job title)\s*[:\-–]\s*(?:[\w&]+\s+){0,3}?(?:sr\.?\s+|senior\s+)?executive\b/i;
const FEW_YEARS_MIN=/\bminimum\s*(?:of\s*)?:?\s*([1-4])\s*\+?\s*years?\b|\b([1-4])\s*(?:-|–|to)\s*\d{1,2}\s*\+?\s*years?\b|\b([1-4])\s*\+\s*years?\b/i;
const DIPLOMA_ACCEPTED=/\bdiploma\s*(?:\/|or)\s*(?:a\s+)?(?:bachelor|degree|b\.?\s?e\b|b\.?\s?tech)/i;
const FABRICATION=[/\bwelding\b/i,/\brolling\b/i,/\bfit-?up\b/i,/\bblasting\b/i,/\bpainting\b/i,/\bfabrication\b/i];
const CAMPUS_SERVICES=[/\belevators?\b|\blifts\b/i,/\bfire (?:& life safety|and life safety|alarm|fighting|detection|systems?)\b/i,/\bBMS\b/,/\bdata cent(?:er|re)s?\b/i,/\bIFMS\b|\bintegrated facilit/i];
const SPECIAL_PROCESS=[/\bultra-low temperature\b|\bcryogenic\b/i,/\bcascade refrigeration\b|\brefrigeration systems? operating below\b/i,/\bcoating (?:processes|systems|plants?|machines?)\b/i,/\bvacuum (?:systems|technology|pumps)\b/i];
export function sanaStretchOnlyQa10(title:string|null|undefined,description:string|null|undefined):string|null{
 const ti=String(title||''),d=String(description||'').replace(/[*_`#]+/g,' ').replace(/\s+/g,' ');
 if((/\bexecutive\b/i.test(ti)||EXEC_GRADE_TEXT.test(d))&&!/\b(?:manager|head|lead)\b/i.test(ti)&&(FEW_YEARS_MIN.test(d)||DIPLOMA_ACCEPTED.test(d)))return 'an executive-grade post asking few years or accepting a diploma';
 if(/\b(?:support|assist)s?\s+(?:the\s+)?senior engineers?\b|\bassigned by (?:the )?senior engineers?\b/i.test(d))return 'a junior engineer post under a senior engineer';
 if(distinct(FABRICATION,d)>=4)return 'maintenance for a heavy-fabrication shop';
 if(/\bcampus head\b/i.test(`${ti} ${d}`)||(/\b(?:office|IT|corporate|technology) campus\b/i.test(d)&&distinct(CAMPUS_SERVICES,d)>=3))return 'engineering services for an office campus';
 if(distinct(SPECIAL_PROCESS,d)>=2)return 'a specialist refrigeration or coating process';
 if(/\bconsultant\b|\badvis(?:or|ory)\b/i.test(ti)&&/\badvisory\b|\bconsultancy\b|\bconsulting (?:firm|practice|services|organi[sz]ation|team|business)\b|\b(?:our|its) clients\b/i.test(d))return 'a consultancy or advisory post';
 const rel=/\b(\d{1,2})\s*\+?\s*years?\b[^.;]{0,25}\bin (?:the )?reliability (?:field|engineering|roles?|function|domain)\b/i.exec(d);if(rel&&Number(rel[1])>=5)return 'years asked in a dedicated reliability role';
 return null;
}
// Sana's place: an abroad posting whose city the rules do not know ('Pessione', 'Pantin', 'San José', 'Port Harcourt'). Read as abroad when the
// place is unread and the text speaks of another country's terms (a euro, pound or dollar figure, a European salary written '50.000 to 60.000', an
// Italian CCNL contract, a European language asked, US at-will employment), the employer's name holds a country ('WorkNigeria'), or the stored place
// is empty and the text's own Location line names a place abroad. A builtin.com row with no place and no employer name is a US listing.
const ABROAD_CUE=/€|\bEUR\b|£|\bGBP\b|\bCHF\b|\bUSD\b|\$\s?\d|\b(?:salary|pay)[^.;]{0,30}\b\d{2,3}\.\d{3}\b|\bCCNL\b|\b(?:french|german|italian|spanish|dutch|portuguese|polish|swedish|danish|norwegian|finnish|czech)\s+(?:language\s+)?(?:proficiency|fluency|skills|speaker)\b|\b(?:proficien\w*|fluen\w*) in (?:french|german|italian|spanish|dutch|portuguese|polish|swedish|danish|norwegian|finnish|czech)\b|\bat-will\b/i;
// A recruiter or job board named for a country ('WorkNigeria', 'Jobs Kenya', 'Ghana Careers'). Country names only, never a city or a word that is
// also a company name (Phoenix Contact, Jordan Valves, Perth Engineering): the employer's own name says nothing about where the job is.
const BOARD_COUNTRIES='nigeria|kenya|ghana|uganda|tanzania|zambia|zimbabwe|ethiopia|egypt|south africa|africa|uk|united kingdom|britain|ireland|usa|america|canada|australia|new zealand|germany|france|italy|spain|portugal|netherlands|belgium|poland|europe|singapore|malaysia|philippines|indonesia|vietnam|thailand|pakistan|bangladesh|sri lanka|nepal';
const BOARD_COUNTRY_NAME=new RegExp(`^\\s*(?:work|jobs?|careers?|hire|hiring|recruit\\w*|talent|employment)\\s*(?:in\\s+)?(?:${BOARD_COUNTRIES})\\b|\\b(?:${BOARD_COUNTRIES})\\s*(?:jobs|careers|recruitment|recruiting|staffing|hiring|job board)\\s*$`,'i');
// A form label with no answer: the label, a colon, then the next capitalised label and its colon (or the end).
const EMPTY_FORM_FIELD=/\b(?:[Rr]elocation(?: [Aa]ssistance)?|(?:[Vv]isa|VISA) [Ss]ponsorship|[Ss]ponsorship)\s*:\s*(?=(?:[A-Z][\w/&-]*(?:\s+[A-Z][\w/&-]*){0,3}\s*:)|\s*$)/g;
export function foldAccents(s:string|null|undefined){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'');}
export function sanaAbroadUnread(location:string|null|undefined,description:string|null|undefined,company:string|null|undefined,source:string|null|undefined){
 const l=String(location||'').trim(),d=String(description||''),co=String(company||'').replace(/([a-z])([A-Z])/g,'$1 $2');
 if(INDIA_PLACE.test(d)||GULF_PLACE.test(d)||/\b(?:india|bharat)\b/i.test(d))return false;
 if(BOARD_COUNTRY_NAME.test(co))return true;
 if(!l){const tl=textLocation(d);if(tl&&!indianPlace(tl)&&!gulfPlace(tl)&&(foreignLocation(foldAccents(tl))||ABROAD_CUE.test(d)))return true;
  if(/^builtin$/i.test(String(source||''))&&(!co.trim()||/^unknown$/i.test(co.trim())))return true;
  return false;}
 return ABROAD_CUE.test(d);
}
// Sana's place (brief: a remote role is hers only when it is open to India). A remote posting that names no India, APAC, Asia, worldwide or
// anywhere wording at all ('Remote/Traveling (For Corporate Use Only)' for a US contractor) is capped like an on-site job abroad with no visa route.
// A place the rules cannot read ('Noble Voyager', 'Paul Robbins Plant', 'Winona') whose text names only places outside India and the Gulf, or that
// names a US state with no comma ('Central Texas'), is abroad.
// Indian places written with a PIN code after the country code ('Bap, IN, 342301', 'Mandideep, MP, IN, 462 046') are India.
const SANA_REMOTE_REACH=/\b(?:india|apac|asia|asia[- ]pacific|worldwide|anywhere in the world|work from anywhere)\b/i;   // 'global' or 'international' alone is how employers describe themselves
const INDIA_PIN=/,\s*IN\s*,\s*\d{3}\s?\d{3}\s*$/i;
export function sanaIndiaPin(location:string|null|undefined){return INDIA_PIN.test(location||'');}
export function evaluate(candidate:any,p:Posting,ctx:EvalContext={}) {
 const text=`${p.title} ${p.location} ${p.description}`, lower=text.toLowerCase();
 const negated=(pattern:RegExp)=>{const g=new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(lower))){const before=lower.slice(Math.max(0,m.index-55),m.index),after=lower.slice(m.index+m[0].length,m.index+m[0].length+45);if(/\b(no|not|without|unavailable|unable|never|cannot|can't|won't|isn't|aren't|doesn't|don't|no longer)\b[^.!?]*$/.test(before)||/^\s+(?:(?:is |are |will be )?(?:not|no longer|never|unavailable|unsupported)|isn't|aren't|won't be|will not be)\b/.test(after))return true;}return false};   // ANY denial of a sponsorship/relocation phrase wins over a welcoming one
 const indiana=indianaPlace(p.location,p.description,p.source,p.url), india=sanaIndiaCity(p.location)&&!indiana;
 const onsiteText=onsiteByText(p.description);
 const remote=(p.remote&&!onsiteText)||/\b(remote|work from home|telecommut)/i.test(p.location);
 const locLine=textLocation(p.description), lineIndiaRemote=indianPlace(locLine)&&/\b(?:remote|work from home|wfh)\b/i.test(locLine);   // jobs QA 3: 'Location: India (remote)'
 // Jobs QA 4: a remote posting whose title names India among its places ('Marketing Automation Manager - Canada, Spain, India') hires from India.
 const titleIndiaRemote=remote&&titlePlaces(p.title).some((x)=>indianPlace(x));
 // Jobs QA 10 (HCLTech 'Program Manager', Noida: 'working with distributed teams as the delivery teams are fully remote'): remote words about other
 // teams say nothing of this job.
 const remoteDesc=String(p.description||'').replace(OTHER_TEAMS_REMOTE,' ');
 const explicitIndiaRemote=lineIndiaRemote||titleIndiaRemote||india&&(remote||/\b(fully remote|100% remote|remote position|remote role)\b/i.test(remoteDesc))||/\b(remote (?:in|from|within|[-–]) india|india[- ]remote|hiring (?:remote workers|remotely) (?:in|from) india)\b/i.test(text);
 const blocked=/\b(us|usa|u\.s\.|united states|uk|united kingdom|canada|europe|eu|germany|australia)\s+(?:residents?\s+)?only\b|must (?:reside|be based|be located) in (?:the )?(?:us|usa|united states|uk|europe)|not hiring (?:in|from) india|excluding india|except india/i.test(text);
 const security=/\b(?:active |must (?:have|hold) )?(?:secret|top secret) clearance|ts\/sci|\bitar\b|\b(?:us|uk) citizen(?:ship)? (?:only|required)\b/i.test(text);
 // Jobs QA 7 (MSD Rahway: 'Relocation: VISA Sponsorship: Travel Requirements:'): an application-form label left empty offers nothing.
 const offerText=text.replace(EMPTY_FORM_FIELD,' ');
 const sponsorship=/\b(visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome)\b/i.test(offerText)&&!/\brelocation(?: assistance)?(?: provided| available| offered| eligible)?\s*[:\-–]\s*no\b/i.test(offerText)&&!negated(/visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome/);
 // Integration 15 Nov (AECOM Bucharest: 'relocation to Romania is mandatory ... Visa sponsorship will be discussed after the first interview'): a
 // sponsorship that is only to be discussed or considered case by case is not a stated route, so relocation is all that is left.
 const VISA_HEDGED=/\bvisa sponsorship (?:will|may|can|could|might) be (?:discussed|considered|reviewed|evaluated|assessed)\b|\bsponsorship (?:is |will be |may be )?(?:considered |assessed |reviewed )?(?:on a )?case[- ]by[- ]case\b/i;
 // A visa route proper. "Relocation assistance" alone is usually a move within that country (a US posting), so for Sana it counts as a route
 // only in the Gulf, where her profile lists relocation and employers sponsor the work visa (owner review 2026-11-12, top-100 check).
 const visaRoute=/\b(visa sponsorship|sponsorship available|sponsor (?:your |a |the )?(?:work )?visa|work permit (?:support|sponsorship|provided)|international applicants welcome|employment visa (?:is |will be )?provided)\b/i.test(offerText)&&!negated(/visa sponsorship|sponsorship available|sponsor (?:your |a |the )?(?:work )?visa|work permit|international applicants welcome|employment visa/)&&!VISA_HEDGED.test(offerText);
 const gulf=gulfPlace(p.location);
 // Roles reserved for nationals of a Gulf country ("Electrical Technician (Saudi Nationals)", "UAE nationals only").
 const nationalsOnly=NATIONALS_TITLE.test(p.title||'')||NATIONALS_TEXT.test(p.description||'');
 // The posting itself says it offers no visa route ("unable to provide visa sponsorship", "must be authorized to work in the US without current or future sponsorship").
 const noVisaWords=/\b(?:not|never|cannot|unable to)\b[^.!?]{0,60}\b(?:applicants?|candidates?|individuals?|anyone)\b[^.!?]{0,40}?\b(?:who|that)\s+(?:will\s+)?(?:now or in the future\s+)?(?:requires?|needs?)\s+(?:(?:visa|immigration|employment)\s+)?sponsorship|\b(?:unable|not able|cannot|can't|will not|won't|do not|does not|don't|doesn't|not)\b[^.!?]{0,40}\b(?:provide|offer|sponsor|support)\b[^.!?]{0,30}\b(?:visa|work (?:permit|authori[sz]ation)|sponsorship)|\bwithout (?:the )?(?:need for |requiring )?(?:current or future |future or current )?(?:visa )?sponsorship|\bno (?:visa )?sponsorship (?:is |will be )?(?:available|offered|provided)|\bsponsorship\b(?:\s*\([^)]{0,80}\))?\s+(?:is|will)\s+not\s+(?:be\s+)?(?:available|offered|provided)/i.test(text);   // jobs QA 8: 'U.S. work visa sponsorship (such as TN, O-1, H-1B, etc.) is not available'
 // Application-form style answers: 'Visa Sponsorship Available: No', 'Relocation eligible : No' (Black & Veatch, owner review 2026-11-12).
 const noVisaRoute=noVisaWords||/\b(?:visa\s+)?sponsorship(?:\s+(?:available|offered|provided))?\s*(?:\?\s*[:\-–]?|[:\-–])\s*no\b/i.test(text);   // jobs QA 10: 'Is Sponsorship Available? No'
 const globalRemoteWords=/\bworldwide\W{0,6}remote|\bremote\W{0,6}worldwide|remote.?global|work from anywhere in the world/i.test(text);   // 'Remote - Worldwide' and 'Worldwide (Remote)' as well as 'worldwide remote'
 // Plan S5: plain worldwide wording in a remote posting's location ('Remote (Global)', 'Anywhere', 'Worldwide', 'Fully remote') is worldwide remote, unless
 // the location also names a place ('Anywhere in the US', 'Global - EMEA'). For Farhan, 'Remote - APAC' or 'Asia' with no country restriction counts too.
 const locOnly=p.location||'', placeFree=!foreignLocation(locOnly)&&!usOnlyLocation(locOnly)&&!indianPlace(locOnly);
 const worldLocation=placeFree&&(remote||/\b(?:anywhere|worldwide)\b/i.test(locOnly))&&/\b(?:anywhere|worldwide|global|fully remote)\b/i.test(locOnly);
 const asiaLocation=candidate.id==='farhan_shaikh'&&remote&&placeFree&&/\b(?:apac|asia)\b/i.test(locOnly)&&!/\b(?:south[- ]?east|east|central|west(?:ern)?) asia\b/i.test(locOnly);
 const globalRemote=globalRemoteWords||worldLocation||asiaLocation;
 let eligibility='UNKNOWN',reason='No affirmative candidate-specific location evidence.';
 const prof=parseProfile(candidate.search_profile);
 // Plan S8: "work from home" in the description is not a remote signal by itself (a perk of an office job), and a description that sets hybrid work or
 // office days rules a remote-only candidate out. Only wording tied to THIS job counts (tenth-man review: a company's "hybrid working model" for its office
 // staff, or a customer's hybrid schedules, are not the job); a denied mention ("this is not a hybrid role") does not count.
 // Jobs QA 10 (Orange: 'possibility to combine work from office and home (hybrid ways of working)'): that wording sets hybrid work too.
 const officeDays=onsiteText||(()=>{const re=/\b(?:this|the)\s+(?:role|position|job)\s+is\s+hybrid\b|\bhybrid\s+(?:role|position|job)\b|\(hybrid\)|\b\d\s*(?:-\s*\d\s*)?days?\s+(?:a|per)\s+week\s+in\s+(?:the|our)\s+(?:\w+\s+)?office|\bhybrid ways? of working\b|\bcombine work(?:ing)? from (?:the )?office and (?:from )?home\b/gi;const d=String(p.description||'').toLowerCase();let m:RegExpExecArray|null;while((m=re.exec(d))){const before=d.slice(Math.max(0,m.index-40),m.index);if(!/\b(?:no|not|never|isn't|without)\b[^.!?]*$/.test(before))return true;}return false;})();
 // Jobs QA 7: a posting open only to the employer's own staff is no job for either person.
 const internal=internalOnly(p.description);
 if(internal){eligibility='INELIGIBLE';reason='Internal posting: open only to the employer\'s own staff.';}
 else if(security){eligibility='INELIGIBLE';reason='Explicit citizenship, security clearance or licensing restriction requires exclusion.';}
 else if(nationalsOnly&&(!prof||String(prof.home_country||'').toLowerCase()==='india')){eligibility='INELIGIBLE';reason='Reserved for nationals of the employer\'s country.';}
 else if(prof){
  const home=inHomeCountry(prof.home_country,p.location), country=prof.home_country;
  const homeRemote=home&&(remote||/\b(fully remote|100% remote|remote position|remote role)\b/i.test(p.description))||new RegExp(`\\b(remote (?:in|from|within|[-–]) ${escapeRe(country)}|${escapeRe(country)}[- ]remote)\\b`,'i').test(text);
  const blockedHome=prof.home_country.toLowerCase()==='india'&&blocked;
  if(prof.location_mode==='REMOTE_FROM_HOME'){
   if(blockedHome){eligibility='INELIGIBLE';reason=`Posting explicitly restricts work location outside ${country}.`;}
   else if(homeRemote&&!/\b(hybrid|on[- ]site|not remote|no remote)\b/i.test(p.location+' '+p.description)){eligibility='ELIGIBLE';reason=`Posting explicitly supports fully remote work from ${country}.`;}
  }else if(home){
   if(remote){eligibility='ELIGIBLE';reason=`Remote role in ${country}.`;}
   else reason=`Located in ${country}. Whether this location is workable for the candidate is not verified, so it is unknown.`;
  }else if(!blockedHome&&((sponsorship&&!noVisaRoute)||globalRemote)){eligibility='ELIGIBLE';reason=sponsorship&&!noVisaRoute?'Posting affirmatively mentions sponsorship/relocation; eligibility still requires review.':'Posting explicitly advertises worldwide remote work.';}
 }
 else if(candidate.id==='farhan_shaikh'){
  // Owner rules 2026-11-07: remote only (from anywhere; a role that is not remote is not shown), US-only remote is rejected.
  const remoteSignal=remote||explicitIndiaRemote||globalRemote||/\b(fully remote|100% remote|remote[- ]first|remote position|remote role|work from anywhere)\b/i.test(remoteDesc);
  const lockedTo=remoteLockedElsewhere(p.description);   // jobs QA 10
  if(blocked){eligibility='INELIGIBLE';reason='Posting explicitly restricts work location outside India.';}
  else if(FARHAN_SKIP_EMPLOYER.test(p.company||'')){eligibility='INELIGIBLE';reason='Employer the candidate asked to skip.';}
  // Jobs QA 10: the text locks the remote job to one other country ('This is a remote position open to candidates based in Mexico', 'can be worked
  // from any location in the United States'), whatever India entry the place string or an aggregator's worldwide tag carries.
  else if(lockedTo){eligibility='INELIGIBLE';reason=`Remote only for people based in ${lockedTo} (the posting says so), not from India.`;}
  // Jobs QA 7: the text keeps the job in the United States ('OR US Remote', 'Remote position within the United States', a US salary range or
  // benefits package, a 401(k)), whatever an aggregator's worldwide tag says. An employer's own place naming India wins (a job board's does not).
  else if(usRemoteByText(p.description)&&!lineIndiaRemote&&!titleIndiaRemote&&!(indianPlace(p.location)&&!AGGREGATOR_SOURCE.test(String(p.source||'').trim()))){eligibility='INELIGIBLE';reason='Remote within another country only (the posting\'s text says so), not from India.';}
  // Jobs QA 7: a place written '<City> Office' ('Bengaluru Office') is an office, like hybrid or on-site.
  else if(!remoteSignal||officePlace(p.location)){eligibility='INELIGIBLE';reason='Not a remote role (candidate rule: remote only).';}
  // Jobs QA 7: the Location line says hybrid ('Location: Bangalore, Hybrid.'), or 'Work Location: Pune' with office working.
  else if(officeDays||officeByPlaceText(p.description)){eligibility='INELIGIBLE';reason='Hybrid or set office days (candidate rule: remote only).';}
  else if(!explicitIndiaRemote&&!globalRemote&&usOnlyLocation(p.location)){eligibility='INELIGIBLE';reason='Remote within the United States only.';}
  else if(!explicitIndiaRemote&&!globalRemote&&locationClass(p.description||'',p.location||'')==='eu_only'){eligibility='INELIGIBLE';reason='Must be based in the EU or EEA (the posting says so).';}
  // Jobs QA 13 Nov: the owner's US-only rule, extended to every other country: 'Remote (United Kingdom)', 'Remote (Mexico)', 'Remote - EMEA'. Not when the
  // place or the text names India, Asia or APAC, the place also says worldwide / anywhere / global, or the text says worldwide (S5's readings win).
  else if(!explicitIndiaRemote&&!globalRemote&&foreignLocation(p.location)&&!OPEN_PLACE_WORDS.test(p.location||'')&&!INDIA_HIRING_TEXT.test(p.description||'')&&!['worldwide','india_ok'].includes(locationClass(p.description||'',p.location||''))){eligibility='INELIGIBLE';reason='Remote within another country or region only, not from India.';}
  // Live list 16 Nov (MonetizeMore 'Lead Solutions Engineer (Remote)', one copy per country): the text's 'work from anywhere in the world' is the
  // employer's general line, while this copy's own place is one named country (Brazil, Mexico, Cambodia; 'Chile; Argentina; Peru'). A place naming
  // only other countries wins over worldwide words in the text, unless the place itself says India, APAC, Asia, worldwide, anywhere or global, or
  // the text hires from India or APAC. The two readings disagree, so it is not confirmed (UNKNOWN, not ruled out: 'Remote (Germany)' with 'remote
  // worldwide, any time zone' stays a possible job, jobs QA 13 Nov); an unconfirmed Farhan row without India in its place is not shortlisted.
  // 'Remote', 'Multiple Countries' and worldwide places are read as before (S5).
  else if(!explicitIndiaRemote&&globalRemoteWords&&!worldLocation&&!asiaLocation&&foreignLocation(p.location)&&!OPEN_PLACE_WORDS.test(p.location||'')&&!INDIA_HIRING_TEXT.test(p.description||'')){reason='The text says work from anywhere, but this copy\'s place names only another country, so remote from India is not confirmed.';}
  // Live list review 13 Nov: a posting whose place is only 'Remote' but whose text keeps the job in one country (US payroll words such as 401(k),
  // E-Verify or Form I-9; 'must be based in Canada'; 'right to work in the UK') is the same case.
  else if(!explicitIndiaRemote&&!globalRemote&&!foreignLocation(p.location)&&foreignPlaceInPosting(p.title,p.description)&&!INDIA_HIRING_TEXT.test(p.description||'')){eligibility='INELIGIBLE';reason='Remote within another country only (the title or the posting\'s Location line names it), not from India.';}
  else if(!explicitIndiaRemote&&!globalRemote&&!foreignLocation(p.location)&&remoteCountryByText(p.description)){eligibility='INELIGIBLE';reason='Remote within another country only (the posting\'s text says so), not from India.';}
  // Jobs QA 5: the text admits only people based in, or already allowed to work in, other countries ('only consider candidates based in Germany or
  // Spain', 'must hold the right to work in the UK'), whatever the place says.
  else if(!explicitIndiaRemote&&!globalRemote&&!INDIA_HIRING_TEXT.test(p.description||'')&&rightToWorkAbroad(p.description)){eligibility='INELIGIBLE';reason='Open only to people based in or allowed to work in another country (the posting says so), not from India.';}
  // (officeDays already ruled out hybrid and office days above; a passing 'on-site visit' or a denied 'not a hybrid role' no longer blocks, plan S8)
  else if(explicitIndiaRemote&&!/\b(hybrid|on[- ]site)\b/i.test(p.location||'')&&!/\b(not remote|no remote)\b/i.test(p.description||'')){eligibility='ELIGIBLE';reason='Posting explicitly supports fully remote work from India.';}
  else if(globalRemote){eligibility='ELIGIBLE';reason='Posting explicitly advertises worldwide remote work.';}
 }else if(india){
  // Owner decision 2026-11-12: on-site and hybrid roles in India are workable for Sana (was UNKNOWN until airport access was verified).
  if(remote){eligibility='ELIGIBLE';reason='Remote role in India.';}
  else{eligibility='ELIGIBLE';reason=SANA_INDIA_ONSITE_REASON;}
 }
 else if(!blocked&&(((visaRoute||(sponsorship&&gulf))&&!noVisaRoute)||globalRemote)){eligibility='ELIGIBLE';reason=(visaRoute||sponsorship)&&!noVisaRoute?'Posting affirmatively mentions sponsorship/relocation; eligibility still requires review.':'Posting explicitly advertises worldwide remote work.';}
 else if(!blocked&&sponsorship&&!noVisaRoute)reason='Offers relocation, but no visa route from India is stated. '+reason;
 if(noVisaRoute&&eligibility==='UNKNOWN')reason='Posting says it offers no visa sponsorship, so nothing here shows the candidate may work at this location. '+reason;
 const role=prof?!!phraseRegex(prof.role_keywords)?.test(p.title||''):candidate.id==='farhan_shaikh'?FARHAN_ROLE.test(p.title||''):(sanaRoleTitle(p.title)||sanaPowerFieldService(p.title,p.company,p.description));   // jobs QA 8: a power-equipment field service engineer
 const skills=list(candidate.primary_skills).filter(s=>skillFound(s,lower)||!!SKILL_ALIAS[String(s).toLowerCase()]?.test(lower));
 // Plan S11: Sana's other target roles can score. The distinctive part of each of her target roles ('Energy Efficiency', 'Decarbonization', 'Asset
 // Performance', 'Power Plant Operations') counts as a skill when the posting names it, at most twice, so a role outside maintenance is not scored as if
 // it matched nothing of hers.
 if(candidate.id==='sana_ansari'&&!prof)skills.push(...targetSkills(candidate.target_roles,skills,lower).slice(0,TARGET_SKILL_MAX));
 // Jobs QA 13 Nov: a job-board row with no description has no skills to count, so 'O&M Engineer – Adani Power' scored like any title. With no
 // description, or one too short to judge (DUTY_NONE_TEXT, 600 characters: Adani's two-sentence summaries), the phrases of her field in the title
 // count as skills, at most TARGET_SKILL_MAX.
 if(candidate.id==='sana_ansari'&&!prof&&String(p.description||'').trim().length<=DUTY_NONE_TEXT)skills.push(...sanaTitleSkills(p.title||'',skills).slice(0,TARGET_SKILL_MAX));
 // Jobs QA 8: plant commissioning, testing and O&M (a commissioning or O&M title over plant work) count as up to two skills of hers.
 if(candidate.id==='sana_ansari'&&!prof&&role)skills.push(...sanaCommissioningSkills(p.title,p.description,skills));
 // Jobs QA 8: a power-equipment field service engineer (whose title alone did not pass the role test) has that field work as one skill.
 if(candidate.id==='sana_ansari'&&!prof&&role&&!sanaRoleTitle(p.title)&&sanaPowerFieldService(p.title,p.company,p.description))skills.push('Power Equipment Field Service');
 let score=role?Math.min(90,40+skills.length*8+(eligibility==='ELIGIBLE'?10:0)):Math.min(35,skills.length*5);
 // Fit to experience (owner goal 2026-11-07: put first the roles where the candidate is an easy yes). A posting asking for more than
 // two years beyond the candidate's own experience loses points; one whose stated requirement the candidate meets gains a little.
 const have=Number(candidate.total_years_experience)||0, need=yearsRequired(p.description||'');
 // Sana is an engineer with 9+ years: a technician post is below her level (owner review 2026-11-12); so are an operator's and a field officer's
 // (jobs QA 13 Nov: 'Field Operator - Turbine'). A grid or system operator is an employer, not the job.
 const tooJunior=role&&(underLevel(p.title||'',p.description||'',have)||(candidate.id==='sana_ansari'&&!prof&&have>=5&&(SANA_BELOW_LEVEL.test(p.title||'')||sanaTradeTitle(p.title))));   // jobs QA 4: chargeman, foreman, fitter, mechanic...
 const overReach=role&&have>0&&need>have+2, meets=role&&!tooJunior&&have>0&&need>0&&need<=have;
 if(overReach)score=Math.max(0,score-EXPERIENCE_OVER_PENALTY);else if(meets)score=Math.min(PLAIN_CEILING,score+EXPERIENCE_MATCH_BONUS);
 const fit=role&&!prof?(candidate.id==='farhan_shaikh'?farhanTargetFit(p.title||'',candidate.target_roles):targetFit(p.title||'',candidate.target_roles)):null;
 if(fit)score=Math.min(PLAIN_CEILING,score+(fit==='exact'?TARGET_EXACT_BONUS:TARGET_WORD_BONUS));
 const atLevel=role&&!tooJunior&&have>=7&&SENIOR_TITLE.test(p.title||'');
 if(atLevel)score=Math.min(PLAIN_CEILING,score+SENIORITY_BONUS);
 const platform=role?platformGap(p.title||'',candidate.primary_skills):null;
 // Pay floor (owner rule 2026-11-07): only a published range is compared. Below the candidate's floor loses points; reaching the
 // preferred level gains a little. A candidate with no floor on record is never compared.
 const floor=Number(candidate.cash_floor_inr_monthly)||(candidate.id==='farhan_shaikh'?120000:0), preferred=candidate.id==='farhan_shaikh'?2500000/12:0;
 const pay=floor>0?monthlyInr(p.salary):null, belowFloor=!!pay&&pay.hi<floor, preferredPay=!!pay&&!belowFloor&&preferred>0&&pay.hi>=preferred;
 if(belowFloor)score=Math.max(0,score-PAY_BELOW_FLOOR_PENALTY);else if(preferredPay)score=Math.min(PLAIN_CEILING,score+PAY_PREFERRED_BONUS);
 // Employers recorded publicly as hiring worldwide (Farhan: remote from India). Not proof of eligibility, so eligibility is unchanged.
 const key=companyKey(p.company), globalHirer=candidate.id==='farhan_shaikh'&&eligibility!=='INELIGIBLE'&&!!key&&!!ctx.globalHirers?.has(key);
 if(globalHirer&&role)score=Math.min(PLAIN_CEILING,score+GLOBAL_HIRER_BONUS);
 const rejectedOn=key&&ctx.rejected?.has(key)?(ctx.rejected.get(key)||'date not recorded'):null;
 // Funded early-stage founders (Farhan's builder goal): a YC company that is hiring gains a little, for a role-match only.
 const ycBatch=candidate.id==='farhan_shaikh'&&role&&eligibility!=='INELIGIBLE'&&key&&ctx.yc?.has(key)?(ctx.yc.get(key)||'batch not listed'):null;
 if(ycBatch)score=Math.min(PLAIN_CEILING,score+YC_BONUS);
 // Time-zone restriction (remote, but on another region's hours): a cost, not a bar. Agency postings and language requirements likewise.
 const locClass=locationClass(p.description||'',p.location||'');
 const tzRestricted=candidate.id==='farhan_shaikh'&&eligibility!=='INELIGIBLE'&&locClass==='timezone';
 if(tzRestricted)score=Math.max(0,score-TIMEZONE_PENALTY);
 const agency=agencyPosting(p.company||'',p.description||'');
 if(agency&&role)score=Math.max(0,score-AGENCY_PENALTY);
 const lang=languageRequired(p.title||'',p.description||'');
 if(lang&&role)score=Math.max(0,score-LANGUAGE_PENALTY);
 // Plan C1: what the job involves, read from the description (role-matched titles of the two built-in profiles only).
 const descLen=String(p.description||'').length, duties=role&&!prof?dutyCount(candidate.id,p.description):null, dutyAdj=dutyAdjust(duties,descLen,fit==='exact');
 if(dutyAdj>0)score=Math.min(PLAIN_CEILING,score+dutyAdj);else if(dutyAdj<0)score=Math.max(0,score+dutyAdj);
 // Plan C3: the spread above the plain ceiling (applied after C2 and before the caps below, so every cap still wins).
 const spread=spreadBonus(duties,descLen);
 // Plan C2: a title joining two unrelated functions loses a little, unless a target role is contained exactly.
 const mixed=role&&!prof&&fit!=='exact'?mixedTitle(p.title):null;
 if(mixed)score=Math.max(0,score-MIXED_TITLE_PENALTY);
 if(spread)score=Math.min(SCORE_CEILING,score+spread);
 const ukSponsor=candidate.id==='sana_ansari'&&!!key&&!!ctx.ukSponsors?.has(key)&&/\b(uk|united kingdom|england|scotland|wales|london|manchester|birmingham|leeds|glasgow|edinburgh)\b/i.test(p.location||'');
 const reposted=!!(p as any).repost;
 // Ranking quality (owner-approved 2026-11-05). Titles in the candidate's avoid list are capped below the review threshold, and a
 // posting whose only stated location is outside India loses a fixed amount unless it affirmatively supports remote work from India.
 // Both only lower the preliminary score. Eligibility, status and READY rules are not touched, and a human override still wins.
 // Sana: a "Reliability Engineer" whose posting is about product or hardware reliability (Cisco) and names no plant, maintenance or equipment work.
 const productReliability=candidate.id==='sana_ansari'&&!prof&&/reliability/i.test(p.title||'')&&!/\b(plant|maintenance|equipment|asset|rotating|pump|compressor|turbine|boiler)\b/i.test(p.description||'')&&/\b(hardware|product|silicon|semiconductor|software|linux|kubernetes|cloud|devops|trading|low[- ]latency|production systems|infrastructure|battery|batteries|vehicles?|automotive|dfmea|pcb|electronics)\b/i.test(p.description||'');   // battery and vehicle testing: plan S4
 const avoided=prof?!!phraseRegex(prof.avoid_keywords)?.test(p.title||''):avoidedTitle(candidate.id,p.title)||productReliability;
 const foreignOnly=(prof?prof.foreign_penalty:candidate.id==='farhan_shaikh')&&eligibility!=='ELIGIBLE'&&!globalHirer&&foreignLocation(p.location);
 // Sana (owner rule 2026-11-07: anywhere that could be her dream job). From India, an on-site role abroad is realistic only in the
 // Gulf or when the posting offers sponsorship or relocation, so other foreign on-site roles lose points. Eligibility is unchanged.
 // A remote role whose only stated places are abroad ("Remote (Albania, Andorra, ...)", "Austin, Texas" stored as remote) is remote within that region,
 // not from India, unless it says worldwide or names India.
 // QA2 14 Nov: her core plant (thermal/captive power, turbine, boiler, coal handling) ranks above generic facility and agency maintenance posts; before every cap.
 const corePlant=candidate.id==='sana_ansari'&&!prof&&role&&!(DESIGN_TITLE.test(p.title||'')&&!HANDS_ON_TITLE.test(p.title||''))&&/\b(?:thermal|captive|coal[- ]fired|super ?critical)\s+power\b|\bpower (?:plant|station)s?\b|\bturbines?\b|\bboilers?\b|\bcoal handling\b|\bBTG\b/i.test((p.title||'')+' '+String(p.description||'').slice(0,2000));
 if(corePlant)score=Math.min(SCORE_CEILING,score+8);
 const visaUnlikely=candidate.id==='sana_ansari'&&!prof&&!(visaRoute&&!noVisaRoute)&&!ukSponsor&&(foreignLocation(p.location)||indiana||abroadByDescription(p.location,p.description)||(!!lang&&!india&&!indianPlace(p.location)))&&!gulf&&(!remote||(!explicitIndiaRemote&&!globalRemote));
 if(visaUnlikely)score=Math.min(score,VISA_UNLIKELY_CAP);
 const nationalsPreferred=(!prof||String(prof.home_country||'').toLowerCase()==='india')&&NATIONALS_PREFERENCE.test(text);
 if(nationalsPreferred)score=Math.min(score,NATIONALS_PREFERENCE_CAP);
 const electricalOnly=candidate.id==='sana_ansari'&&!prof&&role&&ELECTRICAL_TITLE.test(p.title||'')&&!NON_ELECTRICAL_FIT.test(p.title||'')&&!sanaElectricalMaintenance(p.title,p.description);   // jobs QA 8: not electrical maintenance of a plant, port or utility
 if(electricalOnly)score=Math.max(0,score-ELECTRICAL_ONLY_PENALTY);
 const designOnly=candidate.id==='sana_ansari'&&!prof&&role&&DESIGN_TITLE.test(p.title||'')&&!HANDS_ON_TITLE.test(p.title||'');
 if(designOnly)score=Math.max(0,score-DESIGN_ONLY_PENALTY);
 if(avoided)score=Math.min(score,AVOID_TITLE_CAP);
 if(platform)score=Math.min(score,PLATFORM_GAP_CAP);
 if(tooJunior)score=Math.min(score,UNDER_LEVEL_CAP);
 // Plan S6: too senior is capped just below the person's threshold, so it never reaches Ready: the posting asks for more than their years + 2, or the
 // title is an executive one (VP, chief, plant head, general manager, head of) that none of their target roles names.
 const threshold=Number(candidate.qualification_threshold)||(candidate.id==='farhan_shaikh'?70:60);
 const execTitle=EXEC_TITLE.exec(p.title||''), execTarget=!!execTitle&&list(candidate.target_roles).some((t)=>new RegExp(`\\b${escRe(execTitle[0])}\\b`,'i').test(String(t)));
 const tooSenior=role&&!prof&&(overReach||(!!execTitle&&!execTarget));
 if(tooSenior)score=Math.min(score,threshold-1);
 const farAbove=candidate.id==='farhan_shaikh'&&!prof&&role&&FARHAN_FAR_ABOVE.test(p.title||'')&&!list(candidate.target_roles).some((t)=>FARHAN_FAR_ABOVE.test(String(t)));
 if(farAbove)score=Math.min(score,threshold-FAR_ABOVE_GAP);
 // Jobs QA 4 (both built-in profiles): another job family read from the title or the description, a part-time / freelance / contractor gig, and a
 // required language other than English. Field and gig are capped like an avoid-list title; a required language stays below the Worth-a-try floor.
 const offField=!prof&&role?(candidate.id==='sana_ansari'?sanaOffField(p.title,p.description):candidate.id==='farhan_shaikh'?farhanOffField(p.title,p.description):null):null;
 if(offField)score=Math.min(score,AVOID_TITLE_CAP);
 const gig=!prof&&role&&gigEngagement(p.title,p.description);
 if(gig)score=Math.min(score,AVOID_TITLE_CAP);
 // Jobs QA 6: a virtual-assistant placement or a hands-on support / assistant post for one small business is capped like a gig.
 const assistantGig=candidate.id==='farhan_shaikh'&&!prof&&role?farhanAssistantGig(p.title,p.description,p.company):null;
 if(assistantGig)score=Math.min(score,AVOID_TITLE_CAP);
 // Jobs QA 7 (Farhan): an engineering seat asking real programming, telecom radio specialism or ERP administration is another field; a recent-
 // graduate post or a 2-year outreach post is below his level; an SQL/BI analyst, Salesforce developer, certified-iPaaS or coding pre-sales seat
 // stays a stretch (below his threshold, so Worth a try at most).
 const farhanBuiltIn=candidate.id==='farhan_shaikh'&&!prof&&role, sanaBuiltIn=candidate.id==='sana_ansari'&&!prof&&role;
 const engField=farhanBuiltIn?farhanEngineeringField(p.title,p.description):null;
 if(engField)score=Math.min(score,AVOID_TITLE_CAP);
 const farhanJunior=farhanBuiltIn?farhanBelowLevel(p.title,p.description,need):null;
 if(farhanJunior)score=Math.min(score,UNDER_LEVEL_CAP);
 const farhanStretch=farhanBuiltIn&&!engField&&!farhanJunior?farhanStretchOnly(p.title,p.description):null;
 // Jobs QA 7 (Sana): another profession that shares her words is capped like an avoid-list title; a supervisor post asking at most 4 years is below
 // her level; a narrow specialism, discrete-line machine work, a head / director / plant-manager title or a stated ceiling below her profile stays a
 // stretch (Worth a try at most).
 const otherProfession=sanaBuiltIn?sanaOtherProfession(p.title,p.description):null;
 if(otherProfession)score=Math.min(score,AVOID_TITLE_CAP);
 const sanaSupervisorLow=sanaBuiltIn&&have>=7&&/\bsupervisors?\b/i.test(p.title||'')&&!/\b(?:engineer|manager)\b/i.test(p.title||'')&&need>0&&need<=4;
 if(sanaSupervisorLow)score=Math.min(score,UNDER_LEVEL_CAP);
 // Jobs QA 9: a diploma / ITI post is a technician's grade; experience asked 20+ years, or 8+ beyond the person's, is far above them (both capped).
 const sanaTechnician=sanaBuiltIn&&have>=5&&!otherProfession&&(sanaTechnicianQualification(p.description)||sanaTechnicianGrade(p.description));   // jobs QA 10: an ITI route beside the engineer's
 if(sanaTechnician)score=Math.min(score,UNDER_LEVEL_CAP);
 const yearsFar=(farhanBuiltIn||sanaBuiltIn)?yearsFarAbove(p.description,have):0;
 if(yearsFar)score=Math.min(score,UNDER_LEVEL_CAP);
 const sanaStretch=sanaBuiltIn&&!otherProfession&&!sanaSupervisorLow&&!sanaTechnician?sanaStretchOnly(p.title,p.description,p.company,have,p.location):null;
 const stretchOnly=farhanStretch||sanaStretch;
 // Only on a confirmed row from the employer's own channel: an unconfirmed row, or a job-board row (stored unconfirmed, PUBLIC_FEED_UNVERIFIED), is
 // already Worth a try at most, and capping it below the threshold would hide it.
 const stretchCapped=!!stretchOnly&&eligibility==='ELIGIBLE'&&!p.board;
 if(stretchCapped)score=Math.min(score,threshold-1);
 const langHard=!prof&&role?languageHardRequired(p.title,p.description):null;
 if(langHard)score=Math.min(score,threshold-LANGUAGE_HARD_GAP);
 // Jobs QA 4 (Sana's place): remote with no India, APAC, Asia, worldwide or anywhere wording, or an unread place whose text names only places
 // abroad, is capped like an on-site job abroad with no visa route (the same cap, the same exceptions).
 const unreadPlace=!!String(p.location||'').trim()&&!india&&!indianPlace(p.location)&&!gulf&&!foreignLocation(p.location)&&!COUNT_LOCATION.test(p.location||'');
 const sanaPlaceUnworkable=candidate.id==='sana_ansari'&&!prof&&!visaUnlikely&&!(visaRoute&&!noVisaRoute)&&!ukSponsor&&!gulf&&!india
  &&((remote&&!explicitIndiaRemote&&!globalRemote&&!SANA_REMOTE_REACH.test(text))||(!remote&&unreadPlace&&(usOnlyLocation(p.location)||abroadByDescription('',p.description)||sanaAbroadUnread(p.location,p.description,p.company,p.source)))
   ||(!remote&&!String(p.location||'').trim()&&sanaAbroadUnread('',p.description,p.company,p.source)));   // jobs QA 7: 'Pessione' with a CCNL contract, 'WorkNigeria', builtin.com rows with no place
 if(sanaPlaceUnworkable)score=Math.min(score,VISA_UNLIKELY_CAP);
 // Jobs QA 5: the text admits only people based in, or already allowed to work in, countries other than India and the Gulf, and offers no visa or
 // relocation route: the same cap as an on-site job abroad with no visa route.
 const rightToWorkElsewhere=candidate.id==='sana_ansari'&&!prof&&!india&&!indianPlace(p.location)&&!gulf&&!explicitIndiaRemote&&!((visaRoute||sponsorship)&&!noVisaRoute)
  &&rightToWorkAbroad(p.description,{gulfOk:true});
 if(rightToWorkElsewhere)score=Math.min(score,VISA_UNLIKELY_CAP);
 const indiaUnconfirmed=candidate.id==='farhan_shaikh'&&!prof&&role&&eligibility==='UNKNOWN'&&!foreignLocation(p.location)&&!HIRING_REACH.test(text);
 if(indiaUnconfirmed)score=Math.max(0,score-INDIA_UNCONFIRMED_PENALTY);
 // Jobs QA 2 (14 Nov): a design or study post also stays near her threshold whatever its skills (ETAP study expert at 68 after the -8): at most threshold + 4.
 if(designOnly)score=Math.min(score,threshold+DESIGN_ONLY_HEADROOM);
 if(foreignOnly)score=Math.max(0,score-FOREIGN_LOCATION_PENALTY);
 // The screen itself never returns READY. The daily run's shortlist step (scripts/dataset_apply.mjs) promotes the best screened rows by one stated rule.
 return {status:eligibility==='INELIGIBLE'?'INELIGIBLE':role?'NEEDS_REVIEW':'HOLD',lane:role?'STRONGEST_FIT':'UNASSIGNED',eligibility,reason,score,skills,target_fit:fit,target_exact:fit==='exact'&&exactWithQualifier(p.title||'',candidate.target_roles),qualification_reason:(role?'Cloud discovery match. Full requirements, pay and experience require review before READY.':'Outside candidate target role family; retained for review.')+(fit==='exact'?' Title is one of the candidate\'s target roles.':fit==='word'?' Title is close to one of the candidate\'s target roles.':'')+(atLevel?' Pitched at the candidate\'s level.':'')+(avoided?' Title is on the candidate\'s avoid list (score capped).':'')+(tooJunior?' Pitched well below the candidate\'s experience (score capped).':'')+(platform?` Built around ${platform}, which the profile does not list (score capped).`:'')+(foreignOnly?' Only stated location is outside India (score reduced).':'')+(visaUnlikely?' On-site abroad with no visa route from India stated (score capped).':'')+(nationalsPreferred?' Gives preference to the country\'s nationals (score capped).':'')+(overReach?` Asks for ${need}+ years (score reduced).`:meets?` Meets the stated ${need}+ years.`:'')
  +(tooSenior?' Pitched above the candidate\'s level (score capped below the shortlist).':'')
  +(farAbove?' Principal, director, VP or head-of title, far above the candidate\'s level (kept off the shortlist).':'')
  +(offField?` Reads as ${offField} work, not the candidate's field (score capped).`:'')
  +(gig?' Part-time, freelance or contractor engagement (score capped).':'')
  +(assistantGig?` Reads as ${assistantGig}, below the candidate's level (score capped).`:'')
  +(engField?` Reads as ${engField} work, not the candidate's field (score capped).`:'')
  +(otherProfession?` Reads as ${otherProfession} work, not the candidate's field (score capped).`:'')
  +(farhanJunior?` Reads as ${farhanJunior}, below the candidate's level (score capped).`:'')
  +(sanaSupervisorLow?' Supervisor post asking at most 4 years, below the candidate\'s level (score capped).':'')
  +(sanaTechnician?' Asks a diploma or ITI qualification, a technician\'s grade below the candidate\'s level (score capped).':'')
  +(yearsFar?` Asks ${yearsFar}+ years, far above the candidate's experience (score capped).`:'')
  +(stretchCapped?` Reads as ${stretchOnly}: a stretch, kept off Best matches (score capped below the threshold).`:'')
  +(langHard?` Requires ${langHard} (kept off the shortlist).`:'')
  +(sanaPlaceUnworkable?' Remote or abroad with nothing showing it is open to someone in India (score capped).':'')
  +(rightToWorkElsewhere?' Open only to people based in or allowed to work in another country, with no visa route (score capped).':'')
  +(indiaUnconfirmed?' Remote, but nothing in the posting says it hires from India (score reduced).':'')
  +(belowFloor?` Published pay (up to ${lakhMonth(pay!.hi)}) is below the ${lakhMonth(floor)} floor (score reduced).`:preferredPay?` Published pay reaches the preferred level (up to ${lakhMonth(pay!.hi)}).`:'')
  +(globalHirer?' Employer is listed publicly as hiring worldwide; confirm India is included.':'')
  +(rejectedOn?` Rejected by this employer before (${rejectedOn}).`:'')
  +(ycBatch?` Y Combinator company (${ycBatch}), currently hiring.`:'')
  +(tzRestricted?' Remote, but on another region\'s working hours (score reduced).':'')
  +(agency?' Posted by a staffing agency or recruiter (score reduced).':'')
  +(lang?` Requires ${lang} (score reduced).`:'')
  +(ukSponsor?' Employer holds a UK Skilled Worker sponsor licence.':'')
  +(electricalOnly?' Electrical-only title, ranked below mechanical, reliability and energy roles (score reduced).':'')
  +(designOnly?' Design or study role, ranked below maintenance, O&M and reliability roles (score reduced).':'')
  +(dutyAdj>0?` Names ${duties} of the duties of your work (score raised).`:dutyAdj<0?' Names none of the duties of your work (score reduced).':'')
  +(mixed?` Title mixes two functions (${mixed[0]} and ${mixed[1]}; score reduced).`:'')
  +(reposted?' Reposted: an earlier listing of this role closed.':'')
  +(locClass==='worldwide'?' Posting says: work from anywhere.':locClass==='india_ok'?' Posting names India as a remote location.':'')
  +(role&&skills.length?` Easy-yes check: ${skills.length} of ${list(candidate.primary_skills).length} CV skills named (${skills.slice(0,4).join(', ')}${skills.length>4?', …':''})${meets?`, meets the ${need}+ years asked`:''}.`:'')};
}
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
// Jobs QA 7: the posting URL as one key across sources: lower-case host without 'www.', no trailing slash, and without tracking
// parameters (utm_*, feedId, gh_src, source, src, ref, lever-*, fbclid, gclid, mc_*). Other parameters stay: on many career sites they ARE the job
// ('?gh_jid=6173440004', 'default.aspx?c=apply&lJobID=560804'). The same reading as posting_url_key() in engine/dataset_discovery.py.
export const TRACKING_PARAM=/^(?:utm_[a-z_]*|feedid|gh_src|source|src|ref|referrer|lever-[a-z_-]*|fbclid|gclid|mc_[a-z]+|trk|rss)$/i;
const ORACLE_CX_JOB=/^\/hcmUI\/CandidateExperience\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?(?:sites\/[^/]+\/)?(?:job|requisitions\/preview)\/(\d+)(?:\/.*)?$/i;
export function postingUrlKey(url:string|null|undefined):string{
 let u:URL;try{u=new URL(String(url||'').trim());}catch{return '';}
 if(!/^https?:$/.test(u.protocol))return '';
 const keys:string[]=[];u.searchParams.forEach((_,k)=>keys.push(k));for(const k of keys)if(TRACKING_PARAM.test(k))u.searchParams.delete(k);
 u.searchParams.sort();const q=u.searchParams.toString();
 // Jobs QA 10 (DP World req 28315: '.../hcmUI/CandidateExperience/en/sites/CX_1/job/28315' and a job board's ':443/hcmUI/CandidateExperience/en/job/28315'):
 // an Oracle Recruiting job is its host and requisition id, whatever the language and site parts (the port never counts: hostname has none).
 const path=u.pathname.replace(ORACLE_CX_JOB,'/hcmUI/CandidateExperience/job/$1');
 return u.hostname.toLowerCase().replace(/^www\./,'')+path.replace(/\/+$/,'')+(q?'?'+q:'')+(u.hash.length>1?u.hash:'');   // a fragment can be the job ('...oraclecloud.com/?site_number=CX#26081')
}
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
    AND NOT EXISTS(SELECT 1 FROM candidate_qualifications WHERE candidate_id=excluded.candidate_id AND job_id=excluded.job_id AND manual_override_status IS NOT NULL)`).bind(candidate.id,jobId,result.score,Math.min(100,result.skills.length*20),result.lane==='STRONGEST_FIT'?70:0,result.lane,JSON.stringify({rule_version:RULE_VERSION,preliminary:true,ranking_v2:true,skills_v1:list(candidate.primary_skills).length>0,matched_skills:result.skills,missing_skills:[],note:'Conservative discovery screen; full qualification review pending.'}),now));
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
    JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, [RULES_MARKER]: true, target_exact: !!result.target_exact, skills_v1: list(r.primary_skills).length > 0, assessed_from: 'github_collector', matched_skills: result.skills, missing_skills: [], note: 'Conservative screen of a collector-imported posting; full qualification review pending.' }),
    now, r.candidate_id, r.job_id));
  statements.push(db.prepare(`UPDATE candidate_qualifications SET qualification_status = ?, strategy_lane = ?, eligibility_status = ?, eligibility_reason = ?, qualification_reason = ?, last_reverified_at = ? WHERE ${guard}`)
   .bind(result.status, result.lane, result.eligibility, result.reason, result.qualification_reason, now, r.candidate_id, r.job_id));
 }
 await db.batch(statements);
 return { assessed: rows.length, by_status: byStatus };
}

// ---- Backfill for a newly onboarded client ---------------------------------------------------------------------------
// A new client starts with no rows. This screens active jobs the client has no row for yet (newest first, a bounded batch per call)
// with the same evaluate() as discovery. It only INSERTs: an existing row, an application or a human decision is never touched, and
// nothing becomes READY. Job-board postings get the same "unverified" treatment as in discovery.
// 40 per call, like the assessment batch: evaluate() over long descriptions costs CPU, and Workers Free allows about 10 ms per request.
export const BACKFILL_MAX = 40;
// The job rows a call looks at. Walks `jobs` by rowid, newest first (rowid grows with insertion), starting below `cursor` (the rowid of the last job the previous call looked at), so a call
// reads about n rows however large the catalogue is. The previous version ordered by discovered_at and skipped screened jobs with NOT EXISTS, which made the planner read, probe and sort
// EVERY active job on EVERY call (measured on 21,120 active jobs: 11.2 million job rows scanned to onboard one client, against 21,647 with the cursor).
export const BACKFILL_SELECT = `SELECT j.rowid AS rid, j.id, j.title, j.location_restrictions AS location, j.description, j.workplace_type, j.provenance, j.source_adapter
  FROM jobs j WHERE j.rowid < ? AND j.is_active = 1 AND NOT EXISTS (SELECT 1 FROM candidate_qualifications q WHERE q.candidate_id = ? AND q.job_id = j.id)
   AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ? AND a.job_id = j.id)
  ORDER BY j.rowid DESC LIMIT ?`;
export async function backfillClient(db:DB, candidateId:string, limit=BACKFILL_MAX, now=iso(), cursor:number|null=null) {
 const cand = await db.prepare('SELECT c.*, p.search_profile FROM candidates c LEFT JOIN client_profiles p ON p.candidate_id = c.id WHERE c.id = ?').bind(candidateId).first<any>();
 if (!cand) return { inserted: 0, more: false, by_status: {} as Record<string, number>, next_cursor: null as number | null };
 const n = Math.max(1, Math.min(BACKFILL_MAX, limit));
 const before = cursor !== null && Number.isSafeInteger(cursor) && cursor > 0 ? cursor : Number.MAX_SAFE_INTEGER;   // no cursor: start from the newest job
 const {results} = await db.prepare(BACKFILL_SELECT).bind(before, candidateId, candidateId, n + 1).all<any>();
 const rows = (results || []).slice(0, n);
 const statements: D1PreparedStatement[] = []; const byStatus: Record<string, number> = {};
 for (const r of rows) {
  const posting: Posting = { id: r.id, title: r.title || '', url: '', location: r.location || '', description: plain(r.description), remote: /^REMOTE/i.test(r.workplace_type || '') };
  const result = evaluate(cand, posting);
  if (r.provenance === 'PUBLIC_FEED_UNVERIFIED') { result.eligibility = 'UNKNOWN'; result.reason = `Reported by a public job board (${r.source_adapter || 'unknown'}); employer availability and eligibility are unverified.`; result.status = result.status === 'HOLD' ? 'HOLD' : 'NEEDS_REVIEW'; result.qualification_reason = 'Cloud discovery match. Public job-board/startup announcement; employer verification, full requirements and compensation review pending.'; }
  byStatus[result.status] = (byStatus[result.status] || 0) + 1;
  statements.push(db.prepare(`INSERT OR IGNORE INTO candidate_qualifications(candidate_id,job_id,qualification_status,strategy_lane,eligibility_status,eligibility_reason,qualification_reason,last_reverified_at)
   SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM applications WHERE candidate_id=? AND job_id=?)`).bind(candidateId, r.id, result.status, result.lane, result.eligibility, result.reason, result.qualification_reason, now, candidateId, r.id));
  statements.push(db.prepare(`INSERT OR IGNORE INTO candidate_job_scores(candidate_id,job_id,overall_score,skill_score,role_score,strategy_lane,score_breakdown,calculated_at)
   SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM applications WHERE candidate_id=? AND job_id=?)`)
   .bind(candidateId, r.id, result.score, Math.min(100, result.skills.length * 20), result.lane === 'STRONGEST_FIT' ? 70 : 0, result.lane, JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, assessed_from: 'client_backfill', matched_skills: result.skills, missing_skills: [], note: 'Conservative discovery screen; full qualification review pending.' }), now, candidateId, r.id));
 }
 const done = statements.length ? await db.batch(statements) : [];
 // counted from what was actually written (every second statement is a qualification insert)
 const inserted = done.filter((_: any, i: number) => i % 2 === 0).reduce((k: number, r: any) => k + Number(r?.meta?.changes || 0), 0);
 const more = (results || []).length > n;
 return { inserted, more, by_status: byStatus, next_cursor: more ? Number(rows[rows.length - 1].rid) : null as number | null };
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
    statements.push(db.prepare(`INSERT INTO cloud_discovery_queue(id,source_id,posting_id,payload,state,next_due,updated_at) VALUES(?,?,?,?,'PENDING',?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,state='PENDING',next_due=excluded.next_due,attempts=0,last_error=NULL,updated_at=excluded.updated_at WHERE cloud_discovery_queue.state<>'GONE'`).bind(id,source.id,postingId,JSON.stringify(item),seconds,now));   // a posting its ATS answered 404 for is not fetched again
   }
   counts.jobs_seen=parsed.items.length;
   const interval=source.kind==='remotive'?86400:43200;
   statements.push(db.prepare(`UPDATE cloud_sources SET cursor=?,cursor_token=?,cursor_started_at=?,next_due=?,failures=0,last_attempt_at=?,last_success_at=?,last_error=NULL,last_status=?,last_seen=? WHERE id=?`).bind(parsed.next,parsed.token||null,parsed.token?(source.cursor_token?source.cursor_started_at||seconds:seconds):0,seconds+(parsed.complete?interval:600),now,now,parsed.complete?(parsed.items.length?'SUCCESS':'EMPTY'):'PARTIAL',parsed.items.length,source.id));
   await db.batch(statements);
  }else{
   await db.prepare('UPDATE cloud_automation SET jobs_today=jobs_today+1 WHERE id=1').run();
   const cached=source.kind==='jobicy'||source.kind==='remotive';
   let raw:any;
   try{raw=cached?JSON.parse(work.payload):await boundedJSON(sourceURL(source,work.posting_id),transport);}
   catch(e:any){
    // The employer's own ATS answers 404 for this posting: it was taken down. That is a fact about the posting, not a failure of the
    // engine: the queue item ends as GONE and the job (if stored) is closed. A job someone applied to or decided on is left as it is.
    if(cached||String(e?.message)!=='Source HTTP 404')throw e;
    const closedAt=iso(),ev=await db.prepare('SELECT job_id FROM cloud_job_evidence WHERE source_id=? AND posting_id=?').bind(source.id,work.posting_id).first<any>();
    const st=[db.prepare(`UPDATE cloud_discovery_queue SET state='GONE',last_error='Posting removed upstream (HTTP 404)',updated_at=? WHERE id=?`).bind(closedAt,work.id)];
    if(ev?.job_id)st.push(db.prepare(`UPDATE jobs SET is_active=0,expired_at=? WHERE id=? AND is_active=1
      AND NOT EXISTS(SELECT 1 FROM applications a WHERE a.job_id=jobs.id) AND NOT EXISTS(SELECT 1 FROM candidate_qualifications q WHERE q.job_id=jobs.id AND q.manual_override_status IS NOT NULL)`).bind(closedAt,ev.job_id));
    st.push(db.prepare(`UPDATE cloud_discovery_runs SET status='SUCCESS',completed_at=?,duration_ms=?,job_id=?,error_message='Posting removed upstream (HTTP 404); closed' WHERE id=?`).bind(closedAt,Date.now()-started,ev?.job_id||null,runId));
    st.push(db.prepare('UPDATE cloud_automation SET last_success_at=?,last_error=NULL,updated_at=? WHERE id=1 AND lease_token=?').bind(closedAt,closedAt,token));
    await db.batch(st);
    return {status:'SUCCESS',run_id:runId,source_id:source.id,run_type:kind,duration_ms:Date.now()-started,posting_closed:true,job_id:ev?.job_id||null};
   }
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

