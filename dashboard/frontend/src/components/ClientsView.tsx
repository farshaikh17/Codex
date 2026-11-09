import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Link2, Download, RefreshCw, Eye, EyeOff, Trash2 } from 'lucide-react';
import { SiteSettingsPanel } from './SiteSettingsPanel';
import {
  ClientRequest, fetchClientRequests, updateClientRequest, deleteClientRequest,
  ClientRecord, ShareLink, fetchClients, createClient, updateClient, backfillClient, fetchShareLinks, createShareLink, revokeShareLink, downloadExport,
} from '../api';

// Operator page: onboard a client, screen the existing jobs for them, share a read-only link, export their list.
// A new client is private until made public; the built-in two keep their own rules and visibility.
const split = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = { full_name: '', display_title: '', summary_line: '', current_location: '', primary_timezone: 'Asia/Kolkata', total_years_experience: '',
  qualification_threshold: '65', primary_skills: '', role_keywords: '', avoid_keywords: '', location_mode: 'REMOTE_FROM_HOME', home_country: 'India', visibility: 'private' };

export const ClientsView: React.FC<{ onOpenClient: (id: string) => void; onClientsChanged: () => void }> = ({ onOpenClient, onClientsChanged }) => {
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, ShareLink[]>>({});
  const [newLink, setNewLink] = useState<{ id: string; url: string } | null>(null);
  const [requests, setRequests] = useState<ClientRequest[] | null>(null);
  const [requestCounts, setRequestCounts] = useState<Record<string, number>>({});
  const [fromRequest, setFromRequest] = useState<ClientRequest | null>(null);
  const [tab, setTab] = useState<'clients' | 'requests' | 'site'>('clients');
  const loadRequests = useCallback(async () => {
    try { const r = await fetchClientRequests('OPEN'); setRequests(r.requests); setRequestCounts(r.counts); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { loadRequests(); }, [loadRequests]);
  const useRequest = (r: ClientRequest) => {
    setFromRequest(r);
    setForm({ ...EMPTY, full_name: r.full_name, current_location: r.current_location || '', role_keywords: r.target_roles || '',
      location_mode: r.work_preference === 'HOME_OR_RELOCATE' ? 'HOME_OR_RELOCATE' : 'REMOTE_FROM_HOME',
      total_years_experience: r.years_experience === '10+' ? '10' : (r.years_experience || '').split('-')[0] || '' });
    setTab('clients'); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const load = useCallback(async () => {
    try { setClients(await fetchClients()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null); setNotice(null);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const screenAll = async (id: string) => {
    let total = 0, cursor: number | null = null;       // each call continues where the previous one stopped, so it reads about 40 jobs, not the whole catalogue
    for (let i = 0; i < 150; i++) {                      // batches of 40 (CPU limit per request), at most 6,000 jobs per click
      const r = await backfillClient(id, cursor);
      total += r.inserted;
      if (!r.more) break;
      cursor = r.next_cursor ?? null;
    }
    return total;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run('create', async () => {
      const c = await createClient({
        full_name: form.full_name, display_title: form.display_title, summary_line: form.summary_line, current_location: form.current_location,
        primary_timezone: form.primary_timezone, total_years_experience: form.total_years_experience === '' ? null : Number(form.total_years_experience),
        qualification_threshold: Number(form.qualification_threshold), primary_skills: split(form.primary_skills), visibility: form.visibility,
        search_profile: { role_keywords: split(form.role_keywords), avoid_keywords: split(form.avoid_keywords), location_mode: form.location_mode, home_country: form.home_country },
      });
      const n = await screenAll(c.id);
      if (fromRequest) { await updateClientRequest(fromRequest.id, 'CONVERTED', c.id); setFromRequest(null); await loadRequests(); }
      setNotice(`Created ${c.full_name} (${c.id}) and screened ${n} active jobs for them.`);
      setForm({ ...EMPTY });
      await load(); onClientsChanged();
    });
  };
  const showLinks = (id: string) => run('links-' + id, async () => { const l = await fetchShareLinks(id); setLinks((m) => ({ ...m, [id]: l })); });

  const input = (k: keyof typeof EMPTY, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-xs">
      <span className="text-slate-600 font-semibold">{label}</span>
      <input name={k} value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" {...props} />
    </label>
  );

  const tabBtn = (k: typeof tab, label: string) => (
    <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-full text-sm font-semibold ${tab === k ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:border-coral-500'}`}>{label}</button>
  );
  const newCount = requestCounts.NEW || 0;
  return (
    <div className="space-y-6" data-testid="clients-view">
      <div className="flex flex-wrap gap-2">{tabBtn('clients', 'Clients')}{tabBtn('requests', `Applications${newCount ? ` (${newCount} new)` : ''}`)}{tabBtn('site', 'Public site')}</div>
      {tab !== 'clients' && error && <div role="alert" className="p-3 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 text-sm">{error}</div>}
      {tab === 'site' && <SiteSettingsPanel />}
      {tab === 'requests' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm" data-testid="requests-view">
          <div className="p-5 border-b border-slate-100"><h2 className="text-lg font-bold">Applications from the website</h2>
            <p className="text-xs text-slate-500 mt-1">People who applied on the public site. Contact them, then use an application to create their client profile; it is marked converted when the client is created.</p></div>
          {requests === null ? <div className="p-5 text-sm text-slate-400">Loading…</div> : requests.length === 0 ? <div className="p-5 text-sm text-slate-500">No open applications.</div> : (
            <ul className="divide-y divide-slate-100">
              {requests.map((r) => (
                <li key={r.id} className="p-5 flex flex-col md:flex-row md:items-start gap-4" data-request-id={r.id}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap"><b className="text-slate-900">{r.full_name}</b>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.status === 'NEW' ? 'bg-coral-100 text-coral-700' : 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                      <span className="text-xs text-slate-500">{r.created_at} UTC</span></div>
                    <div className="text-sm text-slate-700 mt-1"><a className="text-coral-600 hover:underline" href={`mailto:${r.email}`}>{r.email}</a>{r.phone ? ` · ${r.phone}` : ''} · {r.current_location}</div>
                    <div className="text-sm mt-1"><span className="text-slate-500">Looking for:</span> {r.target_roles}</div>
                    <div className="text-xs text-slate-500 mt-1">{[r.work_preference, r.years_experience && `${r.years_experience} yrs`, r.plan && `plan ${r.plan}`].filter(Boolean).join(' · ')}
                      {r.linkedin_url && /^https:\/\//i.test(r.linkedin_url) && <> · <a className="text-coral-600 hover:underline" href={r.linkedin_url} target="_blank" rel="noreferrer noopener">profile</a></>}</div>
                    {r.message && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{r.message}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs shrink-0">
                    <button onClick={() => useRequest(r)} className="px-3 py-1.5 rounded-full bg-coral-600 text-white font-semibold hover:bg-coral-600">Create client from this</button>
                    {r.status === 'NEW' && <button onClick={() => run('req-' + r.id, async () => { await updateClientRequest(r.id, 'CONTACTED'); await loadRequests(); })} className="px-3 py-1.5 rounded-full border border-slate-300 hover:bg-slate-50">Mark contacted</button>}
                    <button onClick={() => run('req-' + r.id, async () => { await updateClientRequest(r.id, 'DECLINED'); await loadRequests(); })} className="px-3 py-1.5 rounded-full border border-slate-300 hover:bg-slate-50">Decline</button>
                    <button onClick={() => { if (window.confirm(`Delete ${r.full_name}'s application permanently? Use this when someone asks for their data to be removed.`)) run('del-' + r.id, async () => { await deleteClientRequest(r.id); await loadRequests(); }); }} className="px-3 py-1.5 rounded-full border border-rose-300 text-rose-700 hover:bg-rose-50">Delete</button>
                  </div>
                </li>))}
            </ul>)}
        </div>
      )}
      {tab === 'clients' && <>
      {fromRequest && <div role="status" className="p-3 rounded-lg border border-coral-100 bg-coral-50 text-slate-800 text-sm">Creating a client from {fromRequest.full_name}'s application. Check the role keywords (one idea per comma), then create. <button className="underline ml-2" onClick={() => { setFromRequest(null); setForm({ ...EMPTY }); }}>Cancel</button></div>}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-bold flex items-center gap-2"><UserPlus className="w-5 h-5 text-emerald-600" /> Add a client</h2>
        <p className="text-xs text-slate-500 mt-1">Jobs are matched on the posting title against the role keywords (plain words). A new client is private: only you, and anyone you give a share link, can see it. Nothing is marked READY automatically.</p>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          {input('full_name', 'Full name *', { required: true, minLength: 2 })}
          {input('display_title', 'Headline (shown on the dashboard)')}
          {input('summary_line', 'One-line summary')}
          {input('current_location', 'Current location (operator only)')}
          {input('primary_timezone', 'Time zone (IANA)')}
          {input('total_years_experience', 'Years of experience', { type: 'number', min: 0, max: 60 })}
          {input('role_keywords', 'Role keywords * (comma separated)', { required: true, placeholder: 'data analyst, bi analyst' })}
          {input('avoid_keywords', 'Titles to rank down (comma separated)', { placeholder: 'senior, principal' })}
          {input('primary_skills', 'Skills (comma separated)', { placeholder: 'SQL, Power BI' })}
          <label className="block text-xs"><span className="text-slate-600 font-semibold">Location rule</span>
            <select name="location_mode" value={form.location_mode} onChange={(e) => setForm({ ...form, location_mode: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="REMOTE_FROM_HOME">Fully remote from the home country only</option>
              <option value="HOME_OR_RELOCATE">Home country, or postings that offer sponsorship / worldwide remote</option>
            </select></label>
          {input('home_country', 'Home country')}
          {input('qualification_threshold', 'Score threshold (30-95)', { type: 'number', min: 30, max: 95 })}
          <label className="block text-xs"><span className="text-slate-600 font-semibold">Visibility</span>
            <select name="visibility" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="private">Private (operator and share links)</option>
              <option value="public">Public (listed for every visitor)</option>
            </select></label>
          <div className="md:col-span-3">
            <button type="submit" disabled={!!busy} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50">
              {busy === 'create' ? 'Creating and screening jobs…' : 'Create client and screen jobs'}
            </button>
          </div>
        </form>
      </div>

      {notice && <div role="status" className="p-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm">{notice}</div>}
      {error && <div role="alert" className="p-3 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 text-sm">{error}</div>}
      {newLink && (
        <div className="p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm" data-testid="new-share-link">
          <div className="font-semibold">Share link for {newLink.id} — shown once</div>
          <div className="mt-2 flex gap-2 items-center">
            <input readOnly value={newLink.url} className="flex-1 font-mono text-xs border border-amber-300 rounded px-2 py-1 bg-white" onFocus={(e) => e.currentTarget.select()} />
            <button className="px-2 py-1 rounded bg-amber-600 text-white text-xs" onClick={() => navigator.clipboard?.writeText(newLink.url)}>Copy</button>
            <button className="px-2 py-1 rounded border border-amber-400 text-xs" onClick={() => setNewLink(null)}>Done</button>
          </div>
          <div className="text-xs mt-1">Anyone with this link can read this client's dashboard (read-only) until you revoke it.</div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase"><tr>
            <th className="text-left p-3">Client</th><th className="text-left p-3">Matches on</th><th className="text-right p-3">Screened</th>
            <th className="text-right p-3">Ready/Stretch</th><th className="text-left p-3">Visibility</th><th className="text-left p-3">Actions</th></tr></thead>
          <tbody>
            {clients === null && <tr><td colSpan={6} className="p-4 text-slate-400">Loading…</td></tr>}
            {(clients || []).map((c) => (
              <React.Fragment key={c.id}>
                <tr className="border-t border-slate-100 align-top" data-client-id={c.id}>
                  <td className="p-3"><button className="font-semibold text-emerald-700 hover:underline" onClick={() => onOpenClient(c.id)}>{c.full_name}</button>
                    <div className="text-xs text-slate-500">{c.id}{c.builtin ? ' • built-in rules' : ''}</div></td>
                  <td className="p-3 text-xs text-slate-600">{c.search_profile ? c.search_profile.role_keywords.join(', ') : 'built-in'}</td>
                  <td className="p-3 text-right font-mono">{c.jobs_screened}</td>
                  <td className="p-3 text-right font-mono">{c.apply_worthy}</td>
                  <td className="p-3 text-xs">{c.visibility === 'private' ? <span className="inline-flex items-center gap-1 text-slate-700"><EyeOff className="w-3.5 h-3.5" /> private</span> : <span className="inline-flex items-center gap-1 text-emerald-700"><Eye className="w-3.5 h-3.5" /> public</span>}
                    {c.active_share_links > 0 && <div className="text-slate-500">{c.active_share_links} share link{c.active_share_links > 1 ? 's' : ''}</div>}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {!c.builtin && <button disabled={!!busy} onClick={() => run('vis-' + c.id, async () => { await updateClient(c.id, { visibility: c.visibility === 'private' ? 'public' : 'private' }); await load(); onClientsChanged(); })}
                        className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">{c.visibility === 'private' ? 'Make public' : 'Make private'}</button>}
                      <button disabled={!!busy} onClick={() => run('fill-' + c.id, async () => { const n = await screenAll(c.id); setNotice(`Screened ${n} more active jobs for ${c.full_name}.`); await load(); })}
                        className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Screen new jobs</button>
                      <button disabled={!!busy} onClick={() => run('link-' + c.id, async () => { const l = await createShareLink(c.id, 'shared ' + new Date().toISOString().slice(0, 10)); setNewLink({ id: c.id, url: window.location.origin + l.path }); await load(); await showLinks(c.id); })}
                        className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1"><Link2 className="w-3 h-3" /> New share link</button>
                      <button disabled={!!busy} onClick={() => showLinks(c.id)} className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50">Links</button>
                      <button disabled={!!busy} onClick={() => run('csv-' + c.id, () => downloadExport(c.id))} className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1"><Download className="w-3 h-3" /> CSV</button>
                    </div>
                  </td>
                </tr>
                {links[c.id] && (
                  <tr className="bg-slate-50/60"><td colSpan={6} className="px-3 pb-3 text-xs">
                    {links[c.id].length === 0 ? <span className="text-slate-500">No share links.</span> : links[c.id].map((l) => (
                      <div key={l.link_id} className="flex items-center gap-3 py-0.5" data-link-id={l.link_id}>
                        <span className="font-mono">{l.link_id}</span><span>{l.label || ''}</span><span className="text-slate-500">created {l.created_at}</span>
                        {l.revoked_at ? <span className="text-rose-600">revoked {l.revoked_at}</span> :
                          <button className="text-rose-700 inline-flex items-center gap-1 hover:underline" onClick={() => run('rev-' + l.link_id, async () => { await revokeShareLink(c.id, l.link_id); await showLinks(c.id); await load(); })}><Trash2 className="w-3 h-3" /> Revoke</button>}
                      </div>))}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
};
