import { useState } from 'react';
import LetterSection from './LetterSection.jsx';
import RubricSection from './RubricSection.jsx';
import ProgressSection from './ProgressSection.jsx';

export default function LeftPanel({ judge, event, projects, scores, activeId, onPick }) {
  const [open, setOpen] = useState({ letter: true, rubric: false, progress: true });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <Section title="Letter" open={open.letter} onToggle={() => toggle('letter')}>
        <LetterSection judge={judge} event={event} projects={projects} scores={scores} />
      </Section>
      <Section title="Rubric" open={open.rubric} onToggle={() => toggle('rubric')}>
        <RubricSection />
      </Section>
      <Section title="Progress" open={open.progress} onToggle={() => toggle('progress')}>
        <ProgressSection
          projects={projects}
          scores={scores}
          activeId={activeId}
          onPick={onPick}
          judge={judge}
        />
      </Section>
    </div>
  );
}

function Section({ title, open, onToggle, children }) {
  return (
    <section className="border-b border-ink-300/60">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 touch-target"
      >
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             className={`transition ${open ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
