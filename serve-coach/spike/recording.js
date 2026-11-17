/*
 * WP0 recording spike — test page only (serve-coach/spike/).
 *
 * Proves or disproves, on each target browser:
 *   - recording video with MediaRecorder while MoveNet tracks the same camera stream
 *   - saving video in 2 s chunks plus timestamped, normalised keypoints to IndexedDB
 *   - surviving a page reload
 *   - replaying the video with a skeleton synchronised by requestVideoFrameCallback
 * and measures format, resolution, size/bitrate, duration and seeking, FPS impact,
 * orientation/mirroring and the video-to-keypoint time offset.
 *
 * Uses its own database ("serve-coach-spike") so it never touches future app data.
 * Reuses camera.js, pose.js and overlay.js from the app.
 */

import { startCamera, stopCamera, getInfo } from '../js/camera.js';
import { loadMoveNet, getPoseInfo } from '../js/pose.js';
import { SkeletonOverlay } from '../js/overlay.js';

const $ = (id) => document.getElementById(id);
const SPIKE_VERSION = document.documentElement.dataset.version || 'spike';
$('ver').textContent = 'Version ' + SPIKE_VERSION + '.';

const RECORD_SECONDS = 60;
const TIMESLICE_MS = 2000;
const BITRATE = 2_000_000;
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];

/* ------------------------------------------------------------------ report */
const report = {
  spikeVersion: SPIKE_VERSION,
  userAgent: navigator.userAgent,
  screen: { viewport: innerWidth + 'x' + innerHeight, dpr: window.devicePixelRatio },
  apiSupport: {
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    requestVideoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    wakeLock: 'wakeLock' in navigator,
    storageEstimate: !!(navigator.storage && navigator.storage.estimate),
    storagePersist: !!(navigator.storage && navigator.storage.persist),
    mimeSupport: typeof MediaRecorder !== 'undefined'
      ? Object.fromEntries(MIME_CANDIDATES.map((m) => [m, MediaRecorder.isTypeSupported(m)])) : {},
  },
  lastRecording: null,
  replay: null,
  events: [],
};
function note(msg) {
  report.events.push(new Date().toLocaleTimeString() + ' ' + msg);
  renderReport();
}
function renderReport() { $('report').textContent = JSON.stringify(report, null, 1); }
$('copyBtn').addEventListener('click', async () => {
  const text = JSON.stringify(report, null, 1);
  try { await navigator.clipboard.writeText(text); $('copyBtn').textContent = 'Copied'; }
  catch (e) { $('copyBtn').textContent = 'Select the text below'; }
  setTimeout(() => { $('copyBtn').textContent = 'Copy report'; }, 1500);
});

