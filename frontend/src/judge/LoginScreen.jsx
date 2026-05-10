import { useState } from 'react';
import { judgeApi } from '../lib/api.js';
import BackHome from '../layout/BackHome.jsx';

export default function LoginScreen({ onLoggedIn }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function onChange(e) {
    const digits = (e.target.value || '').replace(/\D/g, '').slice(0, 6);
    setPin(digits);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const boot = await judgeApi.authPin(pin);
      onLoggedIn(boot);
    } catch (e) {
      setErr(e.status === 401 ? 'PIN not recognized. Check with your organizer.' : 'Sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6">
      <div className="max-w-sm mx-auto pt-6"><BackHome /></div>
      <div className="min-h-[80vh] flex items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-2">Judge sign-in</h1>
        <p className="text-sm text-ink-500 text-center mb-6">Enter your 6-digit PIN.</p>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          autoFocus
          autoComplete="one-time-code"
          maxLength={6}
          value={pin}
          onChange={onChange}
          placeholder="••••••"
          className="w-full rounded-xl border border-ink-300 bg-white px-4 py-4 text-2xl tracking-[0.5em] text-center font-mono mb-4 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none"
          required
        />
        {err && <div className="text-sm text-red-600 mb-3 text-center">{err}</div>}
        <button
          type="submit"
          disabled={busy || pin.length !== 6}
          className="w-full rounded-xl bg-ink-900 text-white py-3 font-medium touch-target hover:bg-ink-700 disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      </div>
    </div>
  );
}
