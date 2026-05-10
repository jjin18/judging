import { downloadMyScoresPDF } from './ScoresPDF.js';

export default function ProgressSection({ projects, scores, activeId, onPick, judge }) {
  const total = projects.length || 1;
  const done = projects.filter((p) => scores[p.id]).length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{done} / {projects.length}</span>
          <span className="text-ink-500 text-xs">{pct}%</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="space-y-1 max-h-[40vh] md:max-h-[50vh] overflow-y-auto scrollbar-thin -mx-1">
        {projects.map((p) => {
          const has = !!scores[p.id];
          const active = p.id === activeId;
          return (
            <li key={p.id}>
              <div
                className={`w-full px-2 py-2 rounded-lg flex items-center gap-2 text-sm
                  ${active ? 'bg-accent-500/10' : 'hover:bg-slate-100'}`}
              >
                <button
                  onClick={() => onPick(p.id)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2 touch-target"
                >
                  <span className={`shrink-0 w-2 h-2 rounded-full ${has ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className={`truncate ${active ? 'text-accent-600 font-medium' : ''}`}>{p.title}</span>
                </button>
                {p.x_post_url && (
                  <a
                    href={p.x_post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs text-ink-500 hover:text-accent-600 px-2 py-1 touch-target"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Open X post"
                  >
                    X post ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <button
        onClick={() => downloadMyScoresPDF({ judge, event: null, projects, scores })}
        className="w-full rounded-lg border border-ink-300 bg-white py-2 text-sm hover:border-accent-500 touch-target"
      >
        Download my scores (PDF)
      </button>
    </div>
  );
}
