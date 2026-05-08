import { useState } from 'react';

export default function ProjectCard({ project }) {
  const [expanded, setExpanded] = useState(false);
  const desc = project.description || '';
  const long = desc.length > 220;

  return (
    <div className="rounded-2xl bg-white border border-ink-300/60 p-5 mb-5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-500 mb-1">Table {project.table_number || '—'}</div>
          <h2 className="text-xl font-semibold leading-tight truncate">{project.title}</h2>
          <div className="text-sm text-ink-500 mt-1">
            {project.team_name && <>Team: <span className="text-ink-700">{project.team_name}</span></>}
            {project.track && <> · Track: <span className="text-ink-700">{project.track}</span></>}
          </div>
        </div>
        {project.devpost_url && (
          <a
            href={project.devpost_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent-600 hover:text-accent-500 shrink-0 flex items-center gap-1 touch-target px-2"
          >
            Devpost
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3h7v7M21 3l-9 9M5 5h6v2H7v10h10v-4h2v6H5z" strokeLinejoin="round"/></svg>
          </a>
        )}
      </div>
      {desc && (
        <p className={`mt-3 text-sm text-ink-700 leading-6 whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>
          {desc}
        </p>
      )}
      {long && (
        <button onClick={() => setExpanded((v) => !v)} className="text-xs text-accent-600 hover:underline mt-1">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
