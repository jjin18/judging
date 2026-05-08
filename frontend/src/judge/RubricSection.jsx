const CRITERIA = [
  {
    name: 'Innovation & Originality',
    weight: 25,
    description: "Is this a novel idea or a fresh take on a known problem? Does it surprise you?",
    anchors: { 1: 'Off-the-shelf, obvious.', 5: 'A familiar idea executed in a new way.', 10: 'Genuinely new — you have not seen this before.' },
  },
  {
    name: 'Technical Complexity',
    weight: 25,
    description: "How hard was it to build? Is the solution non-trivial under the hood?",
    anchors: { 1: 'A weekend tutorial.', 5: 'Substantial integration work.', 10: 'Real engineering depth — research-grade or production-grade.' },
  },
  {
    name: 'Real-world Impact',
    weight: 25,
    description: "Could this change how someone works, learns, or lives? How big is the audience?",
    anchors: { 1: 'A toy demo.', 5: 'Useful to a clear, narrow audience.', 10: 'Could ship and matter to many.' },
  },
  {
    name: 'Presentation & Demo',
    weight: 25,
    description: "Did the team communicate clearly? Did the live demo land?",
    anchors: { 1: 'Confused, broken demo.', 5: 'Solid pitch, demo works.', 10: 'Memorable, polished, the room leans in.' },
  },
];

export default function RubricSection() {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-ink-700">Score each criterion 1–10. Equal weights. Final score is the average.</p>
      {CRITERIA.map((c) => (
        <div key={c.name} className="rounded-lg border border-ink-300/60 p-3">
          <div className="flex items-baseline justify-between">
            <div className="font-medium">{c.name}</div>
            <div className="text-xs text-ink-500">{c.weight}%</div>
          </div>
          <p className="text-ink-700 mt-1">{c.description}</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-500">
            <li><b className="text-ink-700">1</b> — {c.anchors[1]}</li>
            <li><b className="text-ink-700">5</b> — {c.anchors[5]}</li>
            <li><b className="text-ink-700">10</b> — {c.anchors[10]}</li>
          </ul>
        </div>
      ))}
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
        <div className="font-semibold mb-1">Conflict of interest</div>
        Skip any team you advise, employ, or know personally. Tell the organizer.
      </div>
      <div className="text-xs text-ink-500">
        Tip: don't anchor on the first project — calibrate after seeing a few. You can revisit any score at any time.
      </div>
    </div>
  );
}
