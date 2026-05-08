import { useEffect, useState } from 'react';
import { adminApi } from '../lib/api.js';
import EventSidebar from './EventSidebar.jsx';
import SetupTab from './tabs/SetupTab.jsx';
import ProjectsTab from './tabs/ProjectsTab.jsx';
import JudgesTab from './tabs/JudgesTab.jsx';

const LS_TOKEN = 'admin.token';

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(LS_TOKEN) || '');
  const [events, setEvents] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState('setup');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="min-h-screen flex bg-slate-50">
      <EventSidebar
        events={events}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={async () => {
          const name = prompt('Event name?');
          if (!name) return;
          const ev = await adminApi.createEvent(token, { name });
          await refreshEvents(ev.id);
          setTab('setup');
        }}
        onLogout={() => { localStorage.removeItem(LS_TOKEN); setToken(''); }}
      />
      <main className="flex-1 min-w-0 flex flex-col">
        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 border-b border-red-200">{error}</div>}
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-ink-500 text-sm">
            {loading ? 'Loading…' : 'Create your first event from the sidebar.'}
          </div>
        ) : (
          <>
            <header className="bg-white border-b border-ink-300/60 px-6 py-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">{active.name}</h1>
                  <div className="text-sm text-ink-500">Event #{active.id}{active.date ? ` · ${active.date}` : ''}</div>
                </div>
                <div className="text-xs text-ink-500">
                  <a className="hover:text-accent-600 mr-3" href={`/api/admin/export/scores?event_id=${active.id}&token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Export scores CSV</a>
                  <a className="hover:text-accent-600 mr-3" href={`/api/admin/export/leaderboard?event_id=${active.id}&token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Leaderboard CSV</a>
                  <a className="hover:text-accent-600" href={`/api/admin/export/luma?event_id=${active.id}&top=10&token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Luma top 10 CSV</a>
                </div>
              </div>
              <nav className="mt-4 flex gap-1">
                {['setup','projects','judges'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-slate-100'}`}
                  >
                    {t === 'setup' ? 'Setup' : t === 'projects' ? 'Projects' : 'Judges'}
                  </button>
                ))}
              </nav>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              {tab === 'setup' && (
                <SetupTab token={token} event={active} onSaved={(ev) => refreshEvents(ev.id)} />
              )}
              {tab === 'projects' && <ProjectsTab token={token} event={active} />}
              {tab === 'judges' && <JudgesTab token={token} event={active} />}
            </div>
          </>
        )}
      </main>
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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
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
  );
}
