import { useEffect, useMemo, useState } from 'react';
import ProjectCard from './ProjectCard.jsx';
import ScoringRubric from './ScoringRubric.jsx';
import { saveScore, enqueueSync } from '../lib/db.js';
import { flushQueue } from '../lib/sync.js';

const WEIGHTS = { innovation: 0.25, technical: 0.25, impact: 0.25, presentation: 0.25 };

function draftKey(judgeId, projectId) {
  return `score.draft.${judgeId}.${projectId}`;
}

export default function ScoringArea({ token, judgeId, project, indexLabel, onPrev, onNext, onBack, existingScore, onScored, allProjects, onJump }) {
  const initial = existingScore || { innovation: 5, technical: 5, impact: 5, presentation: 5, notes: '' };
  const [innovation, setInnovation] = useState(initial.innovation);
  const [technical, setTechnical] = useState(initial.technical);
  const [impact, setImpact] = useState(initial.impact);
  const [presentation, setPresentation] = useState(initial.presentation);
  const [notes, setNotes] = useState(initial.notes || '');
  const [busy, setBusy] = useState(false);
  // 'idle' | 'submitted' | 'pending_sync' | 'offline' | 'error'
  const [submitState, setSubmitState] = useState('idle');
  const [submitError, setSubmitError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // On project change: try to restore an unsaved draft from localStorage
  // first; otherwise hydrate from the server-confirmed existingScore.
  useEffect(() => {
    setSubmitState('idle');
    setSubmitError('');
    setDraftRestored(false);
    if (!project?.id || !judgeId) return;
    let restored = false;
    try {
      const raw = localStorage.getItem(draftKey(judgeId, project.id));
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d === 'object') {
          setInnovation(d.innovation ?? existingScore?.innovation ?? 5);
          setTechnical(d.technical ?? existingScore?.technical ?? 5);
          setImpact(d.impact ?? existingScore?.impact ?? 5);
          setPresentation(d.presentation ?? existingScore?.presentation ?? 5);
          setNotes(d.notes ?? existingScore?.notes ?? '');
          setDraftRestored(true);
          restored = true;
        }
      }
    } catch {}
    if (!restored) {
      setInnovation(existingScore?.innovation ?? 5);
      setTechnical(existingScore?.technical ?? 5);
      setImpact(existingScore?.impact ?? 5);
      setPresentation(existingScore?.presentation ?? 5);
      setNotes(existingScore?.notes ?? '');
    }
  }, [project?.id]);

  // Persist every change so a tab crash / browser kill never loses input.
  useEffect(() => {
    if (!project?.id || !judgeId) return;
    try {
      localStorage.setItem(draftKey(judgeId, project.id), JSON.stringify({
        innovation, technical, impact, presentation, notes,
      }));
    } catch {}
  }, [judgeId, project?.id, innovation, technical, impact, presentation, notes]);

  const raw = innovation + technical + impact + presentation;
  const weighted = innovation * WEIGHTS.innovation + technical * WEIGHTS.technical + impact * WEIGHTS.impact + presentation * WEIGHTS.presentation;

  function clearDraft() {
    try { localStorage.removeItem(draftKey(judgeId, project.id)); } catch {}
    setDraftRestored(false);
  }

  async function saveAndNext() {
    if (busy) return;
    setBusy(true);
    setSubmitError('');
    const body = { project_id: project.id, innovation, technical, impact, presentation, notes };

    // Try direct, synchronous submit first. The server's response tells us
    // whether the row was also written to Sheets ("submitted") or only the
    // DB ("pending_sync"). Either way the score is durable in the DB before
    // we surface success to the judge.
    let serverScore = null;
    try {
      const res = await fetch('/api/judge/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) serverScore = await res.json();
      else if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => '');
        setSubmitError(text || `Save failed (${res.status})`);
        setSubmitState('error');
        setBusy(false);
        return;  // Keep draft, don't advance.
      }
    } catch {
      // Network unreachable — fall through to offline queue below.
    }

    if (serverScore) {
      await saveScore(judgeId, { ...serverScore });
      onScored?.(serverScore);
      clearDraft();
      setSubmitState(serverScore.sync_status === 'submitted' ? 'submitted' : 'pending_sync');
      setBusy(false);
      setTimeout(() => onNext?.(), 220);
      return;
    }

    // Offline fallback: persist locally + enqueue. Draft stays so a refresh
    // before the queue flushes still recovers cleanly.
    const optimistic = {
      judge_id: judgeId, project_id: project.id,
      innovation, technical, impact, presentation,
      total_raw: raw, total_weighted: weighted,
      notes, updated_at: new Date().toISOString(),
      sync_status: 'pending_sync',
    };
    await saveScore(judgeId, optimistic);
    onScored?.(optimistic);
    await enqueueSync({ token, judgeId, body });
    flushQueue();
    setSubmitState('offline');
    setBusy(false);
  }

  const filteredHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allProjects
      .filter((p) =>
        (p.table_number || '').toLowerCase().includes(q) ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.team_name || '').toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [search, allProjects]);

  return (
    <div className="flex flex-col min-h-full">
      <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur border-b border-ink-300/60">
        <div className="flex items-center gap-1 px-3 py-3">
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden touch-target rounded-lg px-2 text-sm font-medium hover:bg-slate-100 text-ink-700"
              aria-label="Back to project list"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          <button
            onClick={onPrev}
            disabled={!onPrev}
            className="touch-target rounded-lg px-2 sm:px-3 text-sm font-medium hover:bg-slate-100 disabled:opacity-30"
          >
            ◀ Prev
          </button>
          <div className="flex-1 text-center min-w-0 px-2">
            <div className="text-base sm:text-lg font-semibold tracking-tight truncate">{project.title}</div>
            <div className="text-xs text-ink-500 mt-0.5">{indexLabel}</div>
          </div>
          <button
            onClick={onNext}
            className="touch-target rounded-lg px-3 text-sm font-medium hover:bg-slate-100"
          >
            Next ▶
          </button>
          <button
            onClick={() => setShowSearch((v) => !v)}
            className="touch-target rounded-lg px-2 hover:bg-slate-100"
            aria-label="Search"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
          </button>
        </div>
        {showSearch && (
          <div className="px-4 pb-3 relative">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search table # or name"
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-accent-500 outline-none"
            />
            {filteredHits.length > 0 && (
              <ul className="absolute z-30 left-4 right-4 bg-white border border-ink-300 rounded-lg shadow-lg mt-1 max-h-72 overflow-y-auto scrollbar-thin">
                {filteredHits.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => { onJump(p.id); setShowSearch(false); setSearch(''); }}
                      className="w-full px-3 py-2 text-left hover:bg-slate-50 text-sm flex items-center gap-2"
                    >
                      <span className="font-mono text-xs text-ink-500 w-12">{p.table_number || '—'}</span>
                      <span className="truncate">{p.title}</span>
                      <span className="ml-auto text-xs text-ink-500 truncate">{p.team_name || ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 px-4 py-5 max-w-3xl mx-auto w-full pb-32">
        {draftRestored && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 inline-flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            Draft restored — finish and submit to save.
          </div>
        )}
        <ProjectCard project={project} />
        <ScoringRubric
          innovation={innovation} setInnovation={setInnovation}
          technical={technical} setTechnical={setTechnical}
          impact={impact} setImpact={setImpact}
          presentation={presentation} setPresentation={setPresentation}
          notes={notes} setNotes={setNotes}
        />
      </div>

      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-ink-300/60 bg-white safe-bottom">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-col gap-2">
          {submitState === 'error' && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
              {submitError || 'Save failed.'} Your input is saved locally — try again.
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="text-xs leading-tight text-ink-500 shrink-0">
              <div>Raw: <span className="text-ink-900 font-medium">{raw.toFixed(1)}/40</span></div>
              <div>Weighted: <span className="text-ink-900 font-medium">{weighted.toFixed(2)}/10</span></div>
            </div>
            <button
              onClick={saveAndNext}
              disabled={busy}
              className="ml-auto flex-1 sm:flex-none sm:px-12 py-3 rounded-xl bg-accent-600 text-white font-semibold touch-target hover:bg-accent-500 disabled:opacity-60"
            >
              {busy ? 'Saving…'
                : submitState === 'submitted' ? 'Submitted · Next'
                : submitState === 'pending_sync' ? 'Saved — syncing…'
                : submitState === 'offline' ? 'Saved offline · Next'
                : submitState === 'error' ? 'Retry'
                : (existingScore ? 'Update & Submit' : 'Submit')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
