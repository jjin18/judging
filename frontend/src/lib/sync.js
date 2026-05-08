import { listQueue, dropQueueItem, bumpQueueItem, saveScore } from './db.js';

let inflight = false;
const listeners = new Set();

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) try { fn(); } catch {}
}

export async function pendingCount() {
  return (await listQueue()).length;
}

export async function flushQueue() {
  if (inflight || !navigator.onLine) return;
  inflight = true;
  try {
    const items = await listQueue();
    items.sort((a, b) => a.queuedAt - b.queuedAt);
    for (const item of items) {
      const ok = await sendOne(item);
      if (ok) {
        await dropQueueItem(item.id);
        notify();
      } else {
        if ((item.retryCount || 0) >= 10) continue;
        await bumpQueueItem(item.id, item);
        break;
      }
    }
  } finally {
    inflight = false;
  }
}

async function sendOne(item) {
  try {
    const res = await fetch('/api/judge/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${item.token}` },
      body: JSON.stringify(item.body),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await saveScore(item.judgeId, { ...data, sync_status: 'synced' });
    return true;
  } catch {
    return false;
  }
}

let timer = null;
export function startSyncLoop() {
  flushQueue();
  if (timer) return;
  timer = setInterval(() => flushQueue(), 20000);
  window.addEventListener('online', flushQueue);
}

export function stopSyncLoop() {
  if (timer) { clearInterval(timer); timer = null; }
  window.removeEventListener('online', flushQueue);
}
