import { useEffect, useMemo, useRef, useState } from 'react';
import TopBar from '../layout/TopBar.jsx';
import LeftPanel from './LeftPanel.jsx';
import ScoringArea from './ScoringArea.jsx';
import { loadScores } from '../lib/db.js';
import { onSyncChange } from '../lib/sync.js';

export default function Dashboard({ profile, initialProjects, initialScores, onLogout }) {
  const [projects, setProjects] = useState(initialProjects || []);
  const [scores, setScores] = useState(scoresMap(initialScores));
  const [activeId, setActiveId] = useState(() => firstUnscored(initialProjects, initialScores) || initialProjects?.[0]?.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scoringRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const all = await loadScores();
      if (!cancelled) setScores(scoresMap(all));
    };
    const off = onSyncChange(refresh);
    const t = setInterval(refresh, 4000);
    return () => { cancelled = true; off(); clearInterval(t); };
  }, []);

  const judge = profile.judge;
  const event = profile.event;
  const judgeId = judge.id;

  const ordered = useMemo(() => {
    return [...projects].sort((a, b) => {
      const an = parseInt(a.table_number || '99999', 10);
      const bn = parseInt(b.table_number || '99999', 10);
      if (an !== bn) return an - bn;
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [projects]);

  const activeIndex = ordered.findIndex((p) => p.id === activeId);
  const activeProject = ordered[activeIndex] || ordered[0];

  function selectProject(id) {
    setActiveId(id);
    setDrawerOpen(false);
    scoringRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function next() {
    const remaining = ordered.slice(activeIndex + 1).find((p) => !scores[p.id]);
    selectProject((remaining || ordered[(activeIndex + 1) % ordered.length])?.id);
  }
  function prev() {
    if (activeIndex > 0) selectProject(ordered[activeIndex - 1].id);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <TopBar
        event={event}
        onMenu={() => setDrawerOpen(true)}
        rightSlot={
          <div className="inline-flex items-center gap-3">
            <a href="/" className="hover:text-ink-900">Home</a>
            <button onClick={onLogout} className="hover:text-ink-900">Sign out</button>
          </div>
        }
      />
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <aside className="hidden md:flex md:w-[320px] lg:w-[360px] shrink-0 border-r border-ink-300/60 bg-white flex-col overflow-hidden">
          <LeftPanel
            judge={judge}
            event={event}
            projects={ordered}
            scores={scores}
            activeId={activeProject?.id}
            onPick={selectProject}
          />
        </aside>
        {drawerOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setDrawerOpen(false)}>
            <div
              className="absolute bottom-0 inset-x-0 max-h-[85vh] bg-white rounded-t-3xl shadow-2xl overflow-hidden flex flex-col safe-bottom"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-ink-300" />
              </div>
              <LeftPanel
                judge={judge}
                event={event}
                projects={ordered}
                scores={scores}
                activeId={activeProject?.id}
                onPick={selectProject}
              />
            </div>
          </div>
        )}
        <main ref={scoringRef} className="flex-1 min-w-0 overflow-y-auto">
          {activeProject ? (
            <ScoringArea
              token={profile.token}
              judgeId={judgeId}
              project={activeProject}
              indexLabel={`${activeIndex + 1} of ${ordered.length}`}
              onPrev={activeIndex > 0 ? prev : null}
              onNext={next}
              onBack={() => setDrawerOpen(true)}
              existingScore={scores[activeProject.id]}
              onScored={(s) => setScores((m) => ({ ...m, [activeProject.id]: s }))}
              allProjects={ordered}
              onJump={selectProject}
            />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="min-h-full flex items-center justify-center p-10">
      <div className="text-center text-sm text-ink-500">
        No projects yet · teams register at <a href="/submit" className="text-accent-600 hover:underline font-medium">/submit</a>
      </div>
    </div>
  );
}

function scoresMap(arr) {
  const m = {};
  for (const s of (arr || [])) m[s.project_id] = s;
  return m;
}

function firstUnscored(projects, scores) {
  const set = new Set((scores || []).map((s) => s.project_id));
  return projects?.find((p) => !set.has(p.id))?.id;
}
