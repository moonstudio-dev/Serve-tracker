/*
 * camera.js — camera permission and stream lifecycle.
 *
 * - One stream at a time: startCamera() reuses a live stream instead of opening another.
 * - Rear camera by default, never mirrored. We first REQUIRE the rear camera
 *   (facingMode exact "environment"). Asking only for a *preferred* rear camera is not enough:
 *   Safari weighs all preferred settings together and can pick the front camera because it
 *   matches the requested size better (seen on iPhone, 16 Nov). If no rear camera exists
 *   (desktop, some tablets), we fall back to a preferred rear camera, then to any camera,
 *   and report which one we got so the UI can explain.
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

function size() {
  const portrait = isPortraitScreen();
  return { width: { ideal: portrait ? 720 : 1280 }, height: { ideal: portrait ? 1280 : 720 } };
}

/** Attempts in order. Each is tried only if the previous one can't be satisfied. */
function attempts() {
  return [
    { audio: false, video: { facingMode: { exact: 'environment' }, ...size() } },
    { audio: false, video: { facingMode: { ideal: 'environment' }, ...size() } },
    { audio: false, video: true },
  ];
}

/** Phone or tablet (used only to decide whether a front camera needs explaining). */
export function isMobileDevice() {
  return (navigator.userAgentData && navigator.userAgentData.mobile) ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPadOS reports as Mac
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

let lastAttempt = '';

async function openStream() {
  const list = attempts();
  for (let i = 0; i < list.length; i++) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(list[i]);
      lastAttempt = ['rear camera required', 'rear camera preferred', 'any camera'][i];
      return s;
    } catch (error) {
      // Only "this camera/setting doesn't exist" moves on to the next attempt.
      // Permission refusals and busy cameras are reported straight away.
      const retryable = error && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError');
      if (!retryable || i === list.length - 1) throw error;
    }
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
    request: lastAttempt,
    facingMode: s.facingMode || 'unknown',  // Safari and Chrome on phones report this; desktops often don't
    trackWidth: s.width || 0,
    trackHeight: s.height || 0,
    videoWidth: videoEl ? videoEl.videoWidth : 0,
    videoHeight: videoEl ? videoEl.videoHeight : 0,
    frameRate: s.frameRate ? Math.round(s.frameRate) : 0,
  };
}
