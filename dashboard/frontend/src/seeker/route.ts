// Plan U11: the address says where the person is, so Back, reload and a bookmark work.
//   /app#sana/today            Sana's Today screen
//   /app#sana/applications     Sana's applications
//   /app#sana/all              everything else (the full list)
//   /app#sana/hidden           jobs she marked Not for me
//   /app#sana/job/<id>         one job's panel, over the screen she came from (Back closes it)
//   /app                       the remembered person's Today, or the two names on a first visit
import { Person, PEOPLE } from './format';

export type View = 'home' | 'today' | 'applications' | 'all' | 'hidden';
export interface Route { person: Person | null; view: View; jobId: string | null }
const VIEWS: View[] = ['today', 'applications', 'all', 'hidden'];

export function parseRoute(hash: string, underneath: View = 'today'): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const person = PEOPLE.includes(parts[0] as Person) ? (parts[0] as Person) : null;
  if (!person) return { person: null, view: 'home', jobId: null };
  if (parts[1] === 'job' && parts[2]) {
    let id = parts.slice(2).join('/');
    try { id = decodeURIComponent(id); } catch { /* keep as written */ }
    return { person, view: underneath === 'home' ? 'today' : underneath, jobId: id };
  }
  return { person, view: VIEWS.includes(parts[1] as View) ? (parts[1] as View) : 'today', jobId: null };
}

export function routeHash(r: Route): string {
  if (!r.person) return '';
  if (r.jobId) return `#${r.person}/job/${encodeURIComponent(r.jobId)}`;
  return `#${r.person}/${r.view === 'home' ? 'today' : r.view}`;
}

const PERSON_KEY = 'seeker:person';
/** The person last chosen on this device (plan U5: the switch is remembered on the device). */
export function rememberedPerson(): Person | null {
  try { const p = window.localStorage.getItem(PERSON_KEY); return PEOPLE.includes(p as Person) ? (p as Person) : null; } catch { return null; }
}
export function rememberPerson(p: Person): void { try { window.localStorage.setItem(PERSON_KEY, p); } catch { /* private window */ } }

/** "New since your last visit" (plan U5) counts per device, not the server's "new today": the time of the previous visit is kept in this browser.
 *  The baseline stays fixed for the whole visit (this tab), so a reload does not empty the list; the next visit compares with this one. */
export function lastVisitBaseline(p: Person, now: number = Date.now()): number {
  const key = `seeker:last-visit:${p}`, tabKey = `seeker:baseline:${p}`;
  try {
    const held = window.sessionStorage.getItem(tabKey);
    if (held && Number.isFinite(Number(held))) return Number(held);
    const prev = Number(window.localStorage.getItem(key));
    const base = Number.isFinite(prev) && prev > 0 ? prev : now - 86400000;   // a first visit shows what arrived in the last day
    window.sessionStorage.setItem(tabKey, String(base));
    window.localStorage.setItem(key, String(now));
    return base;
  } catch { return now - 86400000; }
}
