import { jsPDF } from 'jspdf';

function safeName(s) {
  return (s || 'judge').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'judge';
}

export function downloadMyScoresPDF({ judge, event, projects, scores }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`My scores — ${judge?.name || ''}`, margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 90, 110);
  doc.text(`${event?.name || ''}${event?.date ? ` · ${event.date}` : ''}`, margin, y);
  y += 18;

  doc.setTextColor(20, 30, 50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  const cols = [
    { label: '#',     x: margin,        w: 30 },
    { label: 'Project', x: margin + 30, w: 200 },
    { label: 'Inn', x: margin + 232, w: 30 },
    { label: 'Tech', x: margin + 264, w: 32 },
    { label: 'Imp', x: margin + 298, w: 30 },
    { label: 'Pres', x: margin + 330, w: 32 },
    { label: 'Wtd', x: margin + 364, w: 36 },
  ];
  cols.forEach((c) => doc.text(c.label, c.x, y));
  y += 12;
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  let i = 1;
  for (const p of projects) {
    const s = scores[p.id];
    if (!s) continue;
    if (y > pageH - margin - 30) { doc.addPage(); y = margin; }
    const row = [
      String(i++),
      truncate(`${p.table_number ? p.table_number + ' · ' : ''}${p.title}`, 40),
      fmt(s.innovation), fmt(s.technical), fmt(s.impact), fmt(s.presentation),
      fmt(s.total_weighted),
    ];
    cols.forEach((c, idx) => doc.text(row[idx], c.x, y));
    y += 14;
  }
  doc.save(`my_scores_${safeName(judge?.name)}.pdf`);
}

function fmt(n) { return (n == null ? '' : Number(n).toFixed(1)); }
function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : s; }
