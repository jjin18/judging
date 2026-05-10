import { useEffect, useState } from 'react';
import { adminApi } from '../../lib/api.js';

export default function BackupTab({ token }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    adminApi.backupStatus(token).then(setStatus).catch(() => setStatus({ configured: false }));
  }, [token]);

  if (!status) return <div className="text-sm text-ink-500">Loading…</div>;

  if (!status.configured) {
    return (
      <div className="text-sm text-ink-500">
        Sheets backup not configured. Set <code>GOOGLE_SHEETS_CREDENTIALS_JSON</code>,{' '}
        <code>SHEET_ID</code>, and <code>SHEET_TAB_NAME</code> to enable.
      </div>
    );
  }

  return (
    <a
      href={status.sheet_url}
      target="_blank"
      rel="noreferrer"
      className="text-accent-600 hover:underline break-all"
    >
      {status.sheet_url}
    </a>
  );
}
