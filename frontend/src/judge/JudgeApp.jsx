import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import LoginScreen from './LoginScreen.jsx';
import Dashboard from './Dashboard.jsx';
import { judgeApi } from '../lib/api.js';
import { saveProfile, loadProfile, saveProjects, loadProjects, saveScore, loadScores, clearProfile } from '../lib/db.js';
import { startSyncLoop } from '../lib/sync.js';

const LS_TOKEN = 'judge.token';

export default function JudgeApp() {
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profile = await loadProfile();
      const projects = await loadProjects();
      const scores = await loadScores();

      if (profile?.token && projects?.length) {
        if (!cancelled) setState({ phase: 'in', profile, projects, scores });
        startSyncLoop();
        refreshFromServer(profile.token).catch(() => {});
        return;
      }

      const qrToken = params.get('token');
      if (qrToken) {
        try {
          const boot = await judgeApi.authQr(qrToken);
          await persistBootstrap(boot);
          setParams({}, { replace: true });
          if (!cancelled) setState({ phase: 'in', profile: profileFromBoot(boot), projects: boot.projects, scores: boot.scores });
          startSyncLoop();
          return;
        } catch {
          // fall through to login
        }
      }

      const lsToken = localStorage.getItem(LS_TOKEN);
      if (lsToken) {
        try {
          const boot = await judgeApi.authQr(lsToken);
          await persistBootstrap(boot);
          if (!cancelled) setState({ phase: 'in', profile: profileFromBoot(boot), projects: boot.projects, scores: boot.scores });
          startSyncLoop();
          return;
        } catch {
          localStorage.removeItem(LS_TOKEN);
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
    localStorage.removeItem(LS_TOKEN);
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
  localStorage.setItem(LS_TOKEN, boot.token);
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
