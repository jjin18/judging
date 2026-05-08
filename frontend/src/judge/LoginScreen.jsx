import { useState } from 'react';
import { judgeApi } from '../lib/api.js';

export default function LoginScreen({ onLoggedIn }) {
  const [eventId, setEventId] = useState(localStorage.getItem('judge.eventHint') || '1');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const boot = await judgeApi.authPin(Number(eventId), pin.trim());
      localStorage.setItem('judge.eventHint', String(eventId));
      onLoggedIn(boot);
    } catch (e) {
      setErr('Wrong PIN or event. Check with your organizer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-accent-500 text-white items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Judge sign-in</h1>
          <p className="text-ink-500 text-sm mt-1">Scan your QR card or enter your 6-digit PIN.</p>
        </div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Event ID</label>
        <input
          inputMode="numeric"
          value={eventId}
          onChange={(e) => setEventId(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-xl border border-ink-300 bg-white px-4 py-3 text-base mb-3 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none"
          required
        />
        <label className="block text-sm font-medium text-ink-700 mb-1">PIN</label>
        <input
          inputMode="numeric"
          autoFocus
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="••••••"
          className="w-full rounded-xl border border-ink-300 bg-white px-4 py-3 text-2xl tracking-[0.4em] text-center font-mono mb-4 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none"
          required
        />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button
          type="submit"
          disabled={busy || pin.length < 4}
          className="w-full rounded-xl bg-ink-900 text-white py-3 font-medium touch-target hover:bg-ink-700 disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-ink-500 text-center mt-6">No PIN? Find the QR card at the check-in table.</p>
      </form>
    </div>
  );
}
