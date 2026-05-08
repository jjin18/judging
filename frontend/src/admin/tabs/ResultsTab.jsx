import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../lib/api.js';

export default function ResultsTab({ token, event }) {
  const [leaderboard, setLeaderboard] = useState(null);
  const [scores, setScores] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [view, setView] = useState('ranked'); // 'ranked' | 'all'

  async function refresh() {
    try {
      const [lb, sc] = await Promise.all([
        adminApi.leaderboard(token, event.id),
        adminApi.scores(token, event.id),
      ]);
      setLeaderboard(lb);
      setScores(sc);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { refresh(); }, [event.id]);

  const scoresByProject = useMemo(() => {
    const m = {};
    for (const s of (scores || [])) (m[s.project_id] ||= []).push(s);
    return m;
  }, [scores]);

  if (!leaderboard || !scores) {
    return <div className="text-sm text-ink-500">Loading…</div>;
  }

  const ranked = leaderboard.filter((r) => r.judge_count > 0);
  const unjudged = leaderboard.filter((r) => r.judge_count === 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-300 p-0.5 text-sm">
          <button onClick={() => setView('ranked')}
            className={`px-3 py-1.5 rounded-md ${view === 'ranked' ? 'bg-ink-900 text-white' : 'text-ink-700'}`}>
            Ranked ({ranked.length})
          </button>
          <button onClick={() => setView('all')}
            className={`px-3 py-1.5 rounded-md ${view === 'all' ? 'bg-ink-900 text-white' : 'text-ink-700'}`}>
            All scores ({scores.length})
          </button>
        </div>
        <button onClick={refresh}
          className="ml-auto text-sm rounded-lg border border-ink-300 px-3 py-1.5 hover:border-accent-500">
          Refresh
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {view === 'ranked' ? (
        <RankedView
          ranked={ranked}
          unjudged={unjudged}
          scoresByProject={scoresByProject}
          expanded={expanded}
          setExpanded={setExpanded}
        />
      ) : (
        <AllScoresView scores={scores} />
      )}
    </div>
  );
}

function RankedView({ ranked, unjudged, scoresByProject, expanded, setExpanded }) {
  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (ranked.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-ink-300/60 p-8 text-center text-sm text-ink-500">
        No scores yet. Once judges score projects, they'll be ranked here.
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-ink-300/60 overflow-hidden">
        <ul className="divide-y divide-ink-300/60">
          {ranked.map((r, i) => {
            const isOpen = expanded.has(r.id);
            const projScores = (scoresByProject[r.id] || []).slice().sort((a, b) => b.total_weighted - a.total_weighted);
            return (
              <li key={r.id}>
                <button
                  onClick={() => toggle(r.id)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3"
                >
                  <span className={`text-sm font-bold tabular-nums w-7 text-right shrink-0 ${i < 3 ? 'text-ink-900' : 'text-ink-500'}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{r.title}</div>
                    <div className="text-xs text-ink-500 truncate">
                      {r.team_name || '—'}
                      {r.table_number ? ` · table ${r.table_number}` : ''}
                      {r.track ? ` · ${r.track}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold tabular-nums">{Number(r.avg_score).toFixed(2)}</div>
                    <div className="text-xs text-ink-500">{r.judge_count} judge{r.judge_count === 1 ? '' : 's'}</div>
                  </div>
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`text-ink-500 shrink-0 transition ${isOpen ? 'rotate-180' : ''}`}
                  ><path d="M6 9l6 6 6-6" strokeLinecap="round"/></svg>
                </button>
                {isOpen && (
                  <div className="bg-slate-50 px-4 pb-3 pt-1 text-sm">
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs uppercase tracking-wider text-ink-500">
                          <th className="text-left py-1">Judge</th>
                          <th className="text-right py-1">Inn</th>
                          <th className="text-right py-1">Tech</th>
                          <th className="text-right py-1">Imp</th>
                          <th className="text-right py-1">Pres</th>
                          <th className="text-right py-1 pl-2">Wtd</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projScores.map((s) => (
                          <tr key={s.id} className="border-t border-ink-300/40">
                            <td className="py-1.5 truncate">{s.judge_name}</td>
                            <td className="text-right tabular-nums">{Number(s.innovation).toFixed(1)}</td>
                            <td className="text-right tabular-nums">{Number(s.technical).toFixed(1)}</td>
                            <td className="text-right tabular-nums">{Number(s.impact).toFixed(1)}</td>
                            <td className="text-right tabular-nums">{Number(s.presentation).toFixed(1)}</td>
                            <td className="text-right tabular-nums font-semibold pl-2">{Number(s.total_weighted).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {unjudged.length > 0 && (
        <details className="bg-white rounded-2xl border border-ink-300/60 overflow-hidden">
          <summary className="px-4 py-3 text-sm text-ink-500 cursor-pointer hover:bg-slate-50">
            {unjudged.length} project{unjudged.length === 1 ? '' : 's'} not yet scored
          </summary>
          <ul className="divide-y divide-ink-300/60 text-sm">
            {unjudged.map((r) => (
              <li key={r.id} className="px-4 py-2 flex items-center gap-3 text-ink-700">
                <span className="font-mono text-xs text-ink-500 w-12 shrink-0">
                  {r.table_number ? `#${r.table_number}` : '—'}
                </span>
                <span className="truncate">{r.title}</span>
                <span className="ml-auto text-xs text-ink-500 truncate">{r.team_name || ''}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function AllScoresView({ scores }) {
  if (scores.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-ink-300/60 p-8 text-center text-sm text-ink-500">
        No scores yet.
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-ink-300/60 overflow-hidden">
      {/* Mobile: stacked cards */}
      <ul className="md:hidden divide-y divide-ink-300/60">
        {scores.map((s) => (
          <li key={s.id} className="px-4 py-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{s.project_title}</div>
              <div className="text-xs text-ink-500 truncate">
                {s.judge_name} · {s.team_name || '—'}
                {s.table_number ? ` · #${s.table_number}` : ''}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-base font-semibold tabular-nums">{Number(s.total_weighted).toFixed(2)}</div>
              <div className="text-xs text-ink-500">{shortDate(s.updated_at)}</div>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <table className="hidden md:table w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-ink-500 bg-slate-50 border-b border-ink-300/60">
            <th className="text-left px-4 py-2">Project</th>
            <th className="text-left px-3 py-2">Team</th>
            <th className="text-left px-3 py-2 w-32">Judge</th>
            <th className="text-right px-2 py-2 w-12">Inn</th>
            <th className="text-right px-2 py-2 w-14">Tech</th>
            <th className="text-right px-2 py-2 w-12">Imp</th>
            <th className="text-right px-2 py-2 w-12">Pres</th>
            <th className="text-right px-3 py-2 w-16">Wtd</th>
            <th className="text-right px-4 py-2 w-32">Updated</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.id} className="border-b border-ink-300/40">
              <td className="px-4 py-2 font-medium">{s.project_title}</td>
              <td className="px-3 py-2 text-ink-700">{s.team_name || '—'}</td>
              <td className="px-3 py-2 text-ink-700">{s.judge_name}</td>
              <td className="px-2 py-2 text-right tabular-nums">{Number(s.innovation).toFixed(1)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{Number(s.technical).toFixed(1)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{Number(s.impact).toFixed(1)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{Number(s.presentation).toFixed(1)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">{Number(s.total_weighted).toFixed(2)}</td>
              <td className="px-4 py-2 text-right text-xs text-ink-500">{shortDate(s.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shortDate(s) {
  if (!s) return '';
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}
