/*
 * replay.js — the Replay screen (MVP1 Stage B).
 *
 * Plays a saved clip with its recorded skeleton drawn on top, in sync. Each video frame is
 * drawn with requestVideoFrameCallback (falls back to requestAnimationFrame) using the
 * frame's own media time, so slow motion, pausing and seeking stay aligned.
 *
 * Sync: browsers start the video file slightly before or after our pose clock (WP0: iPhone
 * ≈0 ms, Android Chrome ≈−350 ms, desktop Chrome ≈−440 ms). On a clip's first replay we
 * measure its own offset: re-run MoveNet on a few replayed frames and find the time shift
 * where the saved keypoints match best. The result is saved on the clip (clip.sync) and used
 * from then on. If it can't be measured, a per-browser default is used.
 *
 * Mirror only flips the picture (video + skeleton), never the controls. Recordings are
 * stored unmirrored.
 */

import * as store from './store.js';
import { SkeletonOverlay } from './overlay.js';
import { estimateFrame } from './pose.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMB = (b) => (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB';
const sideName = (s) => (s === 'ad' ? 'Ad' : s === 'deuce' ? 'Deuce' : '–');
const camName = (c) => (c && c.facing === 'user' ? 'Front' : 'Rear');

const SEARCH_MS = 1500, STEP_MS = 20, SAMPLES = 10;

/** Fallback offsets measured in WP0, by browser. */
export function defaultOffsetMs() {
  const ua = navigator.userAgent;
  const safari = /Safari/.test(ua) && !/Chrome|CriOS|Android/.test(ua);
  if (safari || /iPhone|iPad/.test(ua)) return 0;
  if (/Android/.test(ua)) return -350;
  if (/Chrome/.test(ua)) return -440;
  return 0;
}

function waitFor(el, ev, ms = 6000) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    el.addEventListener(ev, () => { if (!done) { done = true; clearTimeout(t); resolve(true); } }, { once: true });
  });
}

