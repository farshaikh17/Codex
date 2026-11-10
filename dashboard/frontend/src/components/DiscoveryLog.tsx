import React, { useEffect, useState } from 'react';
import { DiscoveryDay, fetchDiscoveryDaily } from '../api';

/** "What arrived": one row per UTC day of what the daily and two-hourly discovery runs recorded (counts only). */
export const DiscoveryLog: React.FC = () => {
  const [days, setDays] = useState<DiscoveryDay[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchDiscoveryDaily().then((d) => { if (live) setDays(d.days || []); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const topSources = (d: DiscoveryDay) =>
    Object.entries(d.sources || {}).filter(([, s]) => s.kept > 0).sort((a, b) => b[1].kept - a[1].kept).slice(0, 3).map(([n, s]) => `${n} ${s.kept}`).join(', ');

  return (
    <section aria-labelledby="discovery-log-title" className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <h2 id="discovery-log-title" className="text-sm font-bold text-slate-800">What arrived each day</h2>
      <p className="text-xs text-slate-600 mt-0.5">New jobs written, stored jobs re-scored, and dead postings closed by the automatic runs. Counts only.</p>
      {failed && <p className="text-xs text-slate-700 mt-3">The run log could not be loaded right now.</p>}
      {!failed && days === null && <p className="text-xs text-slate-700 mt-3">Loading…</p>}
      {days !== null && days.length === 0 && <p className="text-xs text-slate-700 mt-3">No runs recorded yet. The next automatic run adds the first row.</p>}
      {days !== null && days.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs text-left">
            <caption className="sr-only">Automatic discovery runs per UTC day</caption>
            <thead>
              <tr className="text-slate-700 border-b border-slate-200">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Day (UTC)</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Runs</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">New jobs</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Re-scored</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Closed</th>
                <th scope="col" className="py-1.5 font-semibold">Most from</th>
              </tr>
            </thead>
            <tbody>
              {days.slice(0, 7).map((d) => (
                <tr key={d.day} className="border-b border-slate-100 last:border-0">
                  <th scope="row" className="py-1.5 pr-3 font-mono font-medium text-slate-800">{d.day}</th>
                  <td className="py-1.5 pr-3 font-mono">{d.runs}</td>
                  <td className="py-1.5 pr-3 font-mono">{d.new_jobs.toLocaleString('en')}</td>
                  <td className="py-1.5 pr-3 font-mono">{d.rescored.toLocaleString('en')}</td>
                  <td className="py-1.5 pr-3 font-mono">{d.closed.toLocaleString('en')}</td>
                  <td className="py-1.5 text-slate-700">{topSources(d) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
