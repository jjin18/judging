import { useEffect, useState } from 'react';
import BackHome from '../layout/BackHome.jsx';

const ROBOT_ARM_PRESETS = ['XLeRobot', 'YAM', 'reBot'];

export default function SubmitApp() {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    team_number: '',
    robot_arm_choice: '',       // one of ROBOT_ARM_PRESETS or 'Other'
    robot_arm_other: '',        // free-text when 'Other' is picked
    description: '',
    github_url: '',
    x_post_url: '',
    huggingface_url: '',
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/submit/event')
      .then((r) => r.json())
      .then((d) => setEvent(d.event))
      .catch(() => setEvent(null))
      .finally(() => setLoading(false));
  }, []);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const robotArmValue = form.robot_arm_choice === 'Other'
    ? form.robot_arm_other.trim()
    : form.robot_arm_choice;

  const canSubmit = !busy
    && form.team_number.trim()
    && robotArmValue
    && form.description.trim()
    && form.github_url.trim()
    && form.x_post_url.trim()
    && form.huggingface_url.trim();

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr('');
    try {
      const body = {
        team_number: form.team_number.trim(),
        robot_arm: robotArmValue,
        description: form.description.trim(),
        github_url: form.github_url.trim(),
        x_post_url: form.x_post_url.trim(),
        huggingface_url: form.huggingface_url.trim() || null,
      };
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        try { setErr(JSON.parse(t).detail || t); } catch { setErr(t); }
        return;
      }
      const data = await res.json();
      setResult(data.project);
    } catch (e) {
      setErr(e.message || 'Submission failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 rounded-full border-2 border-accent-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-slate-50 px-6">
        <div className="max-w-lg mx-auto pt-6"><BackHome /></div>
        <div className="min-h-[60vh] flex items-center justify-center text-center">
          <div>
            <h1 className="text-xl font-semibold">No event open for submissions</h1>
            <p className="text-ink-500 text-sm mt-2">Check back once the organizer creates the event.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="max-w-lg mx-auto">
        <div className="mb-4"><BackHome /></div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2 text-center">{event.name}</h1>
        <p className="text-center text-sm text-ink-500 mb-6">
          Only one person per team should submit.
        </p>

        {result ? (
          <Confirmation project={result} />
        ) : (
          <form onSubmit={submit} className="bg-white rounded-2xl border border-ink-300/60 p-6 space-y-4">
            <Field label="Team number" mono required autoFocus
              value={form.team_number} onChange={(v) => set('team_number', v)}
              placeholder="e.g. 12" />

            <RobotArmField
              choice={form.robot_arm_choice}
              other={form.robot_arm_other}
              setChoice={(v) => set('robot_arm_choice', v)}
              setOther={(v) => set('robot_arm_other', v)}
            />

            <TextareaField
              label="Describe your task in one sentence" required
              value={form.description} onChange={(v) => set('description', v)}
              placeholder="The arm picks up a cup and places it on a saucer." />

            <Field label="Github link of your project" required type="url"
              value={form.github_url} onChange={(v) => set('github_url', v)}
              placeholder="https://github.com/your-team/repo" />

            <Field label="X post link" required type="url"
              value={form.x_post_url} onChange={(v) => set('x_post_url', v)}
              placeholder="https://x.com/your-handle/status/…"
              hint="Include #SFPhysicalAIHacks and @makermodsai in your post." />

            <Field label="Hugging Face dataset link" required type="url"
              value={form.huggingface_url} onChange={(v) => set('huggingface_url', v)}
              placeholder="https://huggingface.co/datasets/…" />

            {err && <div className="text-sm text-red-600">{err}</div>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-xl bg-ink-900 text-white py-3 font-medium hover:bg-ink-700 disabled:opacity-40 touch-target"
            >
              {busy ? 'Registering…' : 'Register'}
            </button>
          </form>
        )}

      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, required, mono, hint }) {
  return (
    <label className="block text-sm">
      <span className="text-ink-700 font-medium">{label}{required ? ' *' : ''}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        required={required}
        className={`mt-1 w-full rounded-lg border border-ink-300 px-3 py-2.5 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none ${mono ? 'font-mono' : ''}`}
      />
      {hint && <span className="text-xs text-ink-500 mt-1 block">{hint}</span>}
    </label>
  );
}

function TextareaField({ label, value, onChange, placeholder, required }) {
  return (
    <label className="block text-sm">
      <span className="text-ink-700 font-medium">{label}{required ? ' *' : ''}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        rows={2}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2.5 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none resize-none"
      />
    </label>
  );
}

function RobotArmField({ choice, other, setChoice, setOther }) {
  return (
    <fieldset className="block text-sm">
      <legend className="text-ink-700 font-medium">Robot arm *</legend>
      <div className="mt-1 space-y-1.5">
        {ROBOT_ARM_PRESETS.map((opt) => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="robot_arm"
              value={opt}
              checked={choice === opt}
              onChange={() => setChoice(opt)}
            />
            <span>{opt}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="robot_arm"
            value="Other"
            checked={choice === 'Other'}
            onChange={() => setChoice('Other')}
          />
          <span className="shrink-0">Other:</span>
          <input
            type="text"
            value={other}
            onChange={(e) => { setOther(e.target.value); if (e.target.value && choice !== 'Other') setChoice('Other'); }}
            placeholder="model name"
            className="flex-1 rounded-lg border border-ink-300 px-2 py-1 text-sm focus:border-accent-500 outline-none"
          />
        </label>
      </div>
    </fieldset>
  );
}

function Confirmation({ project }) {
  return (
    <div className="bg-white rounded-2xl border border-ink-300/60 p-6 text-center">
      <div className="inline-flex w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-600 items-center justify-center mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 className="text-lg font-semibold">Registered</h2>
      <div className="mt-4 text-left rounded-xl bg-slate-50 border border-ink-300/60 p-4 text-sm space-y-1">
        <div><b>Team {project.team_name}</b></div>
        {project.robot_arm && <div className="text-ink-500">{project.robot_arm}</div>}
        {project.description && <div className="text-ink-700 italic">"{project.description}"</div>}
        {project.github_url && (
          <a href={project.github_url} target="_blank" rel="noreferrer"
             className="block truncate text-accent-600 hover:underline pt-1">GitHub: {project.github_url}</a>
        )}
        {project.x_post_url && (
          <a href={project.x_post_url} target="_blank" rel="noreferrer"
             className="block truncate text-accent-600 hover:underline">X post: {project.x_post_url}</a>
        )}
        {project.huggingface_url && (
          <a href={project.huggingface_url} target="_blank" rel="noreferrer"
             className="block truncate text-accent-600 hover:underline">Hugging Face: {project.huggingface_url}</a>
        )}
      </div>
    </div>
  );
}
