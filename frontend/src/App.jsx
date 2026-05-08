import { Routes, Route } from 'react-router-dom';
import JudgeApp from './judge/JudgeApp.jsx';
import AdminApp from './admin/AdminApp.jsx';
import SubmitApp from './submit/SubmitApp.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/judge/*" element={<JudgeApp />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="/submit" element={<SubmitApp />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}

function Landing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Hackathon Judging</h1>
        <p className="mt-2 text-ink-500">Pick your dashboard.</p>
        <div className="mt-8 grid gap-3">
          <a href="/submit" className="block rounded-2xl border border-ink-300 bg-white px-6 py-5 text-left hover:border-accent-500 transition">
            <div className="text-sm uppercase tracking-wider text-ink-500">For Teams</div>
            <div className="text-lg font-medium">/submit</div>
            <div className="text-sm text-ink-500 mt-1">Register your project for judging.</div>
          </a>
          <a href="/judge" className="block rounded-2xl border border-ink-300 bg-white px-6 py-5 text-left hover:border-accent-500 transition">
            <div className="text-sm uppercase tracking-wider text-ink-500">For Judges</div>
            <div className="text-lg font-medium">/judge</div>
            <div className="text-sm text-ink-500 mt-1">Score projects, download your letter.</div>
          </a>
          <a href="/admin" className="block rounded-2xl border border-ink-300 bg-white px-6 py-5 text-left hover:border-accent-500 transition">
            <div className="text-sm uppercase tracking-wider text-ink-500">For Organizers</div>
            <div className="text-lg font-medium">/admin</div>
            <div className="text-sm text-ink-500 mt-1">Manage events, projects, judges.</div>
          </a>
        </div>
      </div>
    </div>
  );
}
