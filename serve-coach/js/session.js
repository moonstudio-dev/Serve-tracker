/*
 * session.js — practice-session and clip lifecycle.
 *
 * A practice session holds any number of clips. Each clip: one recording with its own video,
 * timestamped movement data, court side and camera. Stopping a clip saves it and keeps the
 * session open; End practice closes the session.
 *
 *   startClip()  checks storage → creates the clip → starts the recorder
 *   addPose()    called for every tracked frame while recording (ms since clip start)
 *   stopClip()   stops the recorder, writes the last chunk and movement data, finalises the clip
 *
 * No time limit on clips. The only safety stop is storage: recording is refused below
 * MIN_START_MB free, and an active clip is stopped and saved below MIN_RECORDING_MB, or if the
 * browser reports the storage is full. Chunks are saved as they arrive, so memory stays flat.
 */

import * as store from './store.js';
import { ClipRecorder, BITRATE, recordingSupported } from './recorder.js';

export const MIN_START_MB = 200;     // refuse to start below this much free space
export const WARN_START_MB = 500;    // warn below this
export const MIN_RECORDING_MB = 100; // stop and save a running clip below this
const STORAGE_CHECK_MS = 15000;
const MODEL = 'MoveNet SinglePose Lightning (pose-detection 2.1.3)';
const POSE_FORMAT = 'frames: t = ms since clip start; kp = 17 x [x/width, y/height, score] in MoveNet order, or null when no pose';

export class StorageLowError extends Error {
  constructor(freeMB) { super('Not enough storage'); this.name = 'StorageLowError'; this.freeMB = freeMB; }
}

export class PracticeSession {
  constructor() {
    this.session = null;
    this.clip = null;      // clip being recorded
    this.rec = null;       // ClipRecorder
    this.listeners = new Set();
    this.state = 'idle';   // 'idle' | 'starting' | 'recording' | 'stopping'
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, detail) { this.listeners.forEach((fn) => fn(type, detail)); }

  get recording() { return this.state === 'recording'; }
  get elapsedMs() { return this.rec && this.rec.startPerf ? performance.now() - this.rec.startPerf : 0; }

  /** Continue an existing open session (e.g. after a reload). */
  use(session) { this.session = session; this.emit('session', session); }

  async newSession(plan = null) {
    if (this.session && this.session.status === 'active') await store.endSession(this.session.id);
    this.session = await store.createSession(plan);
    this.emit('session', this.session);
    return this.session;
  }

  async endSession() {
    if (this.state !== 'idle') await this.stopClip('practice ended');
    if (this.session) await store.endSession(this.session.id);
    const ended = this.session;
    this.session = null;
    this.emit('session', null);
    return ended;
  }

  /**
   * Start recording a clip.
   *   stream     the live camera MediaStream
   *   meta       { side, tripodPosition: 'behind'|'side', camera: { facing, label }, width, height, backend }
   * Serving side, tripod position and phone camera are separate settings, saved per clip.
   * Returns { warning } when storage is getting low. Throws StorageLowError when too low.
   */
  async startClip(stream, meta) {
    if (this.state !== 'idle') return {};
    if (!recordingSupported()) throw new Error('This browser cannot record video.');
    this.state = 'starting';
    try {
      const st = await store.storageStatus();
      if (st.freeMB !== null && st.freeMB < MIN_START_MB) throw new StorageLowError(st.freeMB);
      const warning = st.freeMB !== null && st.freeMB < WARN_START_MB ? `Storage is getting low (about ${Math.round(st.freeMB)} MB free).` : null;
      if (!this.session) await this.newSession();
      store.requestPersistentStorage(); // best effort; granted on Android, usually not on iPhone

      const clip = await store.createClip(this.session.id, {
        side: meta.side || null,
        tripodPosition: meta.tripodPosition || 'unknown',
        camera: meta.camera || {},
        video: { mime: null, width: meta.width, height: meta.height, orientation: meta.height > meta.width ? 'portrait' : 'landscape', bitrateRequested: BITRATE, bytes: 0, chunks: 0, durationMs: 0 },
        poses: { frames: 0, format: POSE_FORMAT, model: MODEL, backend: meta.backend || '', inputMode: 'full', fps: null },
      });
      this.clip = { ...clip, width: meta.width, height: meta.height, chunkWrites: [], poseBuffer: [], poseSeq: 0, poseFrames: 0, writeErrors: [] };

      this.rec = new ClipRecorder(stream, {
        onChunk: (blob, seq) => this.saveChunk(blob, seq),
        onError: (err) => { this.emit('error', err); this.stopClip('recording error: ' + (err && err.name)); },
        onEnded: (why) => { if (this.state === 'recording') { this.emit('interrupted', why); this.stopClip(why, true); } },
      });
      await this.rec.start();
      await store.updateClip(clip.id, { video: { ...clip.video, mime: this.rec.mime } });
      this.state = 'recording';
      this.storageTimer = setInterval(() => this.checkStorage(), STORAGE_CHECK_MS);
      this.emit('clip-start', this.clip);
      return { warning };
    } catch (e) {
      if (this.clip) { try { await store.deleteClip(this.clip); } catch (x) { /* ignore */ } }
      this.clip = null; this.rec = null; this.state = 'idle';
      throw e;
    }
  }

