import { useEffect, useState } from 'react';
import LoginScreen from './LoginScreen.jsx';
import Dashboard from './Dashboard.jsx';
import { judgeApi } from '../lib/api.js';
import { saveProfile, loadProfile, saveProjects, loadProjects, saveScore, loadScores, clearProfile } from '../lib/db.js';
import { startSyncLoop } from '../lib/sync.js';

const LS_TOKEN = 'judge.token';

export default function JudgeApp() {
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Authoritative session check: sessionStorage. If empty, the tab was
      // closed (or this is a new tab) and the judge must re-enter their PIN.
      // The IndexedDB profile + scores still persist for offline recovery,
      // but they're never used to skip the PIN screen.
      const sessionToken = sessionStorage.getItem(LS_TOKEN);

      if (sessionToken) {
        // Same tab, possibly after a refresh — hydrate fast from IndexedDB,
        // then revalidate against the server.
        const profile = await loadProfile();
        const projects = await loadProjects();
        const scores = await loadScores();
        if (profile?.token === sessionToken && projects?.length) {
          if (!cancelled) setState({ phase: 'in', profile, projects, scores });
          startSyncLoop();
          refreshFromServer(profile.token).catch(() => {});
          return;
        }
        // Token in sessionStorage but no matching profile yet — bootstrap.
        try {
          const boot = await judgeApi.authQr(sessionToken);
          await persistBootstrap(boot);
          if (!cancelled) setState({ phase: 'in', profile: profileFromBoot(boot), projects: boot.projects, scores: boot.scores });
          startSyncLoop();
          return;
        } catch {
          sessionStorage.removeItem(LS_TOKEN);
        }
      }

      if (!cancelled) setState({ phase: 'out' });
    })();
    return () => { cancelled = true; };
  }, []);

  async function refreshFromServer(token) {
    try {
      const [projects, scores] = await Promise.all([judgeApi.projects(token), judgeApi.scores(token)]);
      await saveProjects(projects);
      const profile = await loadProfile();
      const judgeId = profile?.judge?.id;
      if (judgeId) for (const s of scores) await saveScore(judgeId, { ...s, sync_status: 'synced' });
      setState((s) => s.phase === 'in' ? { ...s, projects, scores } : s);
    } catch {}
  }

  async function onLoggedIn(boot) {
    await persistBootstrap(boot);
    startSyncLoop();
    setState({ phase: 'in', profile: profileFromBoot(boot), projects: boot.projects, scores: boot.scores });
  }

  async function onLogout() {
    sessionStorage.removeItem(LS_TOKEN);
    await clearProfile();
    setState({ phase: 'out' });
  }

  if (state.phase === 'loading') return <SplashScreen />;
  if (state.phase === 'out') return <LoginScreen onLoggedIn={onLoggedIn} />;
  return <Dashboard profile={state.profile} initialProjects={state.projects} initialScores={state.scores} onLogout={onLogout} />;
}

function profileFromBoot(boot) {
  return { token: boot.token, judge: boot.judge, event: boot.event };
}

async function persistBootstrap(boot) {
  // sessionStorage, not localStorage: tab close = sign out. Refresh inside
  // the same tab still finds the token and the judge stays in.
  sessionStorage.setItem(LS_TOKEN, boot.token);
  await saveProfile(profileFromBoot(boot));
  await saveProjects(boot.projects || []);
  for (const s of (boot.scores || [])) await saveScore(boot.judge.id, { ...s, sync_status: 'synced' });
}

function SplashScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
        <div className="mt-4 text-ink-500 text-sm">Loading your dashboard…</div>
      </div>
    </div>
  );
}
