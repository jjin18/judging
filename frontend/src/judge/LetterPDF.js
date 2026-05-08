import { jsPDF } from 'jspdf';

function safeName(s) {
  return (s || 'judge').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'judge';
}

export function downloadJudgeLetterPDF({ judge, event, projects }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 54;

  doc.setLineWidth(1);
  doc.setDrawColor(20, 30, 50);
  doc.rect(18, 18, pageW - 36, pageH - 36);

  let y = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 30, 50);
  doc.text((event?.org_name || 'Organization').toUpperCase(), margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 90, 110);
  const right = [];
  if (event?.org_address) right.push(event.org_address);
  if (event?.org_website) right.push(event.org_website);
  right.forEach((line, i) => doc.text(line, pageW - margin, y + i * 11, { align: 'right' }));

  y += 18;
  doc.setDrawColor(20, 30, 50);
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageW - margin, y);
  doc.setLineWidth(0.4);
  doc.line(margin, y + 3, pageW - margin, y + 3);

  y += 32;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(80, 90, 110);
  doc.text('OFFICIAL JUDGE ACKNOWLEDGMENT', margin, y);

  y += 26;
  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(20, 30, 50);
  const lh = 18;

  doc.text(`Dear ${judge?.name || 'Judge'},`, margin, y);
  y += lh + 4;

  const body = [
    `On behalf of ${event?.org_name || '—'}, we are honored to confirm your participation as an official judge at ${event?.name || 'this event'}${event?.date ? `, held on ${event.date}` : ''}${event?.venue ? ` at ${event.venue}` : ''}${event?.city ? `, ${event.city}` : ''}.`,
    `${judge?.name || 'The judge'} brings expertise in ${judge?.expertise || 'their domain'} to our panel. Over the course of this event, you evaluated ${projects?.length || 0} projects, contributing approximately ${Math.max(1, Math.round(event?.hours_expected || 4))} hours of expert technical review.`,
    `Your assessments directly determine which teams receive awards and recognition. This letter serves as formal documentation suitable for professional portfolios, visa applications (O-1, EB-1), and LinkedIn credentials.`,
  ];

  for (const para of body) {
    const lines = doc.splitTextToSize(para, pageW - margin * 2);
    for (const ln of lines) {
      if (y > pageH - margin - 80) { doc.addPage(); y = margin; }
      doc.text(ln, margin, y);
      y += lh;
    }
    y += 6;
  }

  if (projects?.length) {
    if (y > pageH - margin - 120) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(80, 90, 110);
    doc.text('PROJECTS EVALUATED', margin, y);
    y += 14;
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(20, 30, 50);
    for (const p of projects) {
      const line = `• ${p.title}${p.team_name ? ` — ${p.team_name}` : ''}`;
      const wrapped = doc.splitTextToSize(line, pageW - margin * 2);
      for (const ln of wrapped) {
        if (y > pageH - margin - 80) { doc.addPage(); y = margin; }
        doc.text(ln, margin, y);
        y += 14;
      }
    }
    y += 8;
  }

  if (y > pageH - margin - 80) { doc.addPage(); y = margin; }
  doc.setDrawColor(180, 190, 210);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + 220, y);
  y += 14;
  doc.setFont('times', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20, 30, 50);
  doc.text(`${event?.organizer_name || '—'}${event?.organizer_title ? `, ${event.organizer_title}` : ''}`, margin, y);
  y += 14;
  doc.setTextColor(80, 90, 110);
  doc.text(`${event?.org_name || ''}${event?.date ? ` · ${event.date}` : ''}`, margin, y);

  const filename = `judge_acknowledgment_${safeName(judge?.name)}_${safeName(event?.name)}_${event?.date || ''}.pdf`
    .replace(/__+/g, '_')
    .replace(/_$/g, '');
  doc.save(filename);
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
