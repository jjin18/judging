import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { adminApi } from '../../lib/api.js';

const FIELDS = ['title', 'team_name', 'devpost_url', 'track', 'description', 'table_number'];

export default function ProjectsTab({ token, event }) {
  const [mode, setMode] = useState('csv'); // 'csv' | 'scrape'
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    const rows = await adminApi.projects(token, event.id);
    setProjects(rows);
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [event.id]);

  async function deleteProject(id) {
    if (!confirm('Remove this project?')) return;
    await adminApi.deleteProject(token, id);
    refresh();
  }

  async function patchProject(id, fields) {
    try { await adminApi.updateProject(token, id, fields); }
    catch (e) { setError(e.message); }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-ink-300/60 p-5">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold mr-auto">Import projects</h2>
          <div className="inline-flex rounded-lg border border-ink-300 p-0.5 text-sm">
            <button onClick={() => setMode('csv')} className={`px-3 py-1.5 rounded-md ${mode === 'csv' ? 'bg-ink-900 text-white' : 'text-ink-700'}`}>CSV upload</button>
            <button onClick={() => setMode('scrape')} className={`px-3 py-1.5 rounded-md ${mode === 'scrape' ? 'bg-ink-900 text-white' : 'text-ink-700'}`}>Scrape Devpost</button>
          </div>
        </div>
        {mode === 'csv'
          ? <CsvImport token={token} event={event} onDone={refresh} setBusy={setBusy} setError={setError} />
          : <ScrapeImport token={token} event={event} onDone={refresh} setBusy={setBusy} setError={setError} />}
        {error && <div className="text-sm text-red-600 mt-3">{error}</div>}
      </div>

      <div className="bg-white rounded-2xl border border-ink-300/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-300/60">
          <h2 className="text-lg font-semibold">Projects ({projects.length})</h2>
          <button
            onClick={async () => {
              const t = prompt('Project title?');
              if (!t) return;
              await adminApi.createProject(token, { event_id: event.id, title: t });
              refresh();
            }}
            className="text-sm rounded-lg border border-ink-300 px-3 py-1.5 hover:border-accent-500"
          >+ Add manually</button>
        </div>
        <ProjectsTable projects={projects} onPatch={patchProject} onDelete={deleteProject} />
      </div>
    </div>
  );
}

function CsvImport({ token, event, onDone, setBusy, setError }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const fileRef = useRef(null);

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        setRows(results.data);
        const hs = results.meta.fields || [];
        setHeaders(hs);
        const auto = {};
        for (const f of FIELDS) {
          const m = hs.find((h) => h.toLowerCase().includes(f.replace('_', ' ')) || h.toLowerCase() === f);
          if (m) auto[f] = m;
        }
        setMapping(auto);
      },
    });
  }

  async function commit() {
    if (!rows?.length) return;
    setBusy(true); setError('');
    try {
      const projects = rows.map((r) => {
        const out = { event_id: event.id, title: '' };
        for (const f of FIELDS) {
          const col = mapping[f];
          if (col && r[col] != null) out[f] = String(r[col]).trim();
        }
        if (!out.title) out.title = '(untitled)';
        return out;
      });
      await adminApi.importProjects(token, { event_id: event.id, projects });
      setRows(null); setHeaders([]); setMapping({});
      if (fileRef.current) fileRef.current.value = '';
      onDone();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="block text-sm" />
      <p className="text-xs text-ink-500 mt-1">Drag your Devpost export CSV. Then map columns below.</p>
      {rows && (
        <div className="mt-4 space-y-2">
          <div className="text-sm">{rows.length} rows · map fields:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <label key={f} className="text-sm flex items-center gap-2">
                <span className="w-32 text-ink-700">{f}</span>
                <select
                  value={mapping[f] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}
                  className="flex-1 rounded-lg border border-ink-300 px-2 py-1.5"
                >
                  <option value="">— ignore —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button onClick={commit} className="mt-2 rounded-xl bg-ink-900 text-white px-5 py-2 text-sm hover:bg-ink-700">
            Import {rows.length} projects
          </button>
        </div>
      )}
    </div>
  );
}

