import { useMemo } from 'react';
import { downloadJudgeLetterPDF } from './LetterPDF.js';

export default function LetterSection({ judge, event, projects, scores }) {
  const scoredProjects = useMemo(
    () => projects.filter((p) => scores[p.id]),
    [projects, scores],
  );

  return (
    <button
      onClick={() => downloadJudgeLetterPDF({ judge, event, projects: scoredProjects })}
      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-ink-900 text-white py-3 text-sm font-medium touch-target hover:bg-ink-700"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Download letter (PDF)
    </button>
  );
}
