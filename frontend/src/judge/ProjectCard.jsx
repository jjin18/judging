export default function ProjectCard({ project }) {
  return (
    <div className="rounded-2xl bg-white border border-ink-300/60 p-5 mb-5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold leading-tight">{project.title}</h2>
          {project.team_name && (
            <div className="text-sm text-ink-500 mt-1 truncate">Team {project.team_name}</div>
          )}
        </div>
      </div>
      {project.devpost_url && (
        <a
          href={project.devpost_url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-ink-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-ink-700 touch-target"
        >
          Open on Devpost
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 3h7v7M21 3l-9 9M5 5h6v2H7v10h10v-4h2v6H5z" strokeLinejoin="round"/>
          </svg>
        </a>
      )}
    </div>
  );
}
