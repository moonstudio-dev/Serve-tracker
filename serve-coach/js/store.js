/*
 * store.js — persistence. Everything stays on this device.
 *
 * LocalStorage: small preferences (KEYS / prefs).
 * IndexedDB ("serve-coach"): practice sessions, clips, video chunks and movement data.
 *
 * Data model (schemaVersion 1)
 *   sessions  { id, createdAt, endedAt, status: 'active'|'ended', plan, clipCount, ... }
 *   clips     { id, sessionId, seq, createdAt, endedAt, status: 'recording'|'saved'|'interrupted',
 *               side, camera{facing,label}, video{mime,width,height,bitrateRequested,bytes,chunks,durationMs},
 *               poses{frames,format,model,backend,inputMode,fps}, sync{offsetMs,method,measuredAt}, stopReason }
 *   chunks    { clipId, seq, blob }        video in ~2 s pieces, written while recording
 *   poses     { clipId, seq, frames:[{t, kp}] }  t = ms since clip start; kp = 17 × [x/width, y/height, score] or null
 *
 * Cloud-ready choices (see MVP1 feasibility): random UUIDs, schemaVersion on every record,
 * video stored as ordered chunks, keypoints normalised to the recorded frame, soft-delete
 * marker (deletedAt), and owner/sync placeholders. UI code uses only the functions below.
 */

export const KEYS = {
  cfg: 'sc-cfg',       // { hand: 'R'|'L', side: 'deuce'|'ad' }
  spot: 'sc-spot',     // { hand, side, saved: timestamp }
  notes: 'sc-notes',   // string[]
  camera: 'sc-camera', // 'environment' | 'user'
};

export const prefs = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  },
};

/* ------------------------------------------------------------------ IndexedDB basics */
const DB_NAME = 'serve-coach';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;
const BASE = () => ({ schemaVersion: SCHEMA_VERSION, ownerId: 'local', syncState: 'local-only', deletedAt: null });

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        const s = d.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
        const c = d.createObjectStore('clips', { keyPath: 'id' });
        c.createIndex('sessionId', 'sessionId');
        c.createIndex('status', 'status');
        d.createObjectStore('chunks', { keyPath: ['clipId', 'seq'] });
        d.createObjectStore('poses', { keyPath: ['clipId', 'seq'] });
      };
      req.onsuccess = () => {
        const d = req.result;
        d.onversionchange = () => { d.close(); dbPromise = null; };
        resolve(d);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => reject(new Error('Storage is busy in another tab. Close other Serve Coach tabs and try again.'));
    });
  }
  return dbPromise;
}

function tx(stores, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    result = fn(t);
  }));
}
function req2p(r) { return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function getAll(store, query, index) {
  const d = await db();
  const os = d.transaction(store).objectStore(store);
  return req2p((index ? os.index(index) : os).getAll(query));
}
async function get(store, key) {
  const d = await db();
  return req2p(d.transaction(store).objectStore(store).get(key));
}
const range = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const nowIso = () => new Date().toISOString();
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } };

/* ------------------------------------------------------------------ sessions */
export async function createSession(plan = null) {
  const s = { ...BASE(), id: uuid(), createdAt: nowIso(), timeZone: tz(), endedAt: null, status: 'active', plan, clipCount: 0 };
  await tx('sessions', 'readwrite', (t) => t.objectStore('sessions').put(s));
  return s;
}
export async function getSession(id) { return get('sessions', id); }
export async function updateSession(id, changes) {
  return tx('sessions', 'readwrite', (t) => {
    const os = t.objectStore('sessions');
    os.get(id).onsuccess = (e) => { const s = e.target.result; if (s) os.put({ ...s, ...changes }); };
  });
}
export async function endSession(id) { return updateSession(id, { status: 'ended', endedAt: nowIso() }); }
/** Most recent session that hasn't been ended (and isn't deleted), or null. */
export async function getActiveSession() {
  const all = (await getAll('sessions')).filter((s) => s.status === 'active' && !s.deletedAt);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all[0] || null;
}
/** All sessions, newest first, each with its (non-deleted) clips in order. */
export async function listSessions() {
  const [sessions, clips] = await Promise.all([getAll('sessions'), getAll('clips')]);
  const bySession = {};
  clips.filter((c) => !c.deletedAt).forEach((c) => { (bySession[c.sessionId] = bySession[c.sessionId] || []).push(c); });
  return sessions.filter((s) => !s.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({ ...s, clips: (bySession[s.id] || []).sort((a, b) => a.seq - b.seq) }));
}
export async function getSessionClips(sessionId) {
  return (await getAll('clips', sessionId, 'sessionId')).filter((c) => !c.deletedAt).sort((a, b) => a.seq - b.seq);
}

