import { useEffect, useState } from 'react';
import { adminApi } from '../../lib/api.js';

const FIELDS = [
  { key: 'name', label: 'Event name' },
  { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
  { key: 'venue', label: 'Venue' },
  { key: 'city', label: 'City' },
  { key: 'org_name', label: 'Organization' },
  { key: 'org_address', label: 'Org address' },
  { key: 'org_website', label: 'Org website' },
  { key: 'organizer_name', label: 'Organizer name' },
  { key: 'organizer_title', label: 'Organizer title' },
  { key: 'hours_expected', label: 'Expected hours', type: 'number' },
  { key: 'devpost_url', label: 'Devpost gallery URL', placeholder: 'https://your-hackathon.devpost.com', wide: true },
];

export default function SetupTab({ token, event, onSaved }) {
  const [form, setForm] = useState(event);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => { setForm(event); }, [event?.id]);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const payload = { ...form };
      if (payload.hours_expected != null && payload.hours_expected !== '') {
        payload.hours_expected = Number(payload.hours_expected);
      }
      const updated = await adminApi.updateEvent(token, event.id, payload);
      onSaved?.(updated);
      setSavedAt(Date.now());
    } catch (e) {
      setErr(e.message);
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-2xl border border-ink-300/60 p-4 sm:p-6 space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Event details</h2>
        <div className="text-xs text-ink-500">{savedAt ? 'Saved' : ''}</div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className={`block text-sm ${f.wide ? 'sm:col-span-2' : ''}`}>
            <span className="text-ink-700 font-medium">{f.label}</span>
            <input
              type={f.type || 'text'}
              value={form?.[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.placeholder || ''}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 focus:border-accent-500 outline-none"
            />
            {f.key === 'devpost_url' && (
              <span className="text-xs text-ink-500 mt-1 block">
                Pulled and refreshed (60s cache) every time a judge signs in.
              </span>
            )}
          </label>
        ))}
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button type="submit" disabled={saving} className="rounded-xl bg-ink-900 text-white px-5 py-2.5 font-medium hover:bg-ink-700 disabled:opacity-40">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
