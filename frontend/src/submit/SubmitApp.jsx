import { useEffect, useState } from 'react';

export default function SubmitApp() {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    title: '',
    devpost_url: '',
    table_number: '',
    team_name: '',
    track: '',
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/submit/event')
      .then((r) => r.json())
      .then((d) => setEvent(d.event))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const t = await res.text();
        try { setErr(JSON.parse(t).detail || t); } catch { setErr(t); }
        return;
      }
      const data = await res.json();
      setResult(data.project);
    } catch (e) {
      setErr(e.message || 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    // Keep team_name/table_number filled in for second submission from the same team
    setForm((f) => ({ ...f, title: '', devpost_url: '' }));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-semibold">No event open for submissions</h1>
          <p className="text-ink-500 text-sm mt-2">Check back once the organizer creates the event.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="text-xs uppercase tracking-[0.2em] text-ink-500">Project Submission</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{event.name}</h1>
          {event.date && <div className="text-sm text-ink-500 mt-1">{event.date}{event.venue ? ` · ${event.venue}` : ''}</div>}
        </div>

        {result ? (
          <Confirmation project={result} onAddAnother={reset} />
        ) : (
          <form onSubmit={submit} className="bg-white rounded-2xl border border-ink-300/60 p-6 space-y-4">
            <Field label="Project name *" value={form.title} onChange={(v) => set('title', v)}
              autoFocus required placeholder="e.g. Wayfinder" />
            <Field
              label="Devpost link *"
              hint="Paste your Devpost project URL — judges click through to read about your build."
              value={form.devpost_url}
              onChange={(v) => set('devpost_url', v)}
              type="url"
              required
              placeholder="https://devpost.com/software/your-project"
            />
            <Field label="Table number" hint="Where judges can find you in person." mono
              value={form.table_number} onChange={(v) => set('table_number', v)} placeholder="14" />
            <Field label="Team name" value={form.team_name} onChange={(v) => set('team_name', v)} placeholder="Team Wayfinder" />
            <Field label="Track" hint="Optional — leave blank if you're not entering a specific track."
              value={form.track} onChange={(v) => set('track', v)} placeholder="AI / Climate / Health" />

            {err && <div className="text-sm text-red-600">{err}</div>}

            <button
              type="submit"
              disabled={busy || !form.title.trim() || !form.devpost_url.trim()}
              className="w-full rounded-xl bg-ink-900 text-white py-3 font-medium hover:bg-ink-700 disabled:opacity-40 touch-target"
            >
              {busy ? 'Registering…' : 'Register project'}
            </button>
            <p className="text-xs text-ink-500 text-center">
              You can resubmit anytime to update your table number or fix typos —
              same Devpost link will overwrite your earlier entry.
            </p>
          </form>
        )}

        <div className="text-center mt-6">
          <a href="/" className="text-xs text-ink-500 hover:text-accent-600">← Back to home</a>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, value, onChange, type = 'text', placeholder, autoFocus, required, mono }) {
  return (
    <label className="block text-sm">
      <span className="text-ink-700 font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        className={`mt-1 w-full rounded-lg border border-ink-300 px-3 py-2.5 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="block text-xs text-ink-500 mt-1">{hint}</span>}
    </label>
  );
}

function Confirmation({ project, onAddAnother }) {
  return (
    <div className="bg-white rounded-2xl border border-ink-300/60 p-6 text-center">
      <div className="inline-flex w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 items-center justify-center mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 className="text-lg font-semibold">You're registered for judging</h2>
      <div className="mt-4 text-left rounded-xl bg-slate-50 border border-ink-300/60 p-4 text-sm space-y-1">
        <div><span className="text-ink-500">Project:</span> <b>{project.title}</b></div>
        {project.team_name && <div><span className="text-ink-500">Team:</span> {project.team_name}</div>}
        {project.table_number && <div><span className="text-ink-500">Table:</span> <span className="font-mono">{project.table_number}</span></div>}
        {project.track && <div><span className="text-ink-500">Track:</span> {project.track}</div>}
        <div className="truncate"><span className="text-ink-500">Devpost:</span> <a href={project.devpost_url} target="_blank" rel="noreferrer" className="text-accent-600 hover:underline">{project.devpost_url}</a></div>
      </div>
      <p className="text-xs text-ink-500 mt-3">
        Need to fix something? Resubmit with the same Devpost link.
      </p>
      <button
        onClick={onAddAnother}
        className="mt-4 w-full rounded-xl border border-ink-300 px-5 py-2.5 text-sm hover:border-accent-500 touch-target"
      >
        Edit / submit another
      </button>
    </div>
  );
}
