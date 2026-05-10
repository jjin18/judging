const BASE = '';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BASE + path, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text || res.statusText);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const judgeApi = {
  authPin: (pin, event_id = null) => request('/api/judge/auth/pin', { method: 'POST', body: JSON.stringify({ pin, event_id }) }),
  authQr: (token) => request('/api/judge/auth/qr', { method: 'POST', body: JSON.stringify({ token }) }),
  projects: (token) => request('/api/judge/projects', { headers: { Authorization: `Bearer ${token}` } }),
  scores: (token) => request('/api/judge/scores', { headers: { Authorization: `Bearer ${token}` } }),
  postScore: (token, body) => request('/api/judge/scores', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }),
};

export const adminApi = {
  auth: (password) => request('/api/admin/auth', { method: 'POST', body: JSON.stringify({ password }) }),
  events: (t) => request('/api/admin/events', { headers: H(t) }),
  createEvent: (t, body) => request('/api/admin/events', { method: 'POST', headers: H(t), body: JSON.stringify(body) }),
  updateEvent: (t, id, body) => request(`/api/admin/events/${id}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(body) }),
  deleteEvent: (t, id) => request(`/api/admin/events/${id}`, { method: 'DELETE', headers: H(t) }),
  projects: (t, eid) => request(`/api/admin/projects?event_id=${eid}`, { headers: H(t) }),
  createProject: (t, body) => request('/api/admin/projects', { method: 'POST', headers: H(t), body: JSON.stringify(body) }),
  updateProject: (t, id, body) => request(`/api/admin/projects/${id}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(body) }),
  deleteProject: (t, id) => request(`/api/admin/projects/${id}`, { method: 'DELETE', headers: H(t) }),
  importProjects: (t, body) => request('/api/admin/projects/import', { method: 'POST', headers: H(t), body: JSON.stringify(body) }),
  scrape: async (t, event_id, devpost_url, onEvent) => {
    const res = await fetch('/api/admin/projects/scrape', {
      method: 'POST', headers: H(t), body: JSON.stringify({ event_id, devpost_url }),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) try { onEvent(JSON.parse(line)); } catch {}
      }
    }
  },
  judges: (t, eid) => request(`/api/admin/judges?event_id=${eid}`, { headers: H(t) }),
  createJudge: (t, body) => request('/api/admin/judges', { method: 'POST', headers: H(t), body: JSON.stringify(body) }),
  updateJudge: (t, id, body) => request(`/api/admin/judges/${id}`, { method: 'PATCH', headers: H(t), body: JSON.stringify(body) }),
  deleteJudge: (t, id) => request(`/api/admin/judges/${id}`, { method: 'DELETE', headers: H(t) }),
  importJudges: (t, body) => request('/api/admin/judges/import', { method: 'POST', headers: H(t), body: JSON.stringify(body) }),
  judgeQrUrl: (t, id) => `/api/admin/judges/${id}/qr?token=${encodeURIComponent(t)}`,
  qrZipUrl: (t, eid) => `/api/admin/qr/zip?event_id=${eid}&token=${encodeURIComponent(t)}`,
  leaderboard: (t, eid) => request(`/api/admin/leaderboard?event_id=${eid}`, { headers: H(t) }),
  scores: (t, eid) => request(`/api/admin/scores?event_id=${eid}`, { headers: H(t) }),
  testSheets: (t) => request('/api/admin/test-sheets-backup', { method: 'POST', headers: H(t) }),
  syncSheets: (t) => request('/api/admin/sync-sheets', { method: 'POST', headers: H(t) }),
  health: () => request('/api/health'),
};

function H(t) { return { Authorization: `Bearer ${t}` }; }
