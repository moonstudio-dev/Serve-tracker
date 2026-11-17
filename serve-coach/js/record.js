/*
 * record.js — the Record screen.
 *
 * Live camera + skeleton → Start recording → Stop (clip saved) → change side or camera →
 * next clip … → End practice. Clips belong to the open practice session; a reload offers to
 * continue it. Camera and side are locked while a clip is recording. Leaving the screen or
 * the app (phone locked, app switched) stops and saves the running clip.
 */

import * as store from './store.js';
import { KEYS, prefs } from './store.js';
import { Preview } from './preview.js';
import { PracticeSession, StorageLowError } from './session.js';
import { getPoseInfo } from './pose.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMB = (b) => (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB';
const sideName = (s) => (s === 'ad' ? 'Ad' : s === 'deuce' ? 'Deuce' : '–');
const camName = (c) => (c && c.facing === 'user' ? 'Front' : 'Rear');
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function initRecord({ debug }) {
  const practice = new PracticeSession();
  const preview = new Preview(
    { video: $('recVideo'), canvas: $('recCanvas'), box: $('recBox'), status: $('recStatus'), retry: $('recRetry') },
    { debug, onPoses: onPoses },
  );
  let active = false;           // Record screen showing
  let side = (prefs.get(KEYS.cfg) || {}).side || 'deuce';
  let facing = prefs.get(KEYS.camera) || 'environment';
  let timer = null;
  let interruptedWhileAway = false;
  let lastTrackUpdate = 0;

  /* ---------- tracking indicator (simple and honest) ---------- */
  function onPoses(poses, tGrab, video) {
    const p = poses && poses[0];
    practice.addPose(p ? p.keypoints : null, tGrab, video.videoWidth, video.videoHeight);
    const now = performance.now();
    if (now - lastTrackUpdate < 400) return;
    lastTrackUpdate = now;
    const good = p ? p.keypoints.filter((k) => k.score >= 0.3).length : 0;
    const el = $('recTrack');
    el.textContent = good >= 13 ? 'Tracking your body' : good >= 5 ? 'Tracking part of your body' : 'Not tracking you';
    el.classList.toggle('on', good >= 13);
  }

  /* ---------- messages ---------- */
  function msg(text, kind) {
    const el = $('recMsg');
    el.textContent = text || '';
    el.dataset.kind = kind || '';
    el.hidden = !text;
  }

  /* ---------- side and camera ---------- */
  function paintChoices() {
    document.querySelectorAll('[data-recside]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.recside === side)));
    document.querySelectorAll('[data-reccam]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.reccam === facing)));
    const locked = practice.state !== 'idle';
    document.querySelectorAll('[data-recside],[data-reccam]').forEach((b) => { b.disabled = locked; });
  }
  document.querySelectorAll('[data-recside]').forEach((b) => b.addEventListener('click', () => {
    if (practice.state !== 'idle') return;
    side = b.dataset.recside;
    const cfg = prefs.get(KEYS.cfg) || {};
    prefs.set(KEYS.cfg, { ...cfg, side });
    paintChoices();
  }));
  let switching = false;
  document.querySelectorAll('[data-reccam]').forEach((b) => b.addEventListener('click', async () => {
    if (practice.state !== 'idle' || switching || b.dataset.reccam === facing) return;
    switching = true;                      // debounce: one switch at a time (WP0 finding)
    facing = b.dataset.reccam;
    prefs.set(KEYS.camera, facing);
    paintChoices();
    $('recBtn').disabled = true;
    await preview.start(facing);
    switching = false;
    updateButton();
  }));

  /* ---------- record button ---------- */
  function updateButton() {
    const b = $('recBtn');
    if (practice.state === 'recording') { b.textContent = 'Stop and save clip'; b.disabled = false; b.classList.remove('btn-ball'); b.classList.add('btn-danger'); }
    else if (practice.state === 'starting') { b.textContent = 'Starting…'; b.disabled = true; }
    else if (practice.state === 'stopping') { b.textContent = 'Saving…'; b.disabled = true; }
    else {
      b.textContent = 'Start recording';
      b.classList.add('btn-ball'); b.classList.remove('btn-danger');
      b.disabled = !preview.ready || switching;
    }
    $('recEnd').disabled = practice.state !== 'idle';
    paintChoices();
  }

  async function startClip() {
    msg('');
    const v = $('recVideo');
    if (!preview.ready || !v.videoWidth) { msg('Wait for the camera and tracking to start.', 'error'); return; }
    try {
      const res = await practice.startClip(preview.stream, {
        side, camera: preview.cameraMeta(), width: v.videoWidth, height: v.videoHeight, backend: getPoseInfo().backend.name,
      });
      if (res.warning) msg(res.warning + ' Long clips may not fit.', 'error');
    } catch (e) {
      if (e instanceof StorageLowError) msg(`Not enough free storage to record (about ${Math.max(0, Math.round(e.freeMB))} MB free). Delete old clips or free up space on this device.`, 'error');
      else msg('Recording couldn’t start: ' + (e.message || e.name) + '. Try again.', 'error');
    }
    updateButton();
  }

  async function stopClip(reason = 'stopped', interrupted = false) {
    const saved = await practice.stopClip(reason, interrupted);
    if (saved) {
      const text = `Clip ${saved.seq} saved · ${sideName(saved.side)} · ${fmtTime(saved.video.durationMs)} · ${fmtMB(saved.video.bytes)}`;
      if (!interrupted) msg(text, 'ok');
    }
    return saved;
  }

  $('recBtn').addEventListener('click', () => {
    if (practice.state === 'idle') startClip();
    else if (practice.state === 'recording') stopClip('stopped');
  });

  /* ---------- end practice ---------- */
  $('recEnd').addEventListener('click', async () => {
    if (practice.state !== 'idle') return;
    if (!practice.session) { msg('No practice in progress yet. Record a clip first.', ''); return; }
    const clips = await store.getSessionClips(practice.session.id);
    await practice.endSession();
    const total = clips.reduce((n, c) => n + ((c.video && c.video.durationMs) || 0), 0);
    msg(clips.length ? `Practice ended: ${clips.length} clip${clips.length === 1 ? '' : 's'}, ${fmtTime(total)} recorded. Saved on this device.` : 'Practice ended.', 'ok');
    renderClips();
  });

  /* ---------- practice events ---------- */
  practice.on((type, detail) => {
    if (type === 'clip-start') {
      $('recBadge').hidden = false;
      clearInterval(timer);
      timer = setInterval(() => { $('recBadge').textContent = 'REC ' + fmtTime(practice.elapsedMs); }, 250);
    }
    if (type === 'clip-stopping' || type === 'clip-saved') {
      clearInterval(timer); $('recBadge').hidden = true; $('recBadge').textContent = 'REC 0:00';
    }
    if (type === 'clip-saved' || type === 'session') renderClips();
    if (type === 'storage-full') msg('Storage is almost full, so the clip was stopped and saved.', 'error');
    if (type === 'error') msg('Recording error. The clip was stopped and saved.', 'error');
    updateButton();
  });

  /* ---------- clip list for the open practice ---------- */
  let renderToken = 0;
  async function renderClips() {
    const token = ++renderToken;   // only the latest refresh draws (avoids doubled lists)
    const s = practice.session;
    $('recSession').textContent = s ? `Practice · started ${when(s.createdAt)}` : 'New practice';
    const ul = $('recClips');
    ul.innerHTML = '';
    const clips = s ? await store.getSessionClips(s.id) : [];
    if (token !== renderToken) return;
    ul.innerHTML = '';
    $('recEmpty').hidden = clips.length > 0;
    clips.filter((c) => c.status !== 'recording').forEach((c) => ul.appendChild(clipItem(c)));
  }

  function clipItem(c) {
    const li = document.createElement('li');
    const top = document.createElement('div'); top.className = 'clip-top';
    const title = document.createElement('b'); title.textContent = `Clip ${c.seq} · ${sideName(c.side)}`;
    const meta = document.createElement('span'); meta.className = 'clip-meta';
    meta.textContent = `${camName(c.camera)} camera · ${fmtTime((c.video && c.video.durationMs) || 0)} · ${fmtMB((c.video && c.video.bytes) || 0)}`;
    top.append(title, meta);
    li.appendChild(top);
    if (c.status && c.status.startsWith('interrupted')) {
      const f = document.createElement('span'); f.className = 'clip-flag';
      f.textContent = c.status === 'interrupted-empty' ? 'Interrupted · no video saved' : 'Interrupted · saved up to the interruption';
      li.appendChild(f);
    }
    const actions = document.createElement('div'); actions.className = 'clip-actions';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'btn btn-quiet'; play.textContent = 'Play';
    const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-danger'; del.textContent = 'Delete';
    actions.append(play, del);
    li.appendChild(actions);

    let player = null;
    play.addEventListener('click', async () => {
      if (player) { URL.revokeObjectURL(player.src); player.remove(); player = null; play.textContent = 'Play'; return; }
      const { blob } = await store.getClipVideo(c);
      player = document.createElement('video');
      player.className = 'clip-play'; player.controls = true; player.playsInline = true; player.src = URL.createObjectURL(blob);
      li.appendChild(player);
      play.textContent = 'Close';
      player.play().catch(() => {});
    });
    // Two-step delete: first tap arms it, second tap within 4 s deletes. No browser popup.
    let armTimer = null;
    del.addEventListener('click', async () => {
      if (!del.classList.contains('armed')) {
        del.classList.add('armed'); del.textContent = 'Tap again to delete';
        armTimer = setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete'; }, 4000);
        return;
      }
      clearTimeout(armTimer);
      if (player) URL.revokeObjectURL(player.src);
      await store.deleteClip(c);
      msg(`Clip ${c.seq} deleted.`, '');
      renderClips();
    });
    return li;
  }

  /* ---------- continue an unfinished practice ---------- */
  async function offerResume() {
    if (practice.session) { $('recResume').hidden = true; return; }
    const s = await store.getActiveSession();
    if (!s) { $('recResume').hidden = true; return; }
    const clips = await store.getSessionClips(s.id);
    if (!clips.length) { practice.use(s); $('recResume').hidden = true; return; } // empty: just reuse it
    $('recResumeText').textContent = `You have an unfinished practice from ${new Date(s.createdAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} with ${clips.length} clip${clips.length === 1 ? '' : 's'}.`;
    $('recResume').hidden = false;
    $('recContinue').onclick = () => { practice.use(s); $('recResume').hidden = true; renderClips(); };
    $('recNew').onclick = async () => { await store.endSession(s.id); await practice.newSession(); $('recResume').hidden = true; renderClips(); };
  }

  /* ---------- screen lifecycle ---------- */
  async function enter() {
    active = true;
    paintChoices();
    updateButton();
    await offerResume();
    renderClips();
    if (interruptedWhileAway) { msg('Recording stopped when the app went into the background. The clip was saved.', 'error'); interruptedWhileAway = false; }
    await preview.start(facing);
    updateButton();
  }

  async function leave() {
    active = false;
    if (practice.state === 'recording' || practice.state === 'starting') await stopClip('left the Record screen');
    preview.stop();
    $('recTrack').textContent = 'Camera off'; $('recTrack').classList.remove('on');
  }

  document.addEventListener('visibilitychange', async () => {
    if (!active) return;
    if (document.hidden) {
      if (practice.state === 'recording') { interruptedWhileAway = true; await stopClip('app went to the background', true); }
      preview.stop();
    } else {
      if (interruptedWhileAway) { msg('Recording stopped when the app went into the background. The clip was saved.', 'error'); interruptedWhileAway = false; }
      await preview.start(facing);
      updateButton();
    }
  });
  window.addEventListener('pagehide', () => { if (practice.state === 'recording') practice.stopClip('page closed', true); });

  // Keep the button state in step with the camera becoming ready.
  setInterval(() => { if (active && practice.state === 'idle') updateButton(); }, 500);

  return { enter, leave, preview, practice };
}
