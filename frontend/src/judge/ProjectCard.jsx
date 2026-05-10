export default function ProjectCard({ project }) {
  const teamLabel = project.team_name ? `Team ${project.team_name}` : null;
  const meta = [teamLabel, project.robot_arm].filter(Boolean).join(' · ');
  return (
    <div className="rounded-2xl bg-white border border-ink-300/60 p-5 mb-5 space-y-3">
      <div>
        <h2 className="text-xl font-semibold leading-tight">
          {project.description || project.title}
        </h2>
        {meta && <div className="text-sm text-ink-500 mt-1 truncate">{meta}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {project.github_url && (
          <LinkButton href={project.github_url} label="GitHub" variant="primary" />
        )}
        {project.x_post_url && (
          <LinkButton href={project.x_post_url} label="X post" variant="ghost" />
        )}
        {project.huggingface_url && (
          <LinkButton href={project.huggingface_url} label="Hugging Face" variant="ghost" />
        )}
      </div>
    </div>
  );
}

function LinkButton({ href, label, variant }) {
  const cls = variant === 'primary'
    ? 'bg-ink-900 text-white hover:bg-ink-700'
    : 'border border-ink-300 text-ink-700 hover:border-accent-500';
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium touch-target ${cls}`}
    >
      {label}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 3h7v7M21 3l-9 9M5 5h6v2H7v10h10v-4h2v6H5z" strokeLinejoin="round"/>
      </svg>
    </a>
  );
}