  saveChunk(blob, seq) {
    const c = this.clip;
    if (!c) return;
    const p = store.putChunk(c.id, seq, blob).catch((err) => {
      c.writeErrors.push(err.name);
      if (err.name === 'QuotaExceededError') { this.emit('storage-full'); this.stopClip('storage full'); }
    });
    c.chunkWrites.push(p);
    this.flushPoses();
  }

  /** Record one tracked frame. kps in video pixels (or null), tGrab = performance.now() of the frame. */
  addPose(kps, tGrab, videoW, videoH) {
    const c = this.clip;
    if (this.state !== 'recording' || !c || !this.rec.startPerf) return;
    const t = tGrab - this.rec.startPerf;
    if (t < 0) return;
    const kp = kps ? kps.flatMap((k) => [+(k.x / videoW).toFixed(4), +(k.y / videoH).toFixed(4), +(k.score || 0).toFixed(3)]) : null;
    c.poseBuffer.push({ t: Math.round(t), kp });
    c.poseFrames++;
  }

  flushPoses() {
    const c = this.clip;
    if (!c || !c.poseBuffer.length) return;
    const frames = c.poseBuffer.splice(0);
    c.chunkWrites.push(store.putPoses(c.id, c.poseSeq++, frames).catch((err) => c.writeErrors.push('poses ' + err.name)));
  }

  async checkStorage() {
    const st = await store.storageStatus();
    if (this.state === 'recording' && st.freeMB !== null && st.freeMB < MIN_RECORDING_MB) {
      this.emit('storage-full');
      this.stopClip('storage almost full');
    }
  }

  /**
   * Stop and save the clip. reason: 'stopped' (normal), or why it was stopped.
   * interrupted = true when the app was backgrounded, closed or failed mid-clip.
   * Resolves with the saved clip record (or null if nothing was recorded).
   */
  async stopClip(reason = 'stopped', interrupted = false) {
    if (this.state === 'idle') return null;
    if (this._stopping) return this._stopping;
    this.state = 'stopping';
    this.emit('clip-stopping');
    this._stopping = (async () => {
      clearInterval(this.storageTimer);
      const c = this.clip;
      const rec = this.rec;
      const stopPerf = performance.now();
      let saved = null;
      try {
      try { await rec.stop(); } catch (e) { /* keep what we have */ }
      this.flushPoses();
      await Promise.all(c.chunkWrites);
      const durationMs = rec.startPerf ? Math.round(stopPerf - rec.startPerf) : 0;
      if (!rec.seq) {
        await store.deleteClip(c); // nothing was recorded
      } else {
        const changes = {
          status: interrupted ? 'interrupted' : 'saved',
          endedAt: new Date().toISOString(),
          stopReason: reason,
          video: { mime: rec.mime, width: c.width, height: c.height, orientation: c.height > c.width ? 'portrait' : 'landscape', bitrateRequested: BITRATE, bytes: rec.bytes, chunks: rec.seq, durationMs },
          poses: { ...c.poses, frames: c.poseFrames, fps: durationMs ? +(c.poseFrames * 1000 / durationMs).toFixed(1) : null },
          writeErrors: c.writeErrors,
        };
        saved = { ...c, ...changes };
        await store.updateClip(c.id, changes);
      }
      } catch (e) {
        // Couldn't write the final details (e.g. storage full). The video and movement already
        // saved stay; the clip is recovered as interrupted on next launch. Never stay stuck.
        this.emit('error', e);
      } finally {
        this.clip = null; this.rec = null; this.state = 'idle'; this._stopping = null;
      }
      this.emit('clip-saved', saved);
      return saved;
    })();
    return this._stopping;
  }
}
