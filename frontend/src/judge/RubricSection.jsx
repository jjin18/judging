const CRITERIA = [
  { name: 'Innovation & Originality', anchors: '1 obvious · 5 fresh · 10 breakthrough' },
  { name: 'Technical Complexity',     anchors: '1 tutorial · 5 substantial · 10 research-grade' },
  { name: 'Real-world Impact',        anchors: '1 toy · 5 narrow audience · 10 ships and matters' },
  { name: 'Demo',                     anchors: '1 confused · 5 solid · 10 memorable' },
];

export default function RubricSection() {
  return (
    <div className="space-y-2 text-sm">
      {CRITERIA.map((c) => (
        <div key={c.name} className="rounded-lg border border-ink-300/60 px-3 py-2">
          <div className="font-medium">{c.name}</div>
          <div className="text-xs text-ink-500 font-mono">{c.anchors}</div>
        </div>
      ))}
      <div className="text-xs text-ink-500 pt-1">Skip teams you know personally.</div>
    </div>
  );
}
