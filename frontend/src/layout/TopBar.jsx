import { useEffect, useState } from 'react';
import { onSyncChange, pendingCount } from '../lib/sync.js';

export default function TopBar({ event, onMenu, rightSlot, leftSlot }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => { const n = await pendingCount(); if (!cancelled) setPending(n); };
    refresh();
    const off = onSyncChange(refresh);
    const t = setInterval(refresh, 3000);
    return () => { cancelled = true; off(); clearInterval(t); };
  }, []);

  let badge;
  if (!online) badge = { dot: 'bg-amber-500', label: pending ? `Offline · ${pending} queued` : 'Offline' };
  else if (pending > 0) badge = { dot: 'bg-amber-500', label: `Syncing · ${pending} left` };
  else badge = { dot: 'bg-emerald-500', label: 'Synced' };

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-ink-300/60">
      <div className="flex items-center gap-3 px-4 py-3">
        {leftSlot ?? (onMenu && (
          <button onClick={onMenu} className="md:hidden touch-target rounded-lg hover:bg-slate-100 -ml-2 px-2" aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/></svg>
          </button>
        ))}
        <div className="min-w-0 flex-1 flex items-center gap-3">
          {event?.logo_path && <img src={event.logo_path} alt="" className="h-7 w-7 rounded object-cover" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{event?.name || 'Judging'}</div>
            {event?.date && <div className="text-xs text-ink-500 truncate">{event.date}{event.venue ? ` · ${event.venue}` : ''}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className={`inline-block w-2 h-2 rounded-full ${badge.dot}`} />
            <span className="hidden sm:inline">{badge.label}</span>
          </div>
          {rightSlot}
        </div>
      </div>
    </header>
  );
}
