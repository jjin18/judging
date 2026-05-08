import { useMemo } from 'react';
import { downloadJudgeLetterPDF } from './LetterPDF.js';

export default function LetterSection({ judge, event, projects, scores }) {
  const scoredProjects = useMemo(() => {
    return projects.filter((p) => scores[p.id]);
  }, [projects, scores]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-ink-300/60 bg-slate-50 p-4 text-[13px] leading-6 font-serif">
        <div className="flex items-start justify-between gap-3 pb-2 border-b border-ink-300/60">
          <div className="text-xs uppercase tracking-wider text-ink-500">{event?.org_name || 'Organization'}</div>
          <div className="text-xs text-ink-500 text-right">
            {event?.org_address && <div>{event.org_address}</div>}
            {event?.org_website && <div>{event.org_website}</div>}
          </div>
        </div>
        <div className="pt-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-500 mb-2">Official Judge Acknowledgment</div>
          <p>Dear <b>{judge?.name || 'Judge'}</b>,</p>
          <p className="mt-2">
            On behalf of <b>{event?.org_name || '—'}</b>, we are honored to confirm your participation
            as an official judge at <b>{event?.name || 'this event'}</b>
            {event?.date ? `, held on ${event.date}` : ''}
            {event?.venue ? ` at ${event.venue}` : ''}
            {event?.city ? `, ${event.city}` : ''}.
          </p>
          <p className="mt-2">
            <b>{judge?.name}</b> brings expertise in <b>{judge?.expertise || 'their domain'}</b> to our
            panel. Over the course of this event, you evaluated <b>{scoredProjects.length}</b> projects,
            contributing approximately <b>{Math.max(1, Math.round((event?.hours_expected || 4)))}</b> hours of expert technical review.
          </p>
          <p className="mt-2">
            This letter serves as formal documentation suitable for professional portfolios,
            visa applications (O-1, EB-1), and LinkedIn credentials.
          </p>
          {scoredProjects.length > 0 && (
            <div className="mt-3">
              <div className="text-xs uppercase tracking-wider text-ink-500 mb-1">Projects evaluated</div>
              <ul className="text-[12px] columns-1 sm:columns-2 gap-x-6">
                {scoredProjects.map((p) => (
                  <li key={p.id} className="break-inside-avoid">• {p.title}{p.team_name ? ` — ${p.team_name}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-ink-300/60 text-[12px] text-ink-500">
            Issued by: <b>{event?.organizer_name || '—'}</b>{event?.organizer_title ? `, ${event.organizer_title}` : ''}
            {event?.org_name ? ` · ${event.org_name}` : ''}{event?.date ? ` · ${event.date}` : ''}
          </div>
        </div>
      </div>
      <button
        onClick={() => downloadJudgeLetterPDF({ judge, event, projects: scoredProjects })}
        className="w-full rounded-xl bg-ink-900 text-white py-2.5 text-sm font-medium touch-target hover:bg-ink-700"
      >
        Download PDF
      </button>
      <p className="text-xs text-ink-500">Available now — works offline. Updates as you score more projects.</p>
    </div>
  );
}