export function initReplay({ onDeleted } = {}) {
  const video = $('rpVideo');
  const overlay = new SkeletonOverlay($('rpCanvas'), video);
  let clip = null, frames = [], url = null, offsetMs = 0;
  let skeletonOn = true, mirrorOn = false, calibrating = false, syncId = 0, openToken = 0;
  let wantedId = null;

  /* ---------- pose lookup and drawing ---------- */
  function poseAt(tMs, maxGap = 250) {
    if (!frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (frames[mid].t < tMs) lo = mid + 1; else hi = mid; }
    let best = frames[lo];
    if (lo > 0 && Math.abs(frames[lo - 1].t - tMs) < Math.abs(best.t - tMs)) best = frames[lo - 1];
    return Math.abs(best.t - tMs) <= maxGap ? best : null;
  }
  function toVideoPx(kp) {
    const vw = video.videoWidth, vh = video.videoHeight, out = [];
    for (let i = 0; i < 17; i++) out.push({ x: kp[i * 3] * vw, y: kp[i * 3 + 1] * vh, score: kp[i * 3 + 2] });
    return out;
  }
  function drawAt(tMs) {
    if (!skeletonOn || calibrating || !video.videoWidth) { overlay.clear(); return; }
    const f = poseAt(tMs + offsetMs);
    overlay.draw(f && f.kp ? toVideoPx(f.kp) : null);
  }
  function startSync() {
    const id = ++syncId;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const cb = (now, md) => { if (id !== syncId) return; drawAt(md.mediaTime * 1000); updateTime(); video.requestVideoFrameCallback(cb); };
      video.requestVideoFrameCallback(cb);
    } else {
      const loop = () => { if (id !== syncId) return; drawAt(video.currentTime * 1000); updateTime(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }
  const redraw = () => { drawAt(video.currentTime * 1000); updateTime(); };
  video.addEventListener('seeked', redraw);
  video.addEventListener('pause', () => { redraw(); $('rpPlay').textContent = 'Play'; });
  video.addEventListener('play', () => { $('rpPlay').textContent = 'Pause'; });
  video.addEventListener('ended', () => { $('rpPlay').textContent = 'Play'; });

  /* ---------- time and seek ---------- */
  const duration = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : ((clip && clip.video && clip.video.durationMs) || 0) / 1000);
  let dragging = false;
  function updateTime() {
    const d = duration();
    $('rpTime').textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
    if (!dragging && d) $('rpSeek').value = String(Math.round((video.currentTime / d) * 1000));
  }
  $('rpSeek').addEventListener('input', () => { dragging = true; const d = duration(); if (d) video.currentTime = (+$('rpSeek').value / 1000) * d; });
  $('rpSeek').addEventListener('change', () => { dragging = false; });
  $('rpPlay').addEventListener('click', () => {
    if (calibrating) return;
    if (video.paused) { if (video.ended) video.currentTime = 0; video.play().catch(() => {}); } else video.pause();
  });
  document.querySelectorAll('[data-rpstep]').forEach((b) => b.addEventListener('click', () => {
    video.pause();
    video.currentTime = Math.min(duration(), Math.max(0, video.currentTime + (+b.dataset.rpstep)));
  }));
  document.querySelectorAll('[data-rprate]').forEach((b) => b.addEventListener('click', () => {
    video.playbackRate = +b.dataset.rprate;
    document.querySelectorAll('[data-rprate]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('rpSkel').addEventListener('click', () => {
    skeletonOn = !skeletonOn;
    $('rpSkel').setAttribute('aria-pressed', String(skeletonOn));
    redraw();
  });
  $('rpMirror').addEventListener('click', () => {
    mirrorOn = !mirrorOn;
    $('rpMirror').setAttribute('aria-pressed', String(mirrorOn));
    $('rpBox').classList.toggle('mirror', mirrorOn);
  });

  /* ---------- sync calibration (first replay of a clip) ---------- */
  async function calibrate(token) {
    const good = frames.filter((x) => x.kp && x.kp.filter((v, i) => i % 3 === 2 && v >= 0.4).length >= 10);
    if (good.length < 15) return { offsetMs: defaultOffsetMs(), method: 'default', reason: 'not enough tracked movement' };
    const samples = [];
    for (let i = 1; i <= SAMPLES; i++) samples.push(good[Math.floor((i * good.length) / (SAMPLES + 1))].t);
    const offsets = []; for (let o = -SEARCH_MS; o <= SEARCH_MS; o += STEP_MS) offsets.push(o);
    const err = new Array(offsets.length).fill(0), cnt = new Array(offsets.length).fill(0);
    let used = 0;
    for (const [n, t] of samples.entries()) {
      if (token !== openToken) return null;
      $('rpStatus').textContent = `Aligning skeleton with the video… ${Math.round((n / samples.length) * 100)}%`;
      video.currentTime = t / 1000;
      await waitFor(video, 'seeked');
      await new Promise((r) => setTimeout(r, 100));
      const p = await estimateFrame(video);
      if (!p) continue;
      used++;
      const vw = video.videoWidth, vh = video.videoHeight;
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
    const mean = err.map((e, j) => (cnt[j] >= 3 ? e / cnt[j] : Infinity));
    let best = 0; mean.forEach((m, j) => { if (m < mean[best]) best = j; });
    const zero = offsets.indexOf(0);
    if (!Number.isFinite(mean[best]) || Math.abs(offsets[best]) >= SEARCH_MS) {
      return { offsetMs: defaultOffsetMs(), method: 'default', reason: 'measurement unclear', samples: used };
    }
    return {
      offsetMs: offsets[best], method: 'measured', samples: used,
      errorAtBest: +mean[best].toFixed(4), errorAtZero: Number.isFinite(mean[zero]) ? +mean[zero].toFixed(4) : null,
    };
  }

  /* ---------- open / close ---------- */
  function setControls(on) {
    ['rpPlay', 'rpSeek', 'rpSkel', 'rpMirror', 'rpDelete'].forEach((id) => { $(id).disabled = !on; });
    document.querySelectorAll('[data-rprate],[data-rpstep]').forEach((b) => { b.disabled = !on; });
  }

  function info(c) {
    const dl = $('rpInfo');
    dl.innerHTML = '';
    const sync = c.sync && c.sync.offsetMs != null
      ? (c.sync.method === 'measured' ? `Aligned (${c.sync.offsetMs} ms)` : `Standard alignment (${c.sync.offsetMs} ms)`)
      : 'Not aligned yet';
    const rows = [
      ['Recorded', new Date(c.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })],
      ['Court side', sideName(c.side)],
      ['Camera', camName(c.camera)],
      ['Length', fmtTime(Math.round(((c.video && c.video.durationMs) || 0) / 1000))],
      ['Size', fmtMB((c.video && c.video.bytes) || 0) + ` · ${(c.video && c.video.width) || '?'}×${(c.video && c.video.height) || '?'}`],
      ['Movement', `${(c.poses && c.poses.frames) || frames.length} frames${c.poses && c.poses.fps ? ` · ${c.poses.fps} per second` : ''}`],
      ['Skeleton sync', sync],
    ];
    if (c.status && c.status.startsWith('interrupted')) rows.push(['Note', 'Interrupted: ' + (c.stopReason || 'saved up to the interruption')]);
    rows.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); });
  }

  function release() {
    syncId++;
    video.pause();
    video.removeAttribute('src'); video.load();
    if (url) URL.revokeObjectURL(url);
    url = null; overlay.clear();
  }

  async function enter() {
    const token = ++openToken;
    release();
    calibrating = false;
    setControls(false);
    $('rpStatus').textContent = 'Loading clip…';
    $('rpStatus').dataset.kind = '';
    clip = wantedId ? await store.getClip(wantedId) : null;
    if (token !== openToken) return;
    if (!clip) { location.hash = '#progress'; return; }
    $('rpTitle').textContent = `Clip ${clip.seq} · ${sideName(clip.side)} · ${camName(clip.camera)}`;
    const [{ blob }, f] = await Promise.all([store.getClipVideo(clip), store.getClipPoses(clip.id)]);
    if (token !== openToken) return;
    frames = f;
    info(clip);
    if (!blob.size) { $('rpStatus').textContent = 'No video was saved for this clip (it was interrupted before any video was written).'; $('rpDelete').disabled = false; return; }
    url = URL.createObjectURL(blob);
    video.src = url;
    video.playbackRate = 1;
    document.querySelectorAll('[data-rprate]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.rprate === '1')));
    // Mirror defaults to how the player saw themselves while recording (front camera).
    mirrorOn = !!(clip.camera && clip.camera.facing === 'user');
    $('rpMirror').setAttribute('aria-pressed', String(mirrorOn));
    $('rpBox').classList.toggle('mirror', mirrorOn);
    const ok = await waitFor(video, 'loadedmetadata', 8000);
    if (token !== openToken) return;
    if (!ok) { $('rpStatus').textContent = 'This video couldn’t be opened on this browser.'; $('rpStatus').dataset.kind = 'error'; $('rpDelete').disabled = false; return; }

    offsetMs = clip.sync && clip.sync.offsetMs != null ? clip.sync.offsetMs : defaultOffsetMs();
    if (!frames.length) {
      $('rpStatus').textContent = 'No movement data was saved for this clip, so there is no skeleton.';
    } else if (!clip.sync || clip.sync.offsetMs == null) {
      calibrating = true; overlay.clear();
      let result = null;
      try { result = await calibrate(token); } catch (e) { result = null; }
      if (token !== openToken) return;
      calibrating = false;
      if (result) {
        offsetMs = result.offsetMs;
        const sync = { ...result, measuredAt: new Date().toISOString() };
        await store.updateClip(clip.id, { sync });
        clip = { ...clip, sync };
        info(clip);
        $('rpStatus').textContent = result.method === 'measured' ? 'Skeleton aligned with the video.' : 'Skeleton shown with standard alignment.';
      } else {
        $('rpStatus').textContent = 'Skeleton shown with standard alignment (body tracking unavailable to fine-tune it).';
      }
      video.currentTime = 0;
      await waitFor(video, 'seeked', 3000);
    } else {
      $('rpStatus').textContent = '';
    }
    if (token !== openToken) return;
    setControls(true);
    startSync();
    redraw();
  }

  function leave() { openToken++; calibrating = false; release(); }

  /* ---------- delete (two taps, no browser popup) ---------- */
  let armTimer = null;
  $('rpDelete').addEventListener('click', async () => {
    const b = $('rpDelete');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed'); b.textContent = 'Tap again to delete this clip';
      armTimer = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Delete clip'; }, 4000);
      return;
    }
    clearTimeout(armTimer); b.classList.remove('armed'); b.textContent = 'Delete clip';
    if (!clip) return;
    const gone = clip;
    leave();
    await store.deleteClip(gone);
    if (onDeleted) onDeleted(gone);
    location.hash = document.querySelector('.rp-back').getAttribute('href') || '#progress';
  });

  return {
    open(clipId, from = 'progress') {
      wantedId = clipId;
      const back = document.querySelector('.rp-back');
      back.href = '#' + from;
      back.textContent = from === 'record' ? '‹ Back to recording' : '‹ Video recordings';
      if (location.hash === '#replay') enter(); else location.hash = '#replay';
    },
    hasClip: () => !!wantedId,
    enter, leave,
  };
}
