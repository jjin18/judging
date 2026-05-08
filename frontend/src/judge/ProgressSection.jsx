import { downloadMyScoresPDF } from './LetterPDF.js';

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
              <button
                onClick={() => onPick(p.id)}
                className={`w-full text-left px-2 py-2 rounded-lg flex items-center gap-2 text-sm touch-target
                  ${active ? 'bg-accent-500/10 text-accent-600' : 'hover:bg-slate-100'}`}
              >
                <span className={`shrink-0 w-2 h-2 rounded-full ${has ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="font-mono text-xs text-ink-500 w-10 shrink-0">{p.table_number || '—'}</span>
                <span className="truncate">{p.title}</span>
              </button>
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