/* ------------------------------------------------------------------ clips */
export async function createClip(sessionId, fields) {
  const existing = await getAll('clips', sessionId, 'sessionId');
  const seq = existing.reduce((m, c) => Math.max(m, c.seq || 0), 0) + 1;
  const clip = {
    ...BASE(), id: uuid(), sessionId, seq, createdAt: nowIso(), endedAt: null, status: 'recording',
    uploadConsent: false, sync: { offsetMs: null, method: null, measuredAt: null }, ...fields,
  };
  await tx(['clips', 'sessions'], 'readwrite', (t) => {
    t.objectStore('clips').put(clip);
    const os = t.objectStore('sessions');
    os.get(sessionId).onsuccess = (e) => { const s = e.target.result; if (s) os.put({ ...s, clipCount: (s.clipCount || 0) + 1 }); };
  });
  return clip;
}
export async function getClip(id) { return get('clips', id); }
export async function updateClip(id, changes) {
  return tx('clips', 'readwrite', (t) => {
    const os = t.objectStore('clips');
    os.get(id).onsuccess = (e) => { const c = e.target.result; if (c) os.put({ ...c, ...changes }); };
  });
}
export function putChunk(clipId, seq, blob) {
  return tx('chunks', 'readwrite', (t) => t.objectStore('chunks').put({ clipId, seq, blob }));
}
export function putPoses(clipId, seq, frames) {
  return tx('poses', 'readwrite', (t) => t.objectStore('poses').put({ clipId, seq, frames }));
}
/** The clip's video as one Blob (chunks joined in order). */
export async function getClipVideo(clip) {
  const chunks = (await getAll('chunks', range(clip.id))).sort((a, b) => a.seq - b.seq);
  return { blob: new Blob(chunks.map((c) => c.blob), { type: (clip.video && clip.video.mime) || 'video/mp4' }), chunks: chunks.length };
}
/** All pose frames for a clip, sorted by time. */
export async function getClipPoses(clipId) {
  const batches = (await getAll('poses', range(clipId))).sort((a, b) => a.seq - b.seq);
  return batches.flatMap((b) => b.frames).sort((a, b) => a.t - b.t);
}
/** Permanently delete a clip with its video and movement data (manual deletion, MVP1). */
export async function deleteClip(clip) {
  await tx(['clips', 'chunks', 'poses', 'sessions'], 'readwrite', (t) => {
    t.objectStore('clips').delete(clip.id);
    t.objectStore('chunks').delete(range(clip.id));
    t.objectStore('poses').delete(range(clip.id));
    const os = t.objectStore('sessions');
    os.get(clip.sessionId).onsuccess = (e) => { const s = e.target.result; if (s) os.put({ ...s, clipCount: Math.max(0, (s.clipCount || 1) - 1) }); };
  });
}
/** Permanently delete a whole session and all its clips. */
export async function deleteSession(sessionId) {
  const clips = await getAll('clips', sessionId, 'sessionId');
  await tx(['clips', 'chunks', 'poses', 'sessions'], 'readwrite', (t) => {
    clips.forEach((c) => {
      t.objectStore('clips').delete(c.id);
      t.objectStore('chunks').delete(range(c.id));
      t.objectStore('poses').delete(range(c.id));
    });
    t.objectStore('sessions').delete(sessionId);
  });
}

/**
 * After a crash or a closed tab, clips can be left in 'recording'. Keep everything that was
 * saved and mark them 'interrupted' (never delete). Returns the number recovered.
 */
export async function recoverUnfinishedClips(exceptClipId = null) {
  const open = (await getAll('clips', 'recording', 'status')).filter((c) => c.id !== exceptClipId);
  for (const c of open) {
    const chunks = await getAll('chunks', range(c.id));
    const frames = await getClipPoses(c.id);
    const bytes = chunks.reduce((n, x) => n + (x.blob ? x.blob.size : 0), 0);
    const lastT = frames.length ? frames[frames.length - 1].t : 0;
    await updateClip(c.id, {
      // A first chunk can be just the file header (Chrome MP4): treat tiny recoveries as empty.
      status: bytes > 10000 ? 'interrupted' : 'interrupted-empty',
      endedAt: c.endedAt || nowIso(),
      stopReason: 'app closed or crashed while recording',
      video: { ...(c.video || {}), bytes, chunks: chunks.length, durationMs: Math.max(lastT, chunks.length * 2000) },
      poses: { ...(c.poses || {}), frames: frames.length },
    });
  }
  return open.length;
}

/* ------------------------------------------------------------------ storage status */
export async function requestPersistentStorage() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; }
}
/**
 * Free space as the browser reports it, plus our own total of saved video (Safari's usage
 * figure is unreliable, WP0). freeMB is null when the browser can't tell.
 */
export async function storageStatus() {
  const clips = (await getAll('clips')).filter((c) => !c.deletedAt);
  const ourMB = clips.reduce((n, c) => n + ((c.video && c.video.bytes) || 0), 0) / 1e6;
  let freeMB = null, persisted = null;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      freeMB = (e.quota - Math.max(e.usage, ourMB * 1e6)) / 1e6;
    }
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (e) { /* unknown */ }
  return { ourMB, freeMB, persisted };
}
