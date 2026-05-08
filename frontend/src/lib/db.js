import { openDB } from 'idb';

const DB_NAME = 'judging-v1';
const DB_VERSION = 1;

let _db;
export function db() {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('scores')) {
          d.createObjectStore('scores'); // key: `${judgeId}_${projectId}`
        }
        if (!d.objectStoreNames.contains('projects')) {
          d.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('judgeProfile')) {
          d.createObjectStore('judgeProfile'); // key: 'current'
        }
        if (!d.objectStoreNames.contains('syncQueue')) {
          d.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return _db;
}

export async function saveProfile(profile) {
  const d = await db();
  await d.put('judgeProfile', profile, 'current');
}

export async function loadProfile() {
  const d = await db();
  return (await d.get('judgeProfile', 'current')) || null;
}

export async function clearProfile() {
  const d = await db();
  await d.delete('judgeProfile', 'current');
}

export async function saveProjects(projects) {
  const d = await db();
  const tx = d.transaction('projects', 'readwrite');
  await tx.store.clear();
  for (const p of projects) await tx.store.put(p);
  await tx.done;
}

export async function loadProjects() {
  const d = await db();
  return await d.getAll('projects');
}

export function scoreKey(judgeId, projectId) {
  return `${judgeId}_${projectId}`;
}

export async function saveScore(judgeId, score) {
  const d = await db();
  await d.put('scores', score, scoreKey(judgeId, score.project_id));
}

export async function loadScores() {
  const d = await db();
  return await d.getAll('scores');
}

export async function loadScore(judgeId, projectId) {
  const d = await db();
  return await d.get('scores', scoreKey(judgeId, projectId));
}

export async function enqueueSync(item) {
  const d = await db();
  return await d.add('syncQueue', { ...item, retryCount: 0, queuedAt: Date.now() });
}

export async function listQueue() {
  const d = await db();
  return await d.getAll('syncQueue');
}

export async function dropQueueItem(id) {
  const d = await db();
  await d.delete('syncQueue', id);
}

export async function bumpQueueItem(id, item) {
  const d = await db();
  await d.put('syncQueue', { ...item, retryCount: (item.retryCount || 0) + 1 });
}
