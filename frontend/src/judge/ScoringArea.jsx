import { useEffect, useMemo, useRef, useState } from 'react';
import ProjectCard from './ProjectCard.jsx';
import ScoringRubric from './ScoringRubric.jsx';
import { saveScore, enqueueSync } from '../lib/db.js';
import { flushQueue } from '../lib/sync.js';

const WEIGHTS = { innovation: 0.25, technical: 0.25, impact: 0.25, presentation: 0.25 };
const AUTOSAVE_DEBOUNCE_MS = 700;

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
  // 'idle' | 'saving' | 'saved' | 'pending_sync' | 'offline' | 'error'
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Autosave plumbing: arm only after the project's initial hydration is
  // settled, so we don't fire a save just because we restored values from a
  // draft / existingScore.
  const armed = useRef(false);
  const debounceTimer = useRef(null);
  const inflight = useRef(false);
  // Mirror current values into a ref so the project-change cleanup can flush
  // the latest edits (effect cleanups close over stale state otherwise).
  const valuesRef = useRef({ innovation, technical, impact, presentation, notes });
  valuesRef.current = { innovation, technical, impact, presentation, notes };

  // On project change: hydrate from localStorage draft (if present), else the
  // server-confirmed existingScore. On the way out (project changes again, or
  // unmount), flush any pending debounced save so a quick Next click doesn't
  // drop the judge's last edit.
  useEffect(() => {
    setSaveState('idle');
    setSaveError('');
    setDraftRestored(false);
    armed.current = false;
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
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
    if (existingScore) setSaveState('saved');
    // Arm autosave on the next microtask so the field-change effect doesn't
    // misinterpret the hydration writes above as user input.
    const armT = setTimeout(() => { armed.current = true; }, 0);
    const myProjectId = project.id;
    return () => {
      clearTimeout(armT);
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        flushSave({ project_id: myProjectId, ...valuesRef.current });
      }
    };
  }, [project?.id]);

  // Persist every change to localStorage so a tab crash / browser kill never
  // loses input. Also schedule a debounced server save.
  useEffect(() => {
    if (!project?.id || !judgeId) return;
    try {
      localStorage.setItem(draftKey(judgeId, project.id), JSON.stringify({
        innovation, technical, impact, presentation, notes,
      }));
    } catch {}
    if (!armed.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setSaveState((s) => (s === 'error' ? s : 'saving'));
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      flushSave({ project_id: project.id, innovation, technical, impact, presentation, notes });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [judgeId, project?.id, innovation, technical, impact, presentation, notes]);

  const raw = innovation + technical + impact + presentation;
  const weighted = innovation * WEIGHTS.innovation + technical * WEIGHTS.technical + impact * WEIGHTS.impact + presentation * WEIGHTS.presentation;

  function clearDraft(pid) {
    try { localStorage.removeItem(draftKey(judgeId, pid)); } catch {}
    setDraftRestored(false);
  }

  async function flushSave(body) {
    if (!body?.project_id || !judgeId || !token) return;
    if (inflight.current) {
      // Re-arm a follow-up save once the in-flight one finishes.
      debounceTimer.current = setTimeout(() => flushSave(body), AUTOSAVE_DEBOUNCE_MS);
      return;
    }
    inflight.current = true;
    setSaveState('saving');
    setSaveError('');

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
        setSaveError(text || `Save failed (${res.status})`);
        setSaveState('error');
        inflight.current = false;
        return;
      }
    } catch {
      // Network unreachable — fall through to offline queue below.
    }

    if (serverScore) {
      await saveScore(judgeId, { ...serverScore });
      onScored?.(serverScore);
      clearDraft(body.project_id);
      setSaveState(serverScore.sync_status === 'submitted' ? 'saved' : 'pending_sync');
      inflight.current = false;
      return;
    }

    // Offline fallback: persist locally + enqueue. Draft stays so a refresh
    // before the queue flushes still recovers cleanly.
    const optimistic = {
      judge_id: judgeId, project_id: body.project_id,
      innovation: body.innovation, technical: body.technical,
      impact: body.impact, presentation: body.presentation,
      total_raw: body.innovation + body.technical + body.impact + body.presentation,
      total_weighted: body.innovation * WEIGHTS.innovation + body.technical * WEIGHTS.technical + body.impact * WEIGHTS.impact + body.presentation * WEIGHTS.presentation,
      notes: body.notes, updated_at: new Date().toISOString(),
      sync_status: 'pending_sync',
    };
    await saveScore(judgeId, optimistic);
    onScored?.(optimistic);
    await enqueueSync({ token, judgeId, body });
    flushQueue();
    setSaveState('offline');
    inflight.current = false;
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
            Draft restored — your in-progress edits are back.
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
          {saveState === 'error' && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
              {saveError || 'Save failed.'} Your input is saved locally — keep editing and we'll retry.
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="text-xs leading-tight text-ink-500 shrink-0">
              <div>Raw: <span className="text-ink-900 font-medium">{raw.toFixed(1)}/40</span></div>
              <div>Weighted: <span className="text-ink-900 font-medium">{weighted.toFixed(2)}/10</span></div>
            </div>
            <SaveStatusChip state={saveState} />
            <button
              onClick={onNext}
              className="ml-auto flex-1 sm:flex-none sm:px-12 py-3 rounded-xl bg-accent-600 text-white font-semibold touch-target hover:bg-accent-500"
            >
              Next ▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveStatusChip({ state }) {
  const map = {
    idle:         { label: 'Ready',          tone: 'bg-slate-100 text-ink-500',       dot: 'bg-slate-400' },
    saving:       { label: 'Saving…',        tone: 'bg-slate-100 text-ink-700',       dot: 'bg-slate-500 animate-pulse' },
    saved:        { label: 'Saved',          tone: 'bg-emerald-50 text-emerald-700',  dot: 'bg-emerald-500' },
    pending_sync: { label: 'Saved — syncing…', tone: 'bg-amber-50 text-amber-800',    dot: 'bg-amber-500 animate-pulse' },
    offline:      { label: 'Saved offline',  tone: 'bg-amber-50 text-amber-800',      dot: 'bg-amber-500' },
    error:        { label: 'Save failed',    tone: 'bg-red-50 text-red-700',          dot: 'bg-red-500' },
  };
  const s = map[state] || map.idle;
  return (
    <span className={`hidden sm:inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${s.tone}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