/* ------------------------------------------------------------------ IndexedDB */
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('serve-coach-spike', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('recordings', { keyPath: 'id' });
        d.createObjectStore('chunks', { keyPath: ['recId', 'seq'] });
        d.createObjectStore('poses', { keyPath: ['recId', 'seq'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function put(store, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function getAll(store, range) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store).objectStore(store).getAll(range);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const recRange = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
async function deleteRecording(id) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(['recordings', 'chunks', 'poses'], 'readwrite');
    tx.objectStore('recordings').delete(id);
    tx.objectStore('chunks').delete(recRange(id));
    tx.objectStore('poses').delete(recRange(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function storageLine() {
  if (!navigator.storage || !navigator.storage.estimate) return 'Storage estimate not supported';
  const e = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : 'n/a';
  return `Storage used ${(e.usage / 1e6).toFixed(1)} MB of ${(e.quota / 1e6).toFixed(0)} MB available · persistent: ${persisted}`;
}

/* ------------------------------------------------------------------ live camera + tracking */
const live = $('live');
const liveOverlay = new SkeletonOverlay($('liveCanvas'), live);
let facing = 'environment';
let inputMode = 'full';
let detector = null;
let liveLoopId = 0;
const half = document.createElement('canvas');
const fpsWindow = [];      // per-second FPS samples
let framesThisSecond = 0;
let secondStart = performance.now();
let rec = null;            // active recording state

function pick(attr, val) {
  document.querySelectorAll('[data-' + attr + ']').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === val)));
}
document.querySelectorAll('[data-facing]').forEach((b) => b.addEventListener('click', async () => {
  if (rec) return; // no camera switching while recording
  facing = b.dataset.facing;
  pick('facing', facing);
  await openLive();
}));
document.querySelectorAll('[data-input]').forEach((b) => b.addEventListener('click', () => {
  if (rec) return;
  inputMode = b.dataset.input;
  pick('input', inputMode);
  fpsWindow.length = 0;
}));

async function estimate() {
  const vw = live.videoWidth, vh = live.videoHeight;
  if (inputMode === 'half') {
    const w = Math.round(vw / 2), h = Math.round(vh / 2);
    if (half.width !== w) { half.width = w; half.height = h; }
    half.getContext('2d').drawImage(live, 0, 0, w, h);
    const poses = await detector.estimatePoses(half);
    const p = poses[0];
    if (!p) return null;
    return p.keypoints.map((k) => ({ x: k.x * vw / w, y: k.y * vh / h, score: k.score }));
  }
  const poses = await detector.estimatePoses(live);
  return poses[0] ? poses[0].keypoints : null;
}

function startLiveLoop() {
  const id = ++liveLoopId;
  if (detector && detector.reset) detector.reset();
  async function tick() {
    if (id !== liveLoopId) return;
    if (detector && live.readyState >= 2 && live.videoWidth) {
      const tGrab = performance.now();
      let kps = null;
      try { kps = await estimate(); } catch (e) { note('estimate error ' + e.message); }
      if (id !== liveLoopId) return;
      liveOverlay.draw(kps);
      framesThisSecond++;
      if (rec && rec.started && !rec.stopping) recordPose(tGrab, kps);
    }
    const now = performance.now();
    if (now - secondStart >= 1000) {
      const fps = framesThisSecond * 1000 / (now - secondStart);
      fpsWindow.push(fps); if (fpsWindow.length > 600) fpsWindow.shift();
      if (rec && rec.started) rec.fpsSamples.push(fps);
      framesThisSecond = 0; secondStart = now;
      updateLiveStatus(fps);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function stopLiveLoop() { liveLoopId++; }

function updateLiveStatus(fps) {
  const info = getInfo(live);
  const pi = getPoseInfo();
  let s = `${info.videoWidth}x${info.videoHeight} ${info.facingMode} · model ${pi.backend.name || '-'} · input ${inputMode} · ${fps.toFixed(1)} fps`;
  if (rec && rec.started) {
    const secs = ((performance.now() - rec.startPerf) / 1000).toFixed(0);
    s += `\nREC ${secs}/${RECORD_SECONDS} s · ${rec.chunkCount} chunks · ${(rec.bytes / 1e6).toFixed(1)} MB · ${rec.poseFrames} poses`;
  }
  $('liveStatus').textContent = s;
  $('liveStatus').className = 'status' + (rec && rec.started ? ' rec' : '');
}

async function openLive() {
  stopLiveLoop();
  stopCamera(live);
  liveOverlay.clear();
  $('startBtn').disabled = true;
  $('liveStatus').textContent = 'Starting camera…';
  const res = await startCamera(live, facing);
  if (!res.ok) { $('liveStatus').textContent = res.message || 'Camera failed'; note('camera error ' + res.code); return; }
  // Mirror the LIVE preview for the front camera (selfie view). Recording and replay stay unmirrored.
  $('liveBox').classList.toggle('mirror', res.info.facingMode === 'user' || (facing === 'user' && res.info.facingMode === 'unknown'));
  note(`camera on ${res.info.videoWidth}x${res.info.videoHeight} facing=${res.info.facingMode} (${res.info.request})`);
  $('liveStatus').textContent = 'Loading body tracking…';
  try { detector = await loadMoveNet(); } catch (e) { $('liveStatus').textContent = 'Tracking failed to load: ' + e.message; return; }
  fpsWindow.length = 0;
  startLiveLoop();
  $('startBtn').disabled = false;
}

/* ------------------------------------------------------------------ recording */
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}
function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function recordPose(tGrab, kps) {
  const t = tGrab - rec.startPerf;
  if (t < 0) return;
  const vw = live.videoWidth, vh = live.videoHeight;
  // Normalised 0..1 coordinates in the recorded frame + raw score; null = no pose.
  const kp = kps ? kps.flatMap((k) => [+(k.x / vw).toFixed(4), +(k.y / vh).toFixed(4), +k.score.toFixed(3)]) : null;
  rec.poseBuffer.push({ t: Math.round(t), kp });
  rec.poseFrames++;
}
async function flushPoses() {
  if (!rec || !rec.poseBuffer.length) return;
  const frames = rec.poseBuffer.splice(0);
  const seq = rec.poseSeq++;
  rec.pendingWrites.push(put('poses', { recId: rec.id, seq, frames }).catch((e) => { rec.writeErrors.push('poses: ' + e.name); }));
}

async function startRecording() {
  if (rec) return;
  const mime = pickMime();
  if (mime === null) { note('MediaRecorder not supported'); return; }
  const fpsBefore = avg(fpsWindow.slice(-5));
  let persistResult = 'n/a';
  try { if (navigator.storage && navigator.storage.persist) persistResult = await navigator.storage.persist(); } catch (e) { persistResult = 'error'; }
  let wake = null, wakeResult = 'unsupported';
  try { if ('wakeLock' in navigator) { wake = await navigator.wakeLock.request('screen'); wakeResult = 'granted'; } } catch (e) { wakeResult = 'error: ' + e.name; }
  const estBefore = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;

  let mr;
  try {
    mr = new MediaRecorder(live.srcObject, mime ? { mimeType: mime, videoBitsPerSecond: BITRATE } : { videoBitsPerSecond: BITRATE });
  } catch (e) { note('MediaRecorder create failed: ' + e.name + ' ' + e.message); if (wake) wake.release(); return; }

  const info = getInfo(live);
  rec = {
    id: uuid(), mr, wake, started: false, startPerf: 0, createdAt: new Date().toISOString(),
    requestedMime: mime, facing: info.facingMode === 'unknown' ? facing : info.facingMode,
    width: live.videoWidth, height: live.videoHeight, inputMode,
    chunkSeq: 0, poseSeq: 0, chunkCount: 0, bytes: 0, poseFrames: 0, poseBuffer: [],
    pendingWrites: [], writeErrors: [], writeMs: [], fpsSamples: [], fpsBefore, persistResult, wakeResult,
    storageBefore: estBefore && { usageMB: +(estBefore.usage / 1e6).toFixed(1), quotaMB: +(estBefore.quota / 1e6).toFixed(0) },
    interrupted: false,
  };
  mr.onstart = () => {
    rec.started = true;
    rec.startPerf = performance.now();
    rec.autoStop = setTimeout(() => stopRecording('60 s limit'), RECORD_SECONDS * 1000);
  };
  mr.ondataavailable = (e) => {
    if (!rec || !e.data || !e.data.size) return;
    const seq = rec.chunkSeq++;
    rec.chunkCount++; rec.bytes += e.data.size;
    const t0 = performance.now();
    rec.pendingWrites.push(put('chunks', { recId: rec.id, seq, blob: e.data })
      .then(() => rec.writeMs.push(performance.now() - t0))
      .catch((err) => { rec.writeErrors.push('chunk ' + seq + ': ' + err.name); if (err.name === 'QuotaExceededError') stopRecording('storage full'); }));
    flushPoses();
  };
  mr.onerror = (e) => { note('recorder error ' + (e.error ? e.error.name : '')); stopRecording('recorder error'); };
  mr.onstop = () => finaliseRecording();
  mr.start(TIMESLICE_MS);
  $('startBtn').disabled = true; $('stopBtn').disabled = false;
  document.querySelectorAll('[data-facing],[data-input]').forEach((b) => { b.disabled = true; });
  note(`recording started, mime requested "${mime}", actual "${mr.mimeType}"`);
}

function stopRecording(reason) {
  if (!rec || rec.stopping) return;
  rec.stopping = true;
  rec.stopReason = reason;
  rec.stopPerf = performance.now();
  clearTimeout(rec.autoStop);
  try { if (rec.mr.state !== 'inactive') rec.mr.stop(); else finaliseRecording(); } catch (e) { finaliseRecording(); }
}

async function finaliseRecording() {
  if (!rec || rec.finalising) return;
  rec.finalising = true;
  const r = rec;
  await flushPoses();
  await Promise.all(r.pendingWrites);
  const estAfter = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  const durationMs = Math.round((r.stopPerf || performance.now()) - r.startPerf);
  const meta = {
    id: r.id, schemaVersion: 1, createdAt: r.createdAt, mime: r.mr.mimeType || r.requestedMime,
    requestedMime: r.requestedMime, camera: r.facing, width: r.width, height: r.height,
    bitrateRequested: BITRATE, durationMs, bytes: r.bytes, chunks: r.chunkCount, poseFrames: r.poseFrames,
    poseFormat: 'per frame: t = ms since recording start; kp = 17 x [x/videoWidth, y/videoHeight, score] (MoveNet order) or null',
    model: 'MoveNet SinglePose Lightning (pose-detection 2.1.3)', backend: getPoseInfo().backend.name, inputMode: r.inputMode,
    stopReason: r.stopReason, interrupted: r.interrupted,
  };
  if (r.wake) { try { await r.wake.release(); } catch (e) { /* ignore */ } }
  report.lastRecording = {
    ...meta,
    actualBitrateKbps: durationMs ? Math.round(r.bytes * 8 / durationMs) : null,
    fpsBeforeRecording: +r.fpsBefore.toFixed(1),
    fpsWhileRecording: +avg(r.fpsSamples).toFixed(1),
    fpsWhileRecordingMin: r.fpsSamples.length ? +Math.min(...r.fpsSamples).toFixed(1) : null,
    poseFps: durationMs ? +(r.poseFrames * 1000 / durationMs).toFixed(1) : null,
    chunkWriteMsAvg: +avg(r.writeMs).toFixed(0), chunkWriteMsMax: r.writeMs.length ? Math.round(Math.max(...r.writeMs)) : null,
    writeErrors: r.writeErrors, storagePersistGranted: r.persistResult, wakeLock: r.wakeResult,
    storageBefore: r.storageBefore,
    storageAfter: estAfter && { usageMB: +(estAfter.usage / 1e6).toFixed(1), quotaMB: +(estAfter.quota / 1e6).toFixed(0) },
  };
  // Keep the measurements with the clip so the report is complete after a reload.
  try { await put('recordings', { ...meta, spikeMetrics: report.lastRecording }); }
  catch (e) { r.writeErrors.push('meta: ' + e.name); note('saving metadata failed: ' + e.name); }
  note(`recording saved: ${(r.bytes / 1e6).toFixed(1)} MB, ${r.chunkCount} chunks, ${r.poseFrames} poses, stop: ${r.stopReason}`);
  rec = null;
  $('startBtn').disabled = false; $('stopBtn').disabled = true;
  document.querySelectorAll('[data-facing],[data-input]').forEach((b) => { b.disabled = false; });
  refreshList();
}

$('startBtn').addEventListener('click', startRecording);
$('stopBtn').addEventListener('click', () => stopRecording('manual stop'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && rec) { rec.interrupted = true; stopRecording('page hidden / phone locked'); }
});

/* ------------------------------------------------------------------ saved list */
async function refreshList() {
  const recs = (await getAll('recordings')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ul = $('list');
  ul.innerHTML = '';
  if (!recs.length) { ul.innerHTML = '<li>No saved recordings yet.</li>'; }
  recs.forEach((m) => {
    const li = document.createElement('li');
    const when = new Date(m.createdAt).toLocaleString();
    const text = document.createElement('div');
    text.textContent = `${when} · ${m.camera === 'user' ? 'front' : 'rear'} · ${(m.durationMs / 1000).toFixed(1)} s · ${m.width}x${m.height} · ${(m.bytes / 1e6).toFixed(1)} MB · ${m.mime} · ${m.poseFrames} poses${m.interrupted ? ' · interrupted' : ''}`;
    const row = document.createElement('div'); row.className = 'row';
    const play = document.createElement('button'); play.type = 'button'; play.textContent = 'Replay';
    play.addEventListener('click', () => openReplay(m));
    const del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this test recording permanently?')) return;
      await deleteRecording(m.id); note('deleted ' + m.id); closeReplayIf(m.id); refreshList();
    });
    row.append(play, del); li.append(text, row); ul.appendChild(li);
  });
  $('storageStatus').textContent = await storageLine();
}

/* ------------------------------------------------------------------ replay */
const replay = $('replay');
const replayOverlay = new SkeletonOverlay($('replayCanvas'), replay);
let current = null;   // { meta, frames, url }
let skeletonOn = true;

function closeReplayIf(id) {
  if (current && current.meta.id === id) { replay.pause(); replay.removeAttribute('src'); replay.load(); $('replaySection').hidden = true; current = null; }
}

function waitFor(el, ev, ms = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    el.addEventListener(ev, () => { if (!done) { done = true; clearTimeout(t); resolve(true); } }, { once: true });
  });
}

async function openReplay(meta) {
  // Free the camera and CPU while replaying.
  stopLiveLoop(); stopCamera(live); liveOverlay.clear();
  $('liveStatus').textContent = 'Camera paused for replay. Tap "Back to camera" in the list to restart.';
  $('startBtn').disabled = true;
  if (current && current.url) URL.revokeObjectURL(current.url);
  const chunks = (await getAll('chunks', recRange(meta.id))).sort((a, b) => a.seq - b.seq);
  const poseBatches = (await getAll('poses', recRange(meta.id))).sort((a, b) => a.seq - b.seq);
  const frames = poseBatches.flatMap((b) => b.frames).sort((a, b) => a.t - b.t);
  const blob = new Blob(chunks.map((c) => c.blob), { type: meta.mime });
  const url = URL.createObjectURL(blob);
  current = { meta, frames, url };
  if (meta.spikeMetrics) report.lastRecording = meta.spikeMetrics; // restore after reload
  $('replaySection').hidden = false;
  replay.src = url;
  const r = report.replay = {
    id: meta.id, mime: meta.mime, camera: meta.camera, retrievedChunks: chunks.length, retrievedBytes: blob.size,
    bytesMatchSaved: blob.size === meta.bytes, poseFramesRetrieved: frames.length,
    recordedSize: meta.width + 'x' + meta.height, recordedDurationS: +(meta.durationMs / 1000).toFixed(2),
  };
  const loaded = await waitFor(replay, 'loadedmetadata');
  r.metadataLoaded = loaded;
  r.playerSize = replay.videoWidth + 'x' + replay.videoHeight;
  r.orientationMatchesRecording = replay.videoWidth === meta.width && replay.videoHeight === meta.height;
  r.orientationSwapped = replay.videoWidth === meta.height && replay.videoHeight === meta.width;
  r.durationReportedS = Number.isFinite(replay.duration) ? +replay.duration.toFixed(2) : String(replay.duration);
  r.seekableEndS = replay.seekable.length ? +replay.seekable.end(replay.seekable.length - 1).toFixed(2) : 0;
  $('replayBox').classList.toggle('mirror', $('mirrorBtn').getAttribute('aria-pressed') === 'true');
  renderReport();
  $('replayStatus').textContent = `Player ${r.playerSize}, duration ${r.durationReportedS} s, ${frames.length} poses`;
  drawAt(0);
  startReplaySync();
  $('replaySection').scrollIntoView({ behavior: 'smooth' });
}

function poseAt(tMs, maxGap = 250) {
  const f = current && current.frames;
  if (!f || !f.length) return null;
  let lo = 0, hi = f.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (f[mid].t < tMs) lo = mid + 1; else hi = mid; }
  let best = f[lo];
  if (lo > 0 && Math.abs(f[lo - 1].t - tMs) < Math.abs(best.t - tMs)) best = f[lo - 1];
  return Math.abs(best.t - tMs) <= maxGap ? best : null;
}
function toVideoPx(kp) {
  if (!kp) return null;
  const vw = replay.videoWidth, vh = replay.videoHeight;
  const out = [];
  for (let i = 0; i < 17; i++) out.push({ x: kp[i * 3] * vw, y: kp[i * 3 + 1] * vh, score: kp[i * 3 + 2] });
  return out;
}
function drawAt(tMs) {
  if (!skeletonOn) { replayOverlay.clear(); return; }
  const f = poseAt(tMs);
  replayOverlay.draw(f ? toVideoPx(f.kp) : null);
}
let syncId = 0;
function startReplaySync() {
  const id = ++syncId;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const cb = (now, md) => { if (id !== syncId) return; drawAt(md.mediaTime * 1000); replay.requestVideoFrameCallback(cb); };
    replay.requestVideoFrameCallback(cb);
  } else {
    const loop = () => { if (id !== syncId) return; drawAt(replay.currentTime * 1000); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
replay.addEventListener('seeked', () => drawAt(replay.currentTime * 1000));
replay.addEventListener('pause', () => drawAt(replay.currentTime * 1000));

$('skelBtn').addEventListener('click', () => {
  skeletonOn = !skeletonOn;
  $('skelBtn').setAttribute('aria-pressed', String(skeletonOn));
  $('skelBtn').textContent = skeletonOn ? 'Skeleton on' : 'Skeleton off';
  drawAt(replay.currentTime * 1000);
});
document.querySelectorAll('[data-rate]').forEach((b) => b.addEventListener('click', () => {
  replay.playbackRate = +b.dataset.rate;
  document.querySelectorAll('[data-rate]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (report.replay) { report.replay.slowMotionRateApplied = replay.playbackRate; renderReport(); }
}));
$('mirrorBtn').addEventListener('click', () => {
  const on = $('mirrorBtn').getAttribute('aria-pressed') !== 'true';
  $('mirrorBtn').setAttribute('aria-pressed', String(on));
  $('replayBox').classList.toggle('mirror', on);
});

/* Seek test: jump to several points and time how long each takes. */
$('seekBtn').addEventListener('click', async () => {
  if (!current) return;
  replay.pause();
  const d = Number.isFinite(replay.duration) && replay.duration > 0 ? replay.duration : current.meta.durationMs / 1000;
  const targets = [0.15, 0.5, 0.85, 0.3].map((f) => +(d * f).toFixed(2));
  const results = [];
  for (const t of targets) {
    const t0 = performance.now();
    replay.currentTime = t;
    const ok = await waitFor(replay, 'seeked', 6000);
    results.push({ target: t, landed: +replay.currentTime.toFixed(2), ok, ms: Math.round(performance.now() - t0) });
  }
  report.replay.seekTest = results;
  report.replay.seekAllOk = results.every((x) => x.ok && Math.abs(x.landed - x.target) < 0.5);
  renderReport();
  $('replayStatus').textContent = 'Seek test: ' + results.map((x) => `${x.target}s→${x.landed}s ${x.ok ? 'ok' : 'FAILED'} (${x.ms} ms)`).join(' · ');
});

/*
 * Sync measurement: re-run MoveNet on replayed frames and compare with the keypoints saved
 * live. The time offset (−400…+400 ms) where saved and re-detected poses agree best is the
 * video-to-keypoint offset. Works best if the clip contains movement (e.g. arm swings).
 */
$('syncBtn').addEventListener('click', async () => {
  if (!current || !detector) { $('replayStatus').textContent = 'Load a recording first (and wait for tracking to load).'; return; }
  replay.pause();
  $('replayStatus').textContent = 'Measuring sync… (about 20 seconds)';
  const f = current.frames.filter((x) => x.kp && x.kp.filter((v, i) => i % 3 === 2 && v >= 0.4).length >= 10);
  if (f.length < 10) { $('replayStatus').textContent = 'Not enough well-tracked frames in this clip.'; return; }
  const samples = [];
  const n = 12;
  for (let i = 1; i <= n; i++) samples.push(f[Math.floor((i * f.length) / (n + 1))].t);
  const offsets = []; for (let o = -400; o <= 400; o += 20) offsets.push(o);
  const err = new Array(offsets.length).fill(0), cnt = new Array(offsets.length).fill(0);
  const savedMin = detector.minPoseScore;
  detector.minPoseScore = -1;
  try {
    for (const t of samples) {
      replay.currentTime = t / 1000;
      await waitFor(replay, 'seeked', 6000);
      await new Promise((r) => setTimeout(r, 120));
      detector.reset();
      const p = (await detector.estimatePoses(replay))[0];
      if (!p) continue;
      const vw = replay.videoWidth, vh = replay.videoHeight;
      offsets.forEach((o, j) => {
        const s = poseAt(t + o, 60);
        if (!s || !s.kp) return;
        let e = 0, k = 0;
        for (let i = 0; i < 17; i++) {
          if (p.keypoints[i].score < 0.4 || s.kp[i * 3 + 2] < 0.4) continue;
          e += Math.hypot(p.keypoints[i].x / vw - s.kp[i * 3], p.keypoints[i].y / vh - s.kp[i * 3 + 1]); k++;
        }
        if (k >= 6) { err[j] += e / k; cnt[j]++; }
      });
    }
  } finally { detector.minPoseScore = savedMin; detector.reset(); }
  const mean = err.map((e, j) => (cnt[j] ? e / cnt[j] : Infinity));
  let best = 0; mean.forEach((m, j) => { if (m < mean[best]) best = j; });
  const z = offsets.indexOf(0);
  report.replay.sync = {
    method: 're-detect replay frames and match saved keypoints across −400…+400 ms',
    samples: samples.length,
    bestOffsetMs: offsets[best],
    meanErrorAtBest: +mean[best].toFixed(4), meanErrorAtZero: +mean[z].toFixed(4),
    note: 'error = mean keypoint distance as a fraction of frame size; positive offset = saved keypoints are later than the video',
  };
  renderReport();
  $('replayStatus').textContent = `Sync: best offset ${offsets[best]} ms (error ${(mean[best] * 100).toFixed(2)}% of frame; at 0 ms ${(mean[z] * 100).toFixed(2)}%)`;
});

/* ------------------------------------------------------------------ start */
const back = document.createElement('button');
back.type = 'button'; back.textContent = 'Back to camera';
back.addEventListener('click', () => { closeReplayIf(current && current.meta.id); openLive(); });
$('list').before(back);
renderReport();
refreshList();
openLive();
