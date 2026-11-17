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
 * - Size: always ask for 1280x720 written the camera sensor's way (landscape). Both Safari
 *   and Chrome read width/height in the sensor's orientation and then rotate the picture to
 *   match the phone, so an upright phone gets a full portrait 720x1280 frame. Asking for
 *   720x1280 instead made both browsers cut a 1280x720 strip out of the middle of the view
 *   (only ~1/3 of the height; Camera test, iPhone and Android, 16 Nov). Safety net: if an
 *   upright phone still gets a landscape frame, retry with no size request (full view,
 *   480x640 on both test phones). Callers still read the real size from the video element.
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
  return { width: { ideal: 1280 }, height: { ideal: 720 } }; // sensor orientation; see header
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
let lastRequest = null;

async function openStream() {
  const list = attempts();
  for (let i = 0; i < list.length; i++) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(list[i]);
      lastAttempt = ['rear camera required', 'rear camera preferred', 'any camera'][i];
      lastRequest = list[i];
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
    const fresh = videoEl.srcObject !== stream;
    if (fresh) videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.setAttribute('playsinline', '');
    await videoEl.play();
    if (fresh) await portraitSafetyNet(videoEl);
    return { ok: true, info: getInfo(videoEl) };
  } catch (error) {
    stopCamera(videoEl);
    const code = (error && error.name) || 'Error';
    return { ok: false, code, message: MESSAGES[code] || 'The camera couldn’t start. Try again.' };
  }
}

/**
 * Safety net: an upright phone should receive a portrait frame. If the PLAYING picture is
 * landscape, it is a strip cropped out of the view, so reopen the camera with no size request.
 * Judge by the video element after a short settle, not by track.getSettings() straight after
 * opening: iPhone Safari reports the sensor's 1280x720 there and only rotates to 720x1280
 * once playing (v1.1.5 fell back to 480x640 on iPhone because of this, 17 Nov).
 */
async function portraitSafetyNet(videoEl) {
  if (!isMobileDevice() || !isPortraitScreen()) return;
  await new Promise((r) => setTimeout(r, 600));
  if (!(videoEl.videoWidth > videoEl.videoHeight)) return;
  const gen = generation;
  const facing = lastRequest && lastRequest.video && lastRequest.video.facingMode;
  stream.getTracks().forEach((t) => t.stop()); // release first: some Android phones can't open twice
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: false, video: facing ? { facingMode: facing } : true });
    lastAttempt += ', no size (portrait fallback)';
  } catch (e) {
    s = await navigator.mediaDevices.getUserMedia(lastRequest); // reopen the original request
  }
  if (gen !== generation) { s.getTracks().forEach((t) => t.stop()); return; } // stopped meanwhile
  stream = s;
  videoEl.srcObject = s;
  await videoEl.play();
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

/* ---------------------------------------------------------------------------------------
 * Camera request test (debug only). Opens the rear camera with several different requests,
 * one at a time, and records what each delivers: size, settings and a thumbnail of the
 * WHOLE frame. Comparing the thumbnails (phone held still) shows which request keeps the
 * camera's full field of view. Evidence for the "picture is zoomed in" finding, 16 Nov.
 * --------------------------------------------------------------------------------------- */
export const CAMERA_TEST_VARIANTS = [
  { id: 'A-portrait-size', note: 'old request (before v1.1.5): portrait size', video: { facingMode: { exact: 'environment' }, width: { ideal: 720 }, height: { ideal: 1280 } } },
  { id: 'B-landscape-size', note: 'current request (v1.1.5+): sensor-orientation size', video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
  { id: 'C-no-size', note: 'no size requested', video: { facingMode: { exact: 'environment' } } },
  { id: 'D-no-crop', note: 'no size, cropping disabled (Chrome)', video: { facingMode: { exact: 'environment' }, resizeMode: 'none' } },
];

export async function probeCamera(variant) {
  const v = document.createElement('video');
  v.muted = true; v.setAttribute('playsinline', ''); v.autoplay = true;
  let s = null;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: false, video: variant.video });
    v.srcObject = s;
    await v.play();
    await new Promise((r) => setTimeout(r, 700)); // let exposure and size settle
    const w = v.videoWidth, h = v.videoHeight;
    const k = 120 / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const st = s.getVideoTracks()[0].getSettings();
    return { id: variant.id, note: variant.note, ok: true, video: w + 'x' + h,
      settings: { width: st.width, height: st.height, aspectRatio: st.aspectRatio && +st.aspectRatio.toFixed(3), resizeMode: st.resizeMode, zoom: st.zoom },
      thumb: c.toDataURL('image/jpeg', 0.7) };
  } catch (e) {
    return { id: variant.id, note: variant.note, ok: false, error: e.name || String(e) };
  } finally {
    if (s) s.getTracks().forEach((t) => t.stop());
    v.srcObject = null;
  }
}
