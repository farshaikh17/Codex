// Small durable work units. No application/history writes and no model/API fees.
import { isBroad, broadURL, broadPage, normalizeBroad } from './broad-feeds.ts';
export const RULE_VERSION = 'cloud-conservative-review-1';
// The rules marker (plan R9): a score breakdown carrying {"<RULES_MARKER>": true} was scored under the current rules. The ONLY place it is written;
// scripts/dataset_apply.mjs imports it and engine/dataset_discovery.py reads it from this line. Bump it once per phase that changes evaluate()
// or a scoring rule (every stored row is then re-scored over the next runs). This module is not the Worker entry (worker/index.ts), so exporting is safe.
export const RULES_MARKER = 'profile_v12';
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
// Owner rules 2026-11-07 added: business analyst, deal desk, sales, admin, junior/intern, data engineering, and roles that need
// hands-on Salesforce, HubSpot or Zoho administration or development.
const FARHAN_HARD_AVOID=/\b((?:[a-z0-9+#.]+ )?developer|(?:salesforce|hubspot|zoho|netsuite|dynamics 365) crm (?:admin|administrator|developer|engineer)|business (?:systems )?analyst|sales engineer|pre-?sales|treasury|strategic solutions engineer|commercial operations specialist|cyber[a-z]*|(?:payments?|compensation|pricing|tax|audit|legal|procurement|total rewards|benefits|payroll|travel|hr|people) (?:operations|analyst|specialist)|deal desk|account executive|sales (?:development|representative|executive|associate)|business development (?:representative|executive|associate)|inside sales|administrative assistant|office (?:administrator|assistant)|receptionist|data engineer|intern|internship|junior|apprentice(?:ship)?|trainee|sde|(?:salesforce|hubspot|zoho|netsuite|dynamics 365) (?:admin|administrator|developer|engineer)|software (?:engineer|developer|architect)|software development engineer|(?:back|front)[- ]?end|full[- ]?stack|devops|sre|site reliability|machine learning|ml (?:engineer|scientist)|data scientist|ai engineer|(?:cyber)?security (?:engineer|analyst|architect|specialist)|cyber ?security|infosec|sdet|qa engineer|test automation|qa automation|qa analyst|qa lead|quality assurance|test engineer|tester)\b/i;
// Soft avoid: finance, support and engineering-management families, capped unless the title also names one of his own target areas
// (implementation, solutions, onboarding, integration, automation, CRM, RevOps, operations, business systems, technical delivery).
const FARHAN_SOFT_AVOID=/\b(accountant|accounting (?:manager|analyst)|financial (?:analyst|controller)|finance (?:manager|analyst|controller|director)|controller,? finance|payroll (?:specialist|manager|analyst|administrator|accountant)|customer support|(?:technical |product )?support (?:engineer|specialist|representative|agent)|help ?desk|(?:software )?engineering manager|director of engineering|vp of engineering|head of engineering)\b/i;
const FARHAN_TARGET_WORDS=/\b(implementation|solutions?|onboarding|integrations?|automations?|crm|revops|operations|business systems|technical delivery|chief of staff|founder'?s? (?:office|associate)|gtm engineer)\b/i;
// Builder roles (owner rule 2026-11-07): implementation, automation, technical/revenue operations, GTM engineering, Founder's Office
// and Chief of Staff, in any industry.
// Plan S2 (phase 2): every title the daily searches fetch is recognised (delivery/program/project managers, professional services, technical account
// managers, customer engineers, GoHighLevel and tech-ops titles for Farhan; O&M, shift in-charge, rotating and static equipment, mechanical, thermal,
// solar, hydro, substation, switchgear, energy manager, operations engineer, transmission and renewables for Sana). test/discovery.test.mjs checks
// every search term against these rules.
export const FARHAN_ROLE=/operations|implementation|integration|automation|business systems|crm|revops|sales ops|marketing ops|systems architect|onboarding|solutions|technical delivery|chief of staff|founder'?s? (?:office|associate)|founding (?:operations|ops|generalist)|gtm engineer|go[- ]to[- ]market engineer|ai (?:ops|operations|workflow|implementation)|(?:technical )?(?:delivery|program|project) manager|professional services|technical account manager|customer engineer|gohighlevel|tech ops/i;
export const SANA_ROLE=/electrical|power|energy|turbine|boiler|(?:power|energy|turbine|hvdc|wind|solar|grid|substation|generator|boiler|plant)\W+(?:\w+\W+){0,3}field service|field service engineer\W+(?:\w+\W+){0,3}(?:power|energy|turbine|hvdc|wind|solar|grid|substation|generator|boiler|plant)|plant operator|control room|instandhaltung|wartung|kraftwerk|elektro|betriebsingenieur|zuverl.ssigkeit|anlagen|ing.nieur|centrale|onderhoud|elektrotechnisch|energiebesparing|energieeffizienz|reliability|maintenance|plant|commissioning|utilities|asset performance|decarboni[sz]|sustainab|clean ?tech|efficiency|net[- ]zero|emissions|(?:technical|engineering) consult|o ?& ?m\b|operations (?:and|&) maintenance|shift (?:in[- ]?charge|engineer)|rotating|static equipment|mechanical (?:engineer|maintenance)|thermal|solar|\bhydro(?:gen|power|electric)?\b|substation|switchgear|energy manager|operations engineer|transmission (?:line|engineer|system|network|project)|renewable/i;
// Employers the owner asked to skip (2026-11-07).
const FARHAN_SKIP_EMPLOYER=/^\s*ajaia\b/i;
// A location that names only the United States (owner rule 2026-11-07: US-only remote roles are rejected for Farhan).
const US_ONLY_PLACE=/\b(united states|usa|new york|nyc|bay area|silicon valley|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|dallas|miami|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;   // US state names too ('Remote - Pennsylvania'); Georgia is left out because it is also a country
const OPEN_PLACE=/\b(anywhere|worldwide|global|international|apac|asia|emea|europe|canada|uk|united kingdom|latam)\b/i;
export function usOnlyLocation(location:string){const l=(location||'').replace(EXCLUSION_PHRASE,' ');if(!l.trim()||indianPlace(l)||OPEN_PLACE.test(l))return false;return US_ONLY_PLACE.test(l)||FOREIGN_US_DOTTED.test(l)||FOREIGN_US_BARE.test(l)||FOREIGN_STATE.test(l);}
/** The largest 'N+ years' of experience a posting asks for (0 when it does not say). */
export function yearsRequired(text:string){let best=0;const re=/\b(\d{1,2})\s*(?:\+|plus)?\s*(?:-|to|–)?\s*(?:\d{1,2}\s*)?\+?\s*years?(?:'|’)?\s+(?:of\s+)?(?:[a-z/&-]+\s+){0,4}?experience/gi;let m:RegExpExecArray|null;while((m=re.exec(text||''))){const n=Number(m[1]);if(n>=1&&n<=25&&n>best)best=n;}return best;}
export const EXPERIENCE_OVER_PENALTY=15, EXPERIENCE_MATCH_BONUS=5;
// Roles pitched well below the candidate (spot check 2026-11-12: a diploma-trainee role was "Ready" for someone with 9 years; a 1-3 year junior
// role scored 79). Either the title says so, or the posting's own experience RANGE tops out at half the candidate's experience or less.
// Only applied to a candidate with at least 5 years. The score is capped like an avoid-list title; eligibility and status are unchanged.
export const UNDER_LEVEL_CAP=40, PLATFORM_GAP_CAP=60;   // plan S7: a role built around a platform the profile does not list is capped (was a 20-point deduction)
const JUNIOR_TITLE=/\b(trainee|intern|internship|apprentice|apprenticeship|fresher|freshers|junior|jr|entry[- ]level|graduate engineer|graduate trainee|diploma trainee|werkstudent|praktikant|stagiaire|L1|L2)\b|\bassociate\b(?!\s+(?:director|vice|manager|principal|partner|general|head|lead))/i;
/** The top of the largest stated experience range ("2 to 4 years", "1-3 years"); 0 when the posting gives no range. */
export function yearsCeiling(text:string){let best=0;const re=/\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*years?\b/gi;let m:RegExpExecArray|null;while((m=re.exec(text||''))){const lo=Number(m[1]),hi=Number(m[2]);if(lo>=0&&hi>lo&&hi<=25&&hi>best)best=hi;}return best;}
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
const SANA_AVOID=/\bhardware\b|\b(?:ai|cyber|information|it|network|cloud|application|data)\s+security\b|\bcybersecurity\b|\bsoftware\b|\bsite reliability\b|\bSRE\b|\bsoftware reliability\b|\breliability (?:software|data|platform)\b|\bhardware test|\btest (?:and|&) reliability\b|\bdevops\b|\bcloud\b|\bnetwork reliability\b|\b(?:it|network|security|data|platform) operations\b|\bpower (?:bi|apps?|platform|automate|electronics)\b|\bdeveloper\b|\bsales\b|\bmarketing\b|\baircraft\b|\baviation\b|\bplant[- ]based\b|\banalyst\b/i;   // plan S4: one matching word (power, energy, plant, reliability) is not enough
export function avoidedTitle(candidateId:string,title:string){
 if(candidateId==='sana_ansari')return SANA_AVOID.test(title||'');
 if(candidateId!=='farhan_shaikh')return false;const t=title||'';
 return FARHAN_HARD_AVOID.test(t)||(FARHAN_SOFT_AVOID.test(t)&&!FARHAN_TARGET_WORDS.test(t));
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
const FOREIGN_NAME=/\b(united states|usa|united kingdom|uk|japan|tokyo|stockholm|sweden|philippines|manila|london|germany|berlin|munich|france|paris|spain|madrid|barcelona|netherlands|amsterdam|ireland|dublin|poland|warsaw|canada|toronto|vancouver|australia|sydney|melbourne|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles|dallas|miami|emea|europe|latam|north america|americas|mexico|brazil|singapore|dubai|uae|united arab emirates|afghanistan|albania|algeria|andorra|angola|argentina|armenia|austria|azerbaijan|bahrain|bangladesh|belarus|belgium|bolivia|bosnia|botswana|bulgaria|cambodia|cameroon|chile|china|colombia|costa rica|croatia|cuba|cyprus|czechia|czech republic|denmark|dominican republic|ecuador|egypt|el salvador|estonia|ethiopia|finland|georgia|ghana|greece|guatemala|honduras|hong kong|hungary|iceland|indonesia|iran|iraq|israel|italy|ivory coast|jamaica|jordan|kazakhstan|kenya|korea|kuwait|latvia|lebanon|lithuania|luxembourg|malaysia|malta|mauritius|moldova|morocco|nepal|new zealand|nigeria|norway|oman|pakistan|panama|paraguay|peru|portugal|puerto rico|qatar|romania|russia|rwanda|saudi arabia|senegal|serbia|slovakia|slovenia|south africa|sri lanka|switzerland|taiwan|tanzania|thailand|tunisia|turkey|turkiye|uganda|ukraine|uruguay|uzbekistan|venezuela|vietnam|zambia|zimbabwe|athens|lisbon|porto|prague|budapest|bucharest|vienna|zurich|geneva|brussels|copenhagen|oslo|helsinki|cairo|lagos|nairobi|cape town|johannesburg|tel aviv|istanbul|riyadh|doha|bogota|buenos aires|santiago|lima|sao paulo|mexico city|kyiv|sofia|belgrade|zagreb|tallinn|riga|vilnius|krakow|abu dhabi|shanghai|beijing|seoul|taipei|bangkok|jakarta|kuala lumpur|hanoi|ho chi minh|auckland|wellington|brisbane|perth|calgary|ottawa|montreal|cologne|hamburg|frankfurt|milan|rome|lyon|rotterdam|gothenburg|malmo|edinburgh|glasgow|manchester|birmingham|cardiff|belfast|bristol)\b/i;   // every country except India, and the main hiring cities: a posting whose only stated place is one of them is for that place
const FOREIGN_US_DOTTED=/(?:^|[^A-Za-z0-9])u\.s\.(?![A-Za-z0-9])/i;
const FOREIGN_US_BARE=/(?:^|[^A-Za-z0-9.])(?:US|EU|GB)(?![A-Za-z0-9.])/;          // 'Remote - US', 'US Remote' (upper case only, so the word "us" is not matched)
const FOREIGN_STATE=/,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?![A-Za-z])/;   // US state codes (OR and IN are omitted: ambiguous with the word "or" and India's code; TN stays, with Tamil Nadu places in INDIA_PLACE so 'Coimbatore, TN' is not foreign)
const EXCLUSION_PLACE='(?:US|U\\.S\\.|USA|United States|UK|United Kingdom|EU|Europe|Canada|APAC|EMEA)(?![A-Za-z0-9])';
const EXCLUSION_PHRASE=new RegExp('\\b(?:excl\\.|(?:excluding|excl|except|outside(?: of)?|not including|other than|anywhere but|but not|not|no|non|ex)\\b)[\\s-]*(?:in\\s+)?(?:the\\s+)?'+EXCLUSION_PLACE+'(?:\\s*(?:,\\s*)?(?:,|and|or|&|/)\\s*(?:the\\s+)?'+EXCLUSION_PLACE+')*','gi');   // also consumes lists: \'excluding US and Canada\', \'non-US\', \'(excl. US)\'
/** True when the only stated location is outside India. A location that also names an Indian place is never foreign. */
export function foreignLocation(location:string){
 const l=(location||'').replace(EXCLUSION_PHRASE,' ');if(!l.trim()||indianPlace(l))return false;   // 'Remote, excluding the US' is not a US location
 return FOREIGN_NAME.test(l)||FOREIGN_US_DOTTED.test(l)||FOREIGN_US_BARE.test(l)||FOREIGN_STATE.test(l);
}
/** The Worker's remote test, expressed on what is stored: workplace_type REMOTE* (the posting's own remote flag) or remote wording in its location. */
export function remoteFromStored(workplaceType:string|null|undefined,location:string|null|undefined){
 return /^REMOTE/i.test(workplaceType||'')||/\b(remote|work from home|telecommut)/i.test(location||'');
}
/** Skill-based preliminary score, exactly as evaluate() computes it for a role-matched posting. */
export function roleScore(skills:number,eligible:boolean){return Math.min(90,40+skills*8+(eligible?10:0));}
/** The Worker's own test for an Indian location in evaluate(): an Indian place (plan S1: states, cities and plant towns) or the country code 'IN' at the end. */
export function sanaIndiaCity(location:string|null|undefined){const l=location||'';return indianPlace(l)||/(?:^|, )in$/i.test(l);}
/** True when the location names a place in India (and not only a neighbour's place of the same name). Also decides that a location is NOT foreign. */
const INDIA_NAMESAKE=/\b(?:punjab|hyderabad|kochi|surat|kashmir)\b/gi;   // also places in Pakistan, Japan and Thailand
export function indianPlace(location:string|null|undefined){const l=location||'';if(!INDIA_PLACE.test(l))return false;if(/\b(?:india|bharat)\b/i.test(l)||!FOREIGN_NAME.test(l))return true;return INDIA_PLACE.test(l.replace(INDIA_NAMESAKE,' '));}
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
const ELECTRICAL_TITLE = /\b(?:electrical|elektro\w*)\b/i, NON_ELECTRICAL_FIT = /mechanical|reliab|maintenance|rotating|turbine|boiler|plant|energy|efficiency|commission|operations?|process/i;
const EU_ONLY = /\b(must (?:be |reside |live )?(?:based |located |resident )?in (?:the )?(?:eu|eea|european union|europe)|(?:eu|eea|european union)[- ]?(?:only|based only|residents? only|work (?:permit|authori[sz]ation) required)|right to work in the (?:eu|uk|eea|netherlands|germany) (?:is )?required|(?:eu|eea) citizens? only)\b/i;
const TZ_RESTRICTED = /\b(?:(?:us|u\.s\.|north american?|eastern|pacific|central|est|pst|cst|cet|uk|european?) (?:time ?zones?|business hours|working hours|hours)|overlap with (?:us|u\.s\.|pacific|eastern|north american?|cet|european?) (?:time|hours|time ?zones?)|work(?:ing)? (?:us|u\.s\.|pst|est) hours|(?:between|within|at least) \d+ ?(?:hours?|hrs?) (?:of )?overlap)\b/i;
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
const GULF_PLACE=/\b(uae|united arab emirates|dubai|abu dhabi|sharjah|saudi|ksa|riyadh|jeddah|dammam|jubail|al[- ]jubail|yanbu|khobar|al[- ]khobar|ras tanura|qatar|doha|ras laffan|oman|muscat|sohar|kuwait|bahrain|manama|ruwais|mesaieed|duqm|salalah)\b|,\s*(?:AE|SA|QA|OM|KW|BH)\s*$/i;   // plan S9: plant towns and country codes ('Ruwais, AE')
// From India, an on-site role abroad (outside the Gulf) with no stated visa route is not a realistic application: it stays in To review,
// ranked below every realistic role, and can never be shortlisted (owner review 2026-11-12: US maintenance jobs offering only
// "relocation assistance" were reaching Ready). Was a fixed 15-point deduction.
/** A place in the Gulf states (used by the screen's visa-route rule and, later, the shortlist's place bands). */
export function gulfPlace(location:string|null|undefined){return GULF_PLACE.test(location||'');}
export const VISA_UNLIKELY_CAP = 45;
// Plan S9: a Gulf posting that gives preference to nationals (Saudization, Emiratization, Omanization) is capped like an unworkable route.
export const NATIONALS_PREFERENCE_CAP = 45;
const NATIONALS_PREFERENCE=/\bpreference (?:will be given |is given |shall be given )?to (?:\w+ )?nationals\b|\bsaudi[sz]ation\b|\bemirati[sz]ation\b|\bomani[sz]ation\b|\bqatari[sz]ation\b|\bkuwaiti[sz]ation\b|\bbahraini[sz]ation\b/i;
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
export function targetFit(title:string,targets:unknown):'exact'|'word'|null{
 const t=' '+words(title)+' ';let partial=false;
 for(const raw of list(targets)){const g=words(String(raw));if(!g)continue;
  if(t.includes(' '+g+' '))return 'exact';
  for(const w of g.split(' '))if(w.length>2&&!GENERIC_TITLE_WORDS.has(w)&&t.includes(' '+w+' '))partial=true;}
 return partial?'word':null;
}
const SENIOR_TITLE=/\b(senior|sr|lead|principal|staff|head|manager|director)\b/i;
const EXEC_TITLE=/\b(?:vp|svp|evp|vice[- ]president|chief(?! of staff)|plant head|general manager|head of)\b/i;   // plan S6 ('Chief of Staff' is a builder role, not an executive one)
export function evaluate(candidate:any,p:Posting,ctx:EvalContext={}) {
 const text=`${p.title} ${p.location} ${p.description}`, lower=text.toLowerCase();
 const negated=(pattern:RegExp)=>{const g=new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(lower))){const before=lower.slice(Math.max(0,m.index-55),m.index),after=lower.slice(m.index+m[0].length,m.index+m[0].length+45);if(/\b(no|not|without|unavailable|unable|never|cannot|can't|won't|isn't|aren't|doesn't|don't|no longer)\b[^.!?]*$/.test(before)||/^\s+(?:(?:is |are |will be )?(?:not|no longer|never|unavailable|unsupported)|isn't|aren't|won't be|will not be)\b/.test(after))return true;}return false};   // ANY denial of a sponsorship/relocation phrase wins over a welcoming one
 const india=sanaIndiaCity(p.location);
 const remote=p.remote||/\b(remote|work from home|telecommut)/i.test(p.location);
 const explicitIndiaRemote=india&&(remote||/\b(fully remote|100% remote|remote position|remote role)\b/i.test(p.description))||/\b(remote (?:in|from|within|[-–]) india|india[- ]remote|hiring (?:remote workers|remotely) (?:in|from) india)\b/i.test(text);
 const blocked=/\b(us|usa|u\.s\.|united states|uk|united kingdom|canada|europe|eu|germany|australia)\s+(?:residents?\s+)?only\b|must (?:reside|be based|be located) in (?:the )?(?:us|usa|united states|uk|europe)|not hiring (?:in|from) india|excluding india|except india/i.test(text);
 const security=/\b(?:active |must (?:have|hold) )?(?:secret|top secret) clearance|ts\/sci|\bitar\b|\b(?:us|uk) citizen(?:ship)? (?:only|required)\b/i.test(text);
 const sponsorship=/\b(visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome)\b/i.test(text)&&!negated(/visa sponsorship|sponsorship available|relocation assistance|relocation provided|international applicants welcome/);
 // A visa route proper. "Relocation assistance" alone is usually a move within that country (a US posting), so for Sana it counts as a route
 // only in the Gulf, where her profile lists relocation and employers sponsor the work visa (owner review 2026-11-12, top-100 check).
 const visaRoute=/\b(visa sponsorship|sponsorship available|sponsor (?:your |a |the )?(?:work )?visa|work permit (?:support|sponsorship|provided)|international applicants welcome|employment visa (?:is |will be )?provided)\b/i.test(text)&&!negated(/visa sponsorship|sponsorship available|sponsor (?:your |a |the )?(?:work )?visa|work permit|international applicants welcome|employment visa/);
 const gulf=GULF_PLACE.test(p.location||'');
 // Roles reserved for nationals of a Gulf country ("Electrical Technician (Saudi Nationals)", "UAE nationals only").
 const nationalsOnly=NATIONALS_TITLE.test(p.title||'')||NATIONALS_TEXT.test(p.description||'');
 // The posting itself says it offers no visa route ("unable to provide visa sponsorship", "must be authorized to work in the US without current or future sponsorship").
 const noVisaWords=/\b(?:unable|not able|cannot|can't|will not|won't|do not|does not|don't|doesn't|not)\b[^.!?]{0,40}\b(?:provide|offer|sponsor|support)\b[^.!?]{0,30}\b(?:visa|work (?:permit|authori[sz]ation)|sponsorship)|\bwithout (?:the )?(?:need for |requiring )?(?:current or future |future or current )?(?:visa )?sponsorship|\bno (?:visa )?sponsorship (?:is |will be )?(?:available|offered|provided)/i.test(text);
 // Application-form style answers: 'Visa Sponsorship Available: No', 'Relocation eligible : No' (Black & Veatch, owner review 2026-11-12).
 const noVisaRoute=noVisaWords||/\b(?:visa\s+)?sponsorship(?:\s+(?:available|offered|provided))?\s*[:\-–]\s*no\b/i.test(text);
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
 // office days rules a remote-only candidate out. A denied mention ("this is not a hybrid role") does not count; "hybrid cloud" is not a work pattern.
 const officeDays=(()=>{const re=/\bhybrid(?:[- ]remote)?\s+(?:role|position|work(?:ing)?|model|schedule|arrangement|set-?up|opportunity|job|policy)\b|\bwork(?:ing)?\s+(?:in\s+a\s+)?hybrid\b|\(hybrid\)|\bis\s+hybrid\b|\b\d\s*(?:-\s*\d\s*)?days?\s+(?:a|per)?\s*(?:week\s+)?(?:in|at|from)\s+(?:the|our)\s+(?:\w+\s+)?office|\bon-?site\s+\d\s*(?:-\s*\d\s*)?days\b/gi;const d=String(p.description||'').toLowerCase();let m:RegExpExecArray|null;while((m=re.exec(d))){const before=d.slice(Math.max(0,m.index-40),m.index);if(!/\b(?:no|not|never|isn't|without)\b[^.!?]*$/.test(before))return true;}return false;})();
 if(security){eligibility='INELIGIBLE';reason='Explicit citizenship, security clearance or licensing restriction requires exclusion.';}
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
  const remoteSignal=remote||explicitIndiaRemote||globalRemote||/\b(fully remote|100% remote|remote[- ]first|remote position|remote role|work from anywhere)\b/i.test(p.description||'');
  if(blocked){eligibility='INELIGIBLE';reason='Posting explicitly restricts work location outside India.';}
  else if(FARHAN_SKIP_EMPLOYER.test(p.company||'')){eligibility='INELIGIBLE';reason='Employer the candidate asked to skip.';}
  else if(!remoteSignal||/\b(hybrid|on[- ]?site|in[- ]office)\b/i.test(p.location||'')){eligibility='INELIGIBLE';reason='Not a remote role (candidate rule: remote only).';}
  else if(officeDays){eligibility='INELIGIBLE';reason='Hybrid or set office days (candidate rule: remote only).';}
  else if(!explicitIndiaRemote&&!globalRemote&&usOnlyLocation(p.location)){eligibility='INELIGIBLE';reason='Remote within the United States only.';}
  else if(!explicitIndiaRemote&&!globalRemote&&locationClass(p.description||'',p.location||'')==='eu_only'){eligibility='INELIGIBLE';reason='Must be based in the EU or EEA (the posting says so).';}
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
 const role=prof?!!phraseRegex(prof.role_keywords)?.test(p.title||''):candidate.id==='farhan_shaikh'?FARHAN_ROLE.test(p.title||''):SANA_ROLE.test(p.title||'');
 const skills=list(candidate.primary_skills).filter(s=>skillFound(s,lower));
 let score=role?Math.min(90,40+skills.length*8+(eligibility==='ELIGIBLE'?10:0)):Math.min(35,skills.length*5);
 // Fit to experience (owner goal 2026-11-07: put first the roles where the candidate is an easy yes). A posting asking for more than
 // two years beyond the candidate's own experience loses points; one whose stated requirement the candidate meets gains a little.
 const have=Number(candidate.total_years_experience)||0, need=yearsRequired(p.description||'');
 // Sana is an engineer with 9+ years: a technician post is below her level (owner review 2026-11-12).
 const tooJunior=role&&(underLevel(p.title||'',p.description||'',have)||(candidate.id==='sana_ansari'&&!prof&&have>=5&&/\btechnicians?\b/i.test(p.title||'')));
 const overReach=role&&have>0&&need>have+2, meets=role&&!tooJunior&&have>0&&need>0&&need<=have;
 if(overReach)score=Math.max(0,score-EXPERIENCE_OVER_PENALTY);else if(meets)score=Math.min(95,score+EXPERIENCE_MATCH_BONUS);
 const fit=role&&!prof?targetFit(p.title||'',candidate.target_roles):null;
 if(fit)score=Math.min(95,score+(fit==='exact'?TARGET_EXACT_BONUS:TARGET_WORD_BONUS));
 const atLevel=role&&!tooJunior&&have>=7&&SENIOR_TITLE.test(p.title||'');
 if(atLevel)score=Math.min(95,score+SENIORITY_BONUS);
 const platform=role?platformGap(p.title||'',candidate.primary_skills):null;
 // Pay floor (owner rule 2026-11-07): only a published range is compared. Below the candidate's floor loses points; reaching the
 // preferred level gains a little. A candidate with no floor on record is never compared.
 const floor=Number(candidate.cash_floor_inr_monthly)||(candidate.id==='farhan_shaikh'?120000:0), preferred=candidate.id==='farhan_shaikh'?2500000/12:0;
 const pay=floor>0?monthlyInr(p.salary):null, belowFloor=!!pay&&pay.hi<floor, preferredPay=!!pay&&!belowFloor&&preferred>0&&pay.hi>=preferred;
 if(belowFloor)score=Math.max(0,score-PAY_BELOW_FLOOR_PENALTY);else if(preferredPay)score=Math.min(95,score+PAY_PREFERRED_BONUS);
 // Employers recorded publicly as hiring worldwide (Farhan: remote from India). Not proof of eligibility, so eligibility is unchanged.
 const key=companyKey(p.company), globalHirer=candidate.id==='farhan_shaikh'&&eligibility!=='INELIGIBLE'&&!!key&&!!ctx.globalHirers?.has(key);
 if(globalHirer&&role)score=Math.min(95,score+GLOBAL_HIRER_BONUS);
 const rejectedOn=key&&ctx.rejected?.has(key)?(ctx.rejected.get(key)||'date not recorded'):null;
 // Funded early-stage founders (Farhan's builder goal): a YC company that is hiring gains a little, for a role-match only.
 const ycBatch=candidate.id==='farhan_shaikh'&&role&&eligibility!=='INELIGIBLE'&&key&&ctx.yc?.has(key)?(ctx.yc.get(key)||'batch not listed'):null;
 if(ycBatch)score=Math.min(95,score+YC_BONUS);
 // Time-zone restriction (remote, but on another region's hours): a cost, not a bar. Agency postings and language requirements likewise.
 const locClass=locationClass(p.description||'',p.location||'');
 const tzRestricted=candidate.id==='farhan_shaikh'&&eligibility!=='INELIGIBLE'&&locClass==='timezone';
 if(tzRestricted)score=Math.max(0,score-TIMEZONE_PENALTY);
 const agency=agencyPosting(p.company||'',p.description||'');
 if(agency&&role)score=Math.max(0,score-AGENCY_PENALTY);
 const lang=languageRequired(p.title||'',p.description||'');
 if(lang&&role)score=Math.max(0,score-LANGUAGE_PENALTY);
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
 const visaUnlikely=candidate.id==='sana_ansari'&&!prof&&!(visaRoute&&!noVisaRoute)&&!ukSponsor&&foreignLocation(p.location)&&!gulf&&(!remote||(!explicitIndiaRemote&&!globalRemote));
 if(visaUnlikely)score=Math.min(score,VISA_UNLIKELY_CAP);
 const nationalsPreferred=(!prof||String(prof.home_country||'').toLowerCase()==='india')&&NATIONALS_PREFERENCE.test(text);
 if(nationalsPreferred)score=Math.min(score,NATIONALS_PREFERENCE_CAP);
 const electricalOnly=candidate.id==='sana_ansari'&&!prof&&role&&ELECTRICAL_TITLE.test(p.title||'')&&!NON_ELECTRICAL_FIT.test(p.title||'');
 if(electricalOnly)score=Math.max(0,score-ELECTRICAL_ONLY_PENALTY);
 if(avoided)score=Math.min(score,AVOID_TITLE_CAP);
 if(platform)score=Math.min(score,PLATFORM_GAP_CAP);
 if(tooJunior)score=Math.min(score,UNDER_LEVEL_CAP);
 // Plan S6: too senior is capped just below the person's threshold, so it never reaches Ready: the posting asks for more than their years + 2, or the
 // title is an executive one (VP, chief, plant head, general manager, head of) that none of their target roles names.
 const threshold=Number(candidate.qualification_threshold)||(candidate.id==='farhan_shaikh'?70:60);
 const execTitle=EXEC_TITLE.exec(p.title||''), execTarget=!!execTitle&&list(candidate.target_roles).some((t)=>new RegExp(`\\b${escRe(execTitle[0])}\\b`,'i').test(String(t)));
 const tooSenior=role&&!prof&&(overReach||(!!execTitle&&!execTarget));
 if(tooSenior)score=Math.min(score,threshold-1);
 if(foreignOnly)score=Math.max(0,score-FOREIGN_LOCATION_PENALTY);
 // The screen itself never returns READY. The daily run's shortlist step (scripts/dataset_apply.mjs) promotes the best screened rows by one stated rule.
 return {status:eligibility==='INELIGIBLE'?'INELIGIBLE':role?'NEEDS_REVIEW':'HOLD',lane:role?'STRONGEST_FIT':'UNASSIGNED',eligibility,reason,score,skills,target_fit:fit,qualification_reason:(role?'Cloud discovery match. Full requirements, pay and experience require review before READY.':'Outside candidate target role family; retained for review.')+(fit==='exact'?' Title is one of the candidate\'s target roles.':fit==='word'?' Title is close to one of the candidate\'s target roles.':'')+(atLevel?' Pitched at the candidate\'s level.':'')+(avoided?' Title is on the candidate\'s avoid list (score capped).':'')+(tooJunior?' Pitched well below the candidate\'s experience (score capped).':'')+(platform?` Built around ${platform}, which the profile does not list (score capped).`:'')+(foreignOnly?' Only stated location is outside India (score reduced).':'')+(visaUnlikely?' On-site abroad with no visa route from India stated (score capped).':'')+(nationalsPreferred?' Gives preference to the country\'s nationals (score capped).':'')+(overReach?` Asks for ${need}+ years (score reduced).`:meets?` Meets the stated ${need}+ years.`:'')
  +(tooSenior?' Pitched above the candidate\'s level (score capped below the shortlist).':'')
  +(belowFloor?` Published pay (up to ${lakhMonth(pay!.hi)}) is below the ${lakhMonth(floor)} floor (score reduced).`:preferredPay?` Published pay reaches the preferred level (up to ${lakhMonth(pay!.hi)}).`:'')
  +(globalHirer?' Employer is listed publicly as hiring worldwide; confirm India is included.':'')
  +(rejectedOn?` Rejected by this employer before (${rejectedOn}).`:'')
  +(ycBatch?` Y Combinator company (${ycBatch}), currently hiring.`:'')
  +(tzRestricted?' Remote, but on another region\'s working hours (score reduced).':'')
  +(agency?' Posted by a staffing agency or recruiter (score reduced).':'')
  +(lang?` Requires ${lang} (score reduced).`:'')
  +(ukSponsor?' Employer holds a UK Skilled Worker sponsor licence.':'')
  +(electricalOnly?' Electrical-only title, ranked below mechanical, reliability and energy roles (score reduced).':'')
  +(reposted?' Reposted: an earlier listing of this role closed.':'')
  +(locClass==='worldwide'?' Posting says: work from anywhere.':locClass==='india_ok'?' Posting names India as a remote location.':'')
  +(role&&skills.length?` Easy-yes check: ${skills.length} of ${list(candidate.primary_skills).length} CV skills named (${skills.slice(0,4).join(', ')}${skills.length>4?', …':''})${meets?`, meets the ${need}+ years asked`:''}.`:'')};
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
    JSON.stringify({ rule_version: RULE_VERSION, preliminary: true, ranking_v2: true, [RULES_MARKER]: true, target_exact: result.target_fit === 'exact', skills_v1: list(r.primary_skills).length > 0, assessed_from: 'github_collector', matched_skills: result.skills, missing_skills: [], note: 'Conservative screen of a collector-imported posting; full qualification review pending.' }),
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

