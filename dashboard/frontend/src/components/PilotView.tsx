import { useEffect, useState } from 'react';
import { fetchPilot } from '../api';

export function PilotView() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { fetchPilot().then(setData).catch(() => setError('Could not read the local pilot snapshot.')); }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading local snapshot…</p>;
  if (!data.available) return <p>No live pilot has been captured. Discovery contains practice jobs only.</p>;
  return <div className="space-y-4">
    <div className="bg-white border rounded-xl p-5">
      <h2 className="text-lg font-bold">Live Pilot — Lever</h2>
      <p className="text-sm text-slate-600">{data.count} public postings captured {new Date(data.fetched_at).toLocaleString()}. One partial board sample, not a complete search.</p>
      <p className="text-xs text-slate-500 mt-2">Read-only review. Fixed pay, candidate fit, legal onboarding and prior application history remain unverified. No application is submitted here.</p>
      <details className="mt-3 text-xs break-all"><summary>Source evidence</summary><p>{data.request_url}</p><p>SHA-256: {data.raw_sha256}</p></details>
    </div>
    {data.jobs.map((job: any) => <article key={job.id} className="bg-white border rounded-xl p-5 space-y-2">
      <h3 className="font-semibold">{job.title}</h3>
      <p className="text-sm">{job.company} · {job.location_restrictions}</p>
      <p className="text-xs font-semibold">India remote scope: {job.eligibility.classification} · Pay: UNKNOWN · History: NOT CHECKED</p>
      <p className="text-xs text-slate-600">{job.eligibility.reasoning}</p>
      {job.eligibility.evidence_quote && <blockquote className="text-xs border-l-2 pl-3">{job.eligibility.evidence_quote}</blockquote>}
      <details><summary className="text-sm cursor-pointer">Description and published pay</summary>
        <p className="text-xs my-2">{job.salary_raw_text || (job.salary_range ? JSON.stringify(job.salary_range) : 'Pay not disclosed')}</p>
        <p className="text-xs whitespace-pre-line text-slate-700">{job.description}</p>
      </details>
      <a className="text-sm text-emerald-700 underline" href={job.source_url} target="_blank" rel="noopener noreferrer">View employer posting</a>
    </article>)}
    {data.count === 0 && <p>This board returned no public postings in the approved pilot request.</p>}
  </div>;
}
