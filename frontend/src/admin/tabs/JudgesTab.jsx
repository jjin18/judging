import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { adminApi } from '../../lib/api.js';

export default function JudgesTab({ token, event }) {
  const [judges, setJudges] = useState([]);
  const [error, setError] = useState('');

  async function refresh() {
    const rows = await adminApi.judges(token, event.id);
    setJudges(rows);
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [event.id]);

  async function addJudge() {
    const name = prompt('Judge name?');
    if (!name) return;
    const expertise = prompt('Expertise (e.g. AI/ML)?') || '';
    await adminApi.createJudge(token, { event_id: event.id, name, expertise });
    refresh();
  }

  async function importCsv(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      async complete(results) {
        try {
          const judges = results.data.map((r) => ({
            event_id: event.id,
            name: r.name || r.Name || '',
            email: r.email || r.Email || '',
            expertise: r.expertise || r.Expertise || '',
            pin: r.pin || r.PIN || '',
          })).filter((j) => j.name);
          await adminApi.importJudges(token, { event_id: event.id, judges });
          refresh();
        } catch (e) { setError(e.message); }
      },
    });
  }

  async function resetPin(j) {
    if (!confirm(`Issue ${j.name} a new random 6-digit PIN?`)) return;
    // Empty pin tells the server to allocate a fresh unique 6-digit code.
    await adminApi.updateJudge(token, j.id, { event_id: event.id, pin: '' });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-ink-300/60 p-4 sm:p-5 flex flex-wrap gap-3 items-center">
        <button onClick={addJudge} className="rounded-xl bg-ink-900 text-white px-4 py-2 text-sm hover:bg-ink-700">+ Add judge</button>
        <label className="text-sm text-ink-700 inline-flex items-center gap-2 min-w-0">
          <span className="shrink-0">CSV:</span>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ''; }}
            className="text-sm min-w-0 max-w-[180px]"
          />
        </label>
        {error && <div className="basis-full text-sm text-red-600">{error}</div>}
      </div>

      <div className="bg-white rounded-2xl border border-ink-300/60 overflow-hidden">
        {/* Mobile: stacked cards */}
        <ul className="md:hidden divide-y divide-ink-300/60">
          {judges.length === 0 && (
            <li className="text-center py-8 text-ink-500 text-sm">No judges yet — add one or import CSV.</li>
          )}
          {judges.map((j) => (
            <li key={j.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{j.name}</div>
                  <div className="text-xs text-ink-500 truncate">{j.expertise || '—'}{j.email ? ` · ${j.email}` : ''}</div>
                  <div className="text-xs text-ink-500 mt-1 font-mono">PIN: {j.pin}</div>
                </div>
                <div className="text-xs flex flex-col items-end gap-1 shrink-0">
                  <button onClick={() => resetPin(j)} className="text-ink-500 hover:text-ink-900">Reset</button>
                  <button
                    onClick={async () => { if (confirm(`Remove ${j.name}?`)) { await adminApi.deleteJudge(token, j.id); refresh(); } }}
                    className="text-red-600 hover:underline"
                  >Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop: table */}
        <table className="hidden md:table w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-ink-500 bg-slate-50 border-b border-ink-300/60">
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-3 py-2">Expertise</th>
              <th className="text-left px-3 py-2 w-28">PIN</th>
              <th className="text-right px-4 py-2 w-40">Actions</th>
            </tr>
          </thead>
          <tbody>
            {judges.map((j) => (
              <tr key={j.id} className="border-b border-ink-300/40">
                <td className="px-4 py-2 font-medium">{j.name}<div className="text-xs text-ink-500">{j.email}</div></td>
                <td className="px-3 py-2 text-ink-700">{j.expertise || '—'}</td>
                <td className="px-3 py-2 font-mono">{j.pin}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => resetPin(j)} className="text-xs text-ink-500 hover:text-ink-900 mr-3">Reset PIN</button>
                  <button
                    onClick={async () => { if (confirm(`Remove ${j.name}?`)) { await adminApi.deleteJudge(token, j.id); refresh(); } }}
                    className="text-red-600 text-xs hover:underline"
                  >Remove</button>
                </td>
              </tr>
            ))}
            {judges.length === 0 && (
              <tr><td colSpan={4} className="text-center py-8 text-ink-500 text-sm">No judges yet — add one or import CSV.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
