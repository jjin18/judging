import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api.js';
import EventSidebar from './EventSidebar.jsx';
import SetupTab from './tabs/SetupTab.jsx';
import ProjectsTab from './tabs/ProjectsTab.jsx';
import JudgesTab from './tabs/JudgesTab.jsx';
import ResultsTab from './tabs/ResultsTab.jsx';
import BackHome from '../layout/BackHome.jsx';

const LS_TOKEN = 'admin.token';

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(LS_TOKEN) || '');
  const [events, setEvents] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState('setup');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    adminApi.events(token)
      .then((rows) => {
        setEvents(rows);
        if (rows.length && !activeId) setActiveId(rows[0].id);
      })
      .catch((e) => {
        if (e.status === 401) { setToken(''); localStorage.removeItem(LS_TOKEN); }
        else setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (!token) return <Login onAuthed={(t) => { localStorage.setItem(LS_TOKEN, t); setToken(t); }} />;

  const active = events.find((e) => e.id === activeId);

  async function refreshEvents(selectId) {
    const rows = await adminApi.events(token);
    setEvents(rows);
    if (selectId !== undefined) setActiveId(selectId);
    else if (!rows.find((e) => e.id === activeId)) setActiveId(rows[0]?.id ?? null);
  }

  const sidebar = (
    <EventSidebar
      events={events}
      activeId={activeId}
      onSelect={(id) => { setActiveId(id); setDrawerOpen(false); }}
      onCreate={async () => {
        const name = prompt('Event name?');
        if (!name) return;
        const ev = await adminApi.createEvent(token, { name });
        await refreshEvents(ev.id);
        setTab('setup');
        setDrawerOpen(false);
      }}
      onLogout={() => { localStorage.removeItem(LS_TOKEN); setToken(''); }}
    />
  );

  return (
    <div className="min-h-screen md:flex bg-slate-50">
      <aside className="hidden md:flex md:w-64 shrink-0">{sidebar}</aside>
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setDrawerOpen(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-white shadow-xl flex" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}
      <main className="flex-1 min-w-0 flex flex-col">
        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 border-b border-red-200">{error}</div>}
        <BackupStatus token={token} />
        {!active ? (
          <>
            <MobileBar active={null} onMenu={() => setDrawerOpen(true)} />
            <div className="flex-1 flex items-center justify-center text-ink-500 text-sm p-6 text-center">
              {loading ? 'Loading…' : 'Create your first event from the sidebar.'}
            </div>
          </>
        ) : (
          <>
            <MobileBar active={active} onMenu={() => setDrawerOpen(true)} />
            <header className="bg-white border-b border-ink-300/60 px-4 sm:px-6 py-4">
              <div className="hidden md:flex items-baseline justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold tracking-tight truncate">{active.name}</h1>
                  <div className="text-sm text-ink-500">Event #{active.id}{active.date ? ` · ${active.date}` : ''}</div>
                </div>
                <ExportLinks event={active} token={token} />
              </div>
              <div className="md:hidden">
                <ExportLinks event={active} token={token} />
              </div>
              <nav className="mt-4 flex gap-1 -mx-1 overflow-x-auto scrollbar-thin">
                {[
                  ['setup', 'Setup'],
                  ['projects', 'Projects'],
                  ['judges', 'Judges'],
                  ['results', 'Results'],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`shrink-0 px-4 py-2 rounded-lg text-sm font-medium ${tab === k ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-slate-100'}`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
              {tab === 'setup' && (
                <SetupTab token={token} event={active} onSaved={(ev) => refreshEvents(ev.id)} />
              )}
              {tab === 'projects' && <ProjectsTab token={token} event={active} />}
              {tab === 'judges' && <JudgesTab token={token} event={active} />}
              {tab === 'results' && <ResultsTab token={token} event={active} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MobileBar({ active, onMenu }) {
  return (
    <div className="md:hidden flex items-center gap-2 bg-white border-b border-ink-300/60 px-3 py-2">
      <button
        onClick={onMenu}
        className="touch-target rounded-lg hover:bg-slate-100 px-2"
        aria-label="Menu"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/>
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm truncate">{active ? active.name : 'Admin'}</div>
        {active?.date && <div className="text-xs text-ink-500 truncate">{active.date}</div>}
      </div>
    </div>
  );
}

function ExportLinks({ event, token }) {
  const t = encodeURIComponent(token);
  const links = [
    { label: 'Scores CSV', href: `/api/admin/export/scores?event_id=${event.id}&token=${t}` },
    { label: 'Leaderboard CSV', href: `/api/admin/export/leaderboard?event_id=${event.id}&token=${t}` },
    { label: 'Luma top 10 CSV', href: `/api/admin/export/luma?event_id=${event.id}&top=10&token=${t}` },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
      {links.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
           className="hover:text-accent-600">{l.label}</a>
      ))}
    </div>
  );
}

function Login({ onAuthed }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { token } = await adminApi.auth(pw);
      onAuthed(token);
    } catch (e) {
      setErr('Wrong password.');
    } finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen bg-slate-50 px-6">
      <div className="max-w-sm mx-auto pt-6"><BackHome /></div>
      <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Organizer sign-in</h1>
        <p className="text-ink-500 text-sm mt-1 mb-6">Enter the admin password.</p>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded-xl border border-ink-300 bg-white px-4 py-3 text-base mb-3 focus:border-accent-500 outline-none"
        />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button type="submit" disabled={busy || !pw} className="w-full rounded-xl bg-ink-900 text-white py-3 font-medium hover:bg-ink-700 disabled:opacity-40">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      </div>
    </div>
  );
}


function BackupStatus({ token }) {
  const [health, setHealth] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [hidden, setHidden] = useState(() => localStorage.getItem("admin.hideBackupBanner") === "1");

  useEffect(() => {
    adminApi.health().then(setHealth).catch(() => {});
  }, []);

  if (hidden || !health) return null;
  const enabled = health.sheets_backup;

  async function runTest() {
    setTesting(true); setTestResult(null);
    try {
      const r = await adminApi.testSheets(token);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
    } finally { setTesting(false); }
  }

  return (
    <div className={`text-xs sm:text-sm px-3 sm:px-4 py-2 border-b flex items-center gap-2 sm:gap-3 flex-wrap
      ${enabled ? "bg-emerald-50 text-emerald-900 border-emerald-200" : "bg-amber-50 text-amber-900 border-amber-200"}`}>
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${enabled ? "bg-emerald-500" : "bg-amber-500"}`} />
      <span className="min-w-0">
        DB: <b>{health.db}</b>
        {" · "}
        Sheets: <b>{enabled ? "enabled" : "not configured"}</b>
      </span>
      {enabled && (
        <button onClick={runTest} disabled={testing}
          className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs hover:bg-emerald-100 disabled:opacity-50">
          {testing ? "Testing…" : "Test"}
        </button>
      )}
      {testResult && (
        <span className="text-xs basis-full sm:basis-auto">
          {testResult.ok
            ? `✓ ${testResult.status} — check Sheet for kind="test"`
            : `✗ ${testResult.error || `status ${testResult.status}`}`}
        </span>
      )}
      <button
        onClick={() => { setHidden(true); localStorage.setItem("admin.hideBackupBanner", "1"); }}
        className="ml-auto text-xs opacity-60 hover:opacity-100"
        aria-label="Hide"
      >dismiss</button>
    </div>
  );
}
