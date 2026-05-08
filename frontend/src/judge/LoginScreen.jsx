import { useState } from 'react';
import { judgeApi } from '../lib/api.js';

export default function LoginScreen({ onLoggedIn }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const boot = await judgeApi.authPin(name.trim());
      onLoggedIn(boot);
    } catch (e) {
      setErr(e.status === 401 ? "Name not recognized. Check with your organizer." : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-6">Judge sign-in</h1>
        <input
          type="text"
          autoFocus
          autoComplete="name"
          autoCapitalize="words"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="w-full rounded-xl border border-ink-300 bg-white px-4 py-4 text-lg text-center mb-4 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none"
          required
        />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button
          type="submit"
          disabled={busy || name.trim().length < 2}
          className="w-full rounded-xl bg-ink-900 text-white py-3 font-medium touch-target hover:bg-ink-700 disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
