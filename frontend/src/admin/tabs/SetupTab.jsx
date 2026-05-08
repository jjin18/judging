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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <form onSubmit={save} className="bg-white rounded-2xl border border-ink-300/60 p-6 space-y-4">
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

      <div className="bg-white rounded-2xl border border-ink-300/60 p-6">
        <h2 className="text-lg font-semibold mb-3">Letter preview</h2>
        <div className="rounded-xl border border-ink-300/60 bg-slate-50 p-5 text-[13px] leading-6 font-serif">
          <div className="flex items-start justify-between gap-3 pb-2 border-b border-ink-300/60">
            <div className="text-xs uppercase tracking-wider text-ink-500">{form?.org_name || 'Organization'}</div>
            <div className="text-xs text-ink-500 text-right">
              {form?.org_address && <div>{form.org_address}</div>}
              {form?.org_website && <div>{form.org_website}</div>}
            </div>
          </div>
          <div className="pt-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-ink-500 mb-2">Official Judge Acknowledgment</div>
            <p>Dear <b>[Judge Name]</b>,</p>
            <p className="mt-2">
              On behalf of <b>{form?.org_name || '—'}</b>, we are honored to confirm your participation
              as an official judge at <b>{form?.name || '—'}</b>
              {form?.date ? `, held on ${form.date}` : ''}
              {form?.venue ? ` at ${form.venue}` : ''}
              {form?.city ? `, ${form.city}` : ''}.
            </p>
            <p className="mt-2">
              [Judge Name] brings expertise in <b>[Expertise]</b> to our panel.
              You evaluated [N] projects, contributing approximately <b>{Math.max(1, Math.round(form?.hours_expected || 4))}</b> hours of expert technical review.
            </p>
            <div className="mt-4 pt-3 border-t border-ink-300/60 text-[12px] text-ink-500">
              Issued by: <b>{form?.organizer_name || '—'}</b>{form?.organizer_title ? `, ${form.organizer_title}` : ''}
              {form?.org_name ? ` · ${form.org_name}` : ''}{form?.date ? ` · ${form.date}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
