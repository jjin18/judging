const CRITERIA = [
  { key: 'innovation', label: 'Innovation & Originality', weight: 25, lo: 'obvious', hi: 'breakthrough' },
  { key: 'technical', label: 'Technical Complexity', weight: 25, lo: 'tutorial', hi: 'research-grade' },
  { key: 'impact', label: 'Real-world Impact', weight: 25, lo: 'toy demo', hi: 'ships and matters' },
  { key: 'presentation', label: 'Presentation & Demo', weight: 25, lo: 'confused', hi: 'memorable' },
];

export default function ScoringRubric(props) {
  const values = {
    innovation: props.innovation,
    technical: props.technical,
    impact: props.impact,
    presentation: props.presentation,
  };
  const setters = {
    innovation: props.setInnovation,
    technical: props.setTechnical,
    impact: props.setImpact,
    presentation: props.setPresentation,
  };

  return (
    <div className="space-y-5">
      {CRITERIA.map((c) => (
        <Slider key={c.key} {...c} value={values[c.key]} onChange={setters[c.key]} />
      ))}
      <textarea
        value={props.notes}
        onChange={(e) => props.setNotes(e.target.value)}
        placeholder="Private notes (optional)"
        rows={2}
        className="w-full rounded-xl border border-ink-300 px-3 py-2 text-sm focus:border-accent-500 outline-none resize-none"
      />
    </div>
  );
}

function Slider({ label, weight, lo, hi, value, onChange }) {
  const pct = ((value - 1) / 9) * 100;
  function setNumeric(v) {
    let n = Math.round(Number(v) * 10) / 10;
    if (Number.isNaN(n)) return;
    if (n < 1) n = 1;
    if (n > 10) n = 10;
    onChange(n);
  }
  function inputType(e) {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) setNumeric(v);
  }

  return (
    <div className="rounded-2xl bg-white border border-ink-300/60 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-medium">{label}</div>
        <input
          inputMode="decimal"
          value={value}
          onChange={inputType}
          className="w-14 text-right rounded-lg border border-ink-300 px-2 py-1 text-xl font-semibold tabular-nums focus:border-accent-500 outline-none"
        />
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={0.5}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider touch-target"
        style={{ '--pct': `${pct}%` }}
      />
      <div className="flex justify-between text-[10px] text-ink-500 mt-1 font-mono">
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}
