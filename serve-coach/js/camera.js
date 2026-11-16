/*
 * camera.js — camera permission and stream lifecycle.
 *
 * - One stream at a time: startCamera() reuses a live stream instead of opening another.
 * - Rear camera by default (facingMode "environment"), never mirrored.
 *   If no rear camera is available, the browser falls back to another camera
 *   and we report it, so the UI can explain.
 * - Asks for a portrait-shaped picture when the screen is portrait. Some browsers honour
 *   this (iPhone Safari), others return landscape (often Android Chrome). We never assume:
 *   callers must read the real size from the video element / getInfo().
 * - stopCamera() stops every track, which turns the camera (and its indicator light) off.
 * - Errors come back as a plain-English message instead of alert().
 */

let stream = null;
let pending = null;    // an in-flight getUserMedia request, shared by concurrent callers
let generation = 0;    // bumped by stopCamera so a late-arriving stream is discarded

function isPortraitScreen() {
  return window.matchMedia ? window.matchMedia('(orientation: portrait)').matches : window.innerHeight >= window.innerWidth;
}

function constraints() {
  const portrait = isPortraitScreen();
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: portrait ? 720 : 1280 },
      height: { ideal: portrait ? 1280 : 720 },
    },
  };
}

const MESSAGES = {
  NotAllowedError: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.',
  SecurityError: 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.',
  NotFoundError: 'No camera was found on this device.',
  OverconstrainedError: 'This camera can’t provide a suitable picture.',
  NotReadableError: 'The camera is busy. Close other apps or tabs using the camera, then try again.',
  AbortError: 'The camera couldn’t start. Try again.',
};

export function isCameraActive() {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
}

async function openStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints());
  } catch (error) {
    // Very old or unusual devices can reject the size request: retry with any camera.
    if (error && error.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw error;
  }
}

/**
 * Start (or reuse) the camera and attach it to videoEl.
 * Returns { ok: true, info } or { ok: false, code, message }.
 */
export async function startCamera(videoEl) {
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, code: 'Insecure', message: 'The camera only works on a secure (https) page in a supported browser.' };
  }
  try {
    if (!isCameraActive()) {
      const gen = generation;
      if (!pending) pending = openStream().finally(() => { pending = null; });
      const s = await pending;
      if (gen !== generation) {            // stopCamera() was called while we waited
        s.getTracks().forEach((t) => t.stop());
        return { ok: false, code: 'Cancelled', message: '' };
      }
      stream = s;
    }
    if (videoEl.srcObject !== stream) videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.setAttribute('playsinline', '');
    await videoEl.play();
    return { ok: true, info: getInfo(videoEl) };
  } catch (error) {
    stopCamera(videoEl);
    const code = (error && error.name) || 'Error';
    return { ok: false, code, message: MESSAGES[code] || 'The camera couldn’t start. Try again.' };
  }
}

/** Stop all tracks and detach. Safe to call when nothing is running. */
export function stopCamera(videoEl) {
  generation++;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (videoEl) {
    try { videoEl.pause(); } catch (e) { /* ignore */ }
    videoEl.srcObject = null;
  }
}

/** What the camera actually delivered (for the UI and the debug panel). */
export function getInfo(videoEl) {
  const track = stream && stream.getVideoTracks()[0];
  const s = track && track.getSettings ? track.getSettings() : {};
  return {
    active: isCameraActive(),
    label: track ? track.label : '',
    facingMode: s.facingMode || 'unknown',  // Safari and Chrome on phones report this; desktops often don't
    trackWidth: s.width || 0,
    trackHeight: s.height || 0,
    videoWidth: videoEl ? videoEl.videoWidth : 0,
    videoHeight: videoEl ? videoEl.videoHeight : 0,
    frameRate: s.frameRate ? Math.round(s.frameRate) : 0,
  };
}
