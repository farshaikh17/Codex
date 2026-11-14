// Public, keyless sources. Preserve their attribution and polling requirements.
// Remotive: not read since 14 Nov 2026 (robots.txt disallows /api/* and /*search=); migration 0024 switches its source rows off.
export const isBroad = (kind:string) => ['jobicy','remotive','hnjobs'].includes(kind);
export function broadURL(s:any,detail?:string) {
 if(s.kind==='jobicy')return `https://jobicy.com/api/jobs?count=10${s.cursor_token?'&cursor='+encodeURIComponent(s.cursor_token):''}`;
 if(s.kind==='remotive')return `https://remotive.com/api/remote-jobs?limit=10&search=${encodeURIComponent(s.slug)}`;
 if(s.kind==='hnjobs')return `https://hacker-news.firebaseio.com/v0/${detail?'item/'+encodeURIComponent(detail):'jobstories'}.json`;
 throw Error('Unknown broad source');
}
export function broadPage(s:any,raw:any) {
 if(s.kind==='hnjobs'){
  if(!Array.isArray(raw)||raw.some(x=>typeof x!=='number'))throw Error('Malformed startup job index');
  return {items:raw.slice(s.cursor,s.cursor+10).map(id=>({id})),next:s.cursor+10<raw.length?s.cursor+10:0,complete:s.cursor+10>=raw.length,token:null};
 }
 if(!Array.isArray(raw?.jobs)||raw.success===false)throw Error('Malformed or unsuccessful public job-board response');
 if(s.kind==='jobicy'){
  if(raw.hasMore===true&&typeof raw.nextCursor!=='string')throw Error('Missing job-board continuation token');
  return {items:raw.jobs.slice(0,10),next:0,complete:!raw.nextCursor,token:raw.nextCursor||null};
 }
 return {items:raw.jobs.slice(0,10),next:0,complete:true,token:null};
}
export function normalizeBroad(s:any,x:any,observedAt:string) {
 if(!x?.id)throw Error('Public listing missing stable ID');
 let result:any;
 if(s.kind==='jobicy')result={id:String(x.id),title:x.jobTitle,company:x.companyName,url:x.url,location:x.jobGeo||'Unknown',description:x.jobDescription||x.jobExcerpt||'',remote:true,salary:{min:x.salaryMin,max:x.salaryMax,currency:x.salaryCurrency,period:x.salaryPeriod},publishedAt:x.pubDate};
 else if(s.kind==='remotive')result={id:String(x.id),title:x.title,company:x.company_name,url:x.url,location:x.candidate_required_location||'Unknown',description:x.description||'',remote:true,salary:{text:x.salary||''},publishedAt:x.publication_date};
 else {
  if(x.type!=='job'||x.deleted||x.dead||!x.title)throw Error('Startup announcement removed or not a job');
  result={id:String(x.id),title:x.title,company:x.title.replace(/\s*\(YC[^)]*\)/i,'').split(/\s+(?:is hiring|hiring|seeks|looking for)\b/i)[0].slice(0,160),url:`https://news.ycombinator.com/item?id=${x.id}`,location:'Unknown; verify employer location',description:x.text||`${x.title}. The startup feed supplies an announcement link, not full job requirements. Follow the source to verify: ${safeHTTPS(x.url)?x.url:'https://news.ycombinator.com/item?id='+x.id}`,remote:false,publishedAt:x.time?new Date(x.time*1000).toISOString():null};
 }
 const expected=s.kind==='jobicy'?'jobicy.com':s.kind==='remotive'?'remotive.com':'news.ycombinator.com';
 if(!result.title||!result.company||!safeHTTPS(result.url)||new URL(result.url).hostname!==expected)throw Error('Missing employer/title or invalid attributed source URL');
 if(result.description.length>100000)throw Error('Public listing description exceeds evaluation budget');
 return {...result,board:true,observedAt,sourceLabel:s.name};
}
function safeHTTPS(value:any){try{return new URL(value).protocol==='https:'}catch{return false}}
