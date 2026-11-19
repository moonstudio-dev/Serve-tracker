/*
 * recorder.js — video recording of the live camera stream (MediaRecorder).
 *
 * Proven in the WP0 spike on iPhone Safari, Android Chrome and desktop Chrome:
 *   - MP4 / H.264 is supported for recording on all three; WebM only as a fallback.
 *   - ~2 Mbit/s, delivered in 2 s chunks, handed to the caller to save straight away
 *     (keeps memory flat and means an interrupted clip keeps everything up to that point).
 *   - Recording the same stream the tracker reads does not slow tracking.
 *   - Screen Wake Lock is held while recording so the phone doesn't lock mid-clip.
 */

export const TIMESLICE_MS = 2000;
const START_TIMEOUT_MS = 6000;
const STOP_TIMEOUT_MS = 4000;
export const BITRATE = 2_000_000;
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4',
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
];

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined';
}
export function pickMime() {
  if (!recordingSupported()) return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

/**
 * Records one clip from a MediaStream.
 *   onChunk(blob, seq)  each ~2 s piece, in order
 *   onStart(startPerf)  performance.now() when recording actually began (pose timestamps use this)
 *   onError(error)
 *   onEnded(reason)     recording ended without stop() (camera taken by another app, call, etc.)
 * stop() resolves after the last chunk has been delivered, or after a few seconds if the browser
 * never reports the end (seen when a phone backgrounds the page mid-recording).
 */
export class ClipRecorder {
  constructor(stream, { onChunk, onStart, onError, onEnded } = {}) {
    this.onEnded = onEnded || (() => {});
    this.stopRequested = false;
    this.stream = stream;
    this.onChunk = onChunk || (() => {});
    this.onStart = onStart || (() => {});
    this.onError = onError || (() => {});
    this.seq = 0;
    this.bytes = 0;
    this.startPerf = 0;
    this.wake = null;
    this.mr = null;
    this._stopped = null;
  }

  async start() {
    const mime = pickMime();
    if (mime === null) throw new Error('This browser cannot record video.');
    try { if ('wakeLock' in navigator) this.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not critical */ }
    const opts = mime ? { mimeType: mime, videoBitsPerSecond: BITRATE } : { videoBitsPerSecond: BITRATE };
    const mr = new MediaRecorder(this.stream, opts);
    this.mr = mr;
    this.requestedMime = mime;
    this._stopped = new Promise((resolve) => {
      mr.onstop = () => { resolve(); if (!this.stopRequested) this.onEnded('recording stopped by the browser'); };
    });
    // Camera track ended (another app or a call took the camera): recording can't continue.
    this._trackEnded = () => { if (!this.stopRequested) this.onEnded('camera stopped'); };
    this.stream.getVideoTracks().forEach((t) => t.addEventListener('ended', this._trackEnded));
    const started = new Promise((resolve, reject) => {
      mr.onstart = () => { this.startPerf = performance.now(); this.onStart(this.startPerf); resolve(); };
      mr.onerror = (e) => { const err = e.error || new Error('Recording failed'); this.onError(err); reject(err); };
      setTimeout(() => reject(new Error('Recording did not start. Please try again.')), START_TIMEOUT_MS);
    });
    mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      this.bytes += e.data.size;
      this.onChunk(e.data, this.seq++);
    };
    mr.start(TIMESLICE_MS);
    await started;
  }

  get mime() { return (this.mr && this.mr.mimeType) || this.requestedMime || ''; }
  get recording() { return !!this.mr && this.mr.state === 'recording'; }

  /** Stop and wait for the final chunk. Safe to call more than once. */
  async stop() {
    this.stopRequested = true;
    if (this.mr && this.mr.state !== 'inactive') {
      try { this.mr.stop(); } catch (e) { /* already stopping */ }
    }
    if (this._stopped) await Promise.race([this._stopped, new Promise((r) => setTimeout(r, STOP_TIMEOUT_MS))]);
    if (this.stream) this.stream.getVideoTracks().forEach((t) => t.removeEventListener('ended', this._trackEnded));
    if (this.wake) { try { await this.wake.release(); } catch (e) { /* ignore */ } this.wake = null; }
  }
}