function ScrapeImport({ token, event, onDone, setBusy, setError }) {
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(null);
  const [count, setCount] = useState(0);

  async function run() {
    setBusy(true); setError(''); setCount(0); setProgress(null);
    try {
      await adminApi.scrape(token, event.id, url, (ev) => {
        if (ev.event === 'page') setProgress({ page: ev.page, total: ev.total });
        if (ev.event === 'project') setCount((c) => c + 1);
        if (ev.event === 'error') setError(ev.message);
      });
      onDone();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-hackathon.devpost.com"
          className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-accent-500 outline-none"
        />
        <button onClick={run} disabled={!url} className="rounded-xl bg-ink-900 text-white px-4 py-2 text-sm hover:bg-ink-700 disabled:opacity-40">
          Fetch projects
        </button>
      </div>
      {progress && (
        <div className="text-sm text-ink-500">
          Fetching page {progress.page} of {progress.total}… {count > 0 && <span>· {count} projects so far</span>}
        </div>
      )}
    </div>
  );
}

function ProjectsTable({ projects, onPatch, onDelete }) {
  const [editing, setEditing] = useState(null); // { id, field }
  const [draft, setDraft] = useState('');
  const sorted = useMemo(() => [...projects].sort((a, b) => {
    const an = parseInt(a.table_number || '99999', 10);
    const bn = parseInt(b.table_number || '99999', 10);
    return an - bn || (a.title || '').localeCompare(b.title || '');
  }), [projects]);

  function startEdit(p, field) {
    setEditing({ id: p.id, field });
    setDraft(p[field] ?? '');
  }
  function commit() {
    if (!editing) return;
    onPatch(editing.id, { event_id: 0, [editing.field]: draft }); // event_id ignored server-side
    setEditing(null);
  }

  return (
    <div>
      {/* Mobile: stacked cards */}
      <ul className="md:hidden divide-y divide-ink-300/60">
        {sorted.length === 0 && (
          <li className="text-center py-8 text-ink-500 text-sm">No projects yet.</li>
        )}
        {sorted.map((p, i) => (
          <li key={p.id} className="px-4 py-3 flex items-start gap-3">
            <div className="font-mono text-xs text-ink-500 w-12 shrink-0 pt-0.5">
              {p.table_number ? `#${p.table_number}` : '—'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{p.title}</div>
              <div className="text-xs text-ink-500 truncate">
                {p.team_name || '—'}{p.track ? ` · ${p.track}` : ''}
              </div>
              {p.devpost_url && (
                <a href={p.devpost_url} target="_blank" rel="noreferrer"
                   className="text-xs text-accent-600 hover:underline truncate block">{p.devpost_url}</a>
              )}
            </div>
            <button onClick={() => onDelete(p.id)} className="text-red-600 text-xs hover:underline shrink-0">Remove</button>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-ink-500 bg-slate-50 border-b border-ink-300/60">
            <th className="text-left px-4 py-2 w-10">#</th>
            <th className="text-left px-3 py-2 w-20">Table</th>
            <th className="text-left px-3 py-2">Project</th>
            <th className="text-left px-3 py-2">Team</th>
            <th className="text-left px-3 py-2 w-32">Device #</th>
            <th className="text-right px-4 py-2 w-32">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.id} className="border-b border-ink-300/40">
              <td className="px-4 py-2 text-ink-500">{i + 1}</td>
              <Cell value={p.table_number} editing={editing?.id === p.id && editing.field === 'table_number'}
                draft={draft} setDraft={setDraft} startEdit={() => startEdit(p, 'table_number')} commit={commit} cancel={() => setEditing(null)} mono />
              <Cell value={p.title} editing={editing?.id === p.id && editing.field === 'title'}
                draft={draft} setDraft={setDraft} startEdit={() => startEdit(p, 'title')} commit={commit} cancel={() => setEditing(null)} />
              <Cell value={p.team_name} editing={editing?.id === p.id && editing.field === 'team_name'}
                draft={draft} setDraft={setDraft} startEdit={() => startEdit(p, 'team_name')} commit={commit} cancel={() => setEditing(null)} />
              <Cell value={p.track} editing={editing?.id === p.id && editing.field === 'track'}
                draft={draft} setDraft={setDraft} startEdit={() => startEdit(p, 'track')} commit={commit} cancel={() => setEditing(null)} />
              <td className="px-4 py-2 text-right">
                <button onClick={() => onDelete(p.id)} className="text-red-600 text-xs hover:underline">Remove</button>
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={6} className="text-center py-8 text-ink-500 text-sm">No projects yet — import via CSV or scrape Devpost.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function Cell({ value, editing, draft, setDraft, startEdit, commit, cancel, mono }) {
  return (
    <td className="px-3 py-2" onDoubleClick={startEdit}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
          className={`w-full rounded border border-accent-500 px-1.5 py-1 outline-none ${mono ? 'font-mono' : ''}`}
        />
      ) : (
        <span className={`block truncate cursor-text ${mono ? 'font-mono text-ink-700' : ''}`}>{value || <span className="text-ink-300">—</span>}</span>
      )}
    </td>
  );
}
