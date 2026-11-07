import React, { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import { fetchSiteSettings, saveSiteSettings } from '../api';

// Operator settings for the public site: brand, contact address, announcement and the three plans. An empty price shows
// "Ask for a quote" on the pricing page; nothing is invented.
const GROUPS: { title: string; keys: [string, string, 'text' | 'area'][] }[] = [
  { title: 'Brand', keys: [['brand_name', 'Brand name', 'text'], ['brand_sub', 'Small line under the name', 'text'], ['tagline', 'Tagline', 'text'], ['contact_email', 'Contact email (shown on the site)', 'text'], ['announcement', 'Announcement bar', 'text']] },
  ...[1, 2, 3].map((i) => ({ title: `Plan ${i}`, keys: [[`plan${i}_name`, 'Name', 'text'], [`plan${i}_price`, 'Price (e.g. ₹2,999 or $49; empty = "Ask for a quote")', 'text'], [`plan${i}_period`, 'Period', 'text'], [`plan${i}_blurb`, 'One line', 'text'], [`plan${i}_features`, 'Features (one per line)', 'area']] as [string, string, 'text' | 'area'][] })),
];

export const SiteSettingsPanel: React.FC = () => {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchSiteSettings().then((r) => setValues(r.settings)).catch((e) => setError(e.message)); }, []);
  if (!values) return <div className="text-sm text-slate-500">{error || 'Loading site settings…'}</div>;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null); setSaved(null);
    try { setValues(await saveSiteSettings(values)); setSaved('Saved. The public site shows the change within about a minute.'); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-5" data-testid="site-settings">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2"><Globe className="w-5 h-5 text-coral-500" /> Public site</h2>
        <a href="/" target="_blank" rel="noreferrer" className="text-sm font-semibold text-coral-600 hover:underline">Open the site ↗</a>
      </div>
      {!values.contact_email && <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm">Set a contact email before you share the site: the privacy notice tells people to write to it to see or delete their data.</div>}
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="border-t border-slate-100 pt-4">
          <legend className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{g.title}</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {g.keys.map(([k, label, kind]) => (
              <label key={k} className={`block text-xs ${kind === 'area' ? 'md:col-span-2' : ''}`}>
                <span className="text-slate-600 font-semibold">{label}</span>
                {kind === 'area'
                  ? <textarea name={k} value={values[k] || ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} rows={5} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
                  : <input name={k} value={values[k] || ''} onChange={(e) => setValues({ ...values, [k]: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {error && <div role="alert" className="p-3 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 text-sm">{error}</div>}
      {saved && <div role="status" className="p-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm">{saved}</div>}
      <button type="submit" disabled={busy} className="px-4 py-2 rounded-full bg-coral-500 hover:bg-coral-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save site settings'}</button>
    </form>
  );
};
