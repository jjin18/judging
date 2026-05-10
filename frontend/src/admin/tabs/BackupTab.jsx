import { useEffect, useState } from 'react';
import { adminApi } from '../../lib/api.js';

export default function BackupTab({ token }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [actionResult, setActionResult] = useState(null);
  const [err, setErr] = useState('');

  async function refresh() {
    try {
      const s = await adminApi.backupStatus(token);
      setStatus(s);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function run(label, fn) {
    setBusy(label); setActionResult(null); setErr('');
    try {
      const r = await fn();
      setActionResult({ label, ...r });
      await refresh();
    } catch (e) {
      setActionResult({ label, ok: false, error: e.message });
    } finally { setBusy(''); }
  }

  if (!status) {
    return <div className="text-sm text-ink-500">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white rounded-2xl border border-ink-300/60 p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Google Sheets backup</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${status.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {status.configured ? 'enabled' : 'not configured'}
          </span>
        </div>

        {status.configured ? (
          <>
            <div className="text-sm">
              <span className="text-ink-500">Live sheet:</span>{' '}
              <a
                href={status.sheet_url}
                target="_blank"
                rel="noreferrer"
                className="text-accent-600 hover:underline break-all"
              >
                {status.sheet_url}
              </a>
              {status.tab && <span className="text-ink-500"> · tab <code className="font-mono">{status.tab}</code></span>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm pt-2">
              <Stat label="Last successful sync" value={fmtTs(status.last_success_ts)} />
              <Stat label="Total scores in DB" value={String(status.total_scores ?? 0)} />
              <Stat label="Pending sync" value={String(status.pending_count ?? 0)}
                emphasize={(status.pending_count ?? 0) > 0} />
              <Stat label="Last error" value={status.last_error || '—'}
                emphasize={!!status.last_error} />
            </div>
          </>
        ) : (
          <div className="text-sm text-ink-700">
            Set <code>GOOGLE_SHEETS_CREDENTIALS_JSON</code>, <code>SHEET_ID</code>, and{' '}
            <code>SHEET_TAB_NAME</code> to enable backup. Service-account email needs Editor
            access on the target spreadsheet.
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-ink-300/60 p-5 flex flex-wrap gap-2">
        <button
          onClick={() => run('test', () => adminApi.testSheets(token))}
          disabled={!status.configured || !!busy}
          className="rounded-xl border border-ink-300 px-4 py-2 text-sm hover:border-accent-500 disabled:opacity-40">
          {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          onClick={() => run('retry', () => adminApi.syncPending(token))}
          disabled={!status.configured || !!busy}
          className="rounded-xl border border-ink-300 px-4 py-2 text-sm hover:border-accent-500 disabled:opacity-40">
          {busy === 'retry' ? 'Retrying…' : `Retry pending (${status.pending_count ?? 0})`}
        </button>
        <button
          onClick={() => run('sync', () => adminApi.syncSheets(token))}
          disabled={!status.configured || !!busy}
          className="rounded-xl bg-ink-900 text-white px-4 py-2 text-sm hover:bg-ink-700 disabled:opacity-40">
          {busy === 'sync' ? 'Syncing…' : 'Sync all to Sheet'}
        </button>
        <button
          onClick={refresh}
          className="ml-auto text-xs text-ink-500 hover:text-ink-900 self-center">
          Refresh
        </button>
      </div>

      {actionResult && (
        <div className={`text-sm rounded-lg border px-3 py-2 ${actionResult.ok === false ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
          {actionResult.ok === false
            ? `✗ ${actionResult.label}: ${actionResult.error || 'failed'}`
            : describeOk(actionResult)}
        </div>
      )}
      {err && <div className="text-sm text-red-600">{err}</div>}
    </div>
  );
}

function describeOk(r) {
  if (r.label === 'sync') {
    return `✓ Synced ${r.total ?? r.rows ?? 0} score rows (${r.appended ?? 0} new, ${r.updated ?? 0} updated)`;
  }
  if (r.label === 'retry') {
    return `✓ Retried ${r.attempted ?? 0}, ${r.succeeded ?? 0} succeeded, ${r.still_pending ?? 0} still pending`;
  }
  if (r.label === 'test') {
    return `✓ Probe row written to "${r.tab ?? ''}"`;
  }
  return '✓';
}

function Stat({ label, value, emphasize }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className={`mt-0.5 ${emphasize ? 'text-amber-700 font-semibold' : 'text-ink-900'} break-words`}>
        {value}
      </div>
    </div>
  );
}

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch { return String(ts); }
}
