/*
 * pose.js — TensorFlow.js + MoveNet initialisation and a controlled frame loop.
 *
 * Uses the globals `tf` and `poseDetection` from the pinned scripts in index.html.
 *
 * - The model is loaded once (a second request while loading waits for the first).
 * - Backend: WebGL (GPU) by default; WASM (CPU) where WebGL is known to give wrong results:
 *     - ARM Mali GPUs. Evidence (16 Nov, Android 10, Mali-G610 MC4, Chrome 157): on WebGL,
 *       MoveNet returned no pose in 332 frames with a person in view; on WASM, same phone and
 *       frames, 15/17 keypoints and a correct skeleton. The GPU reported full 32-bit support,
 *       so the float check below would not have caught it.
 *     - GPUs that can't render 32-bit float textures (known to degrade MoveNet).
 *   `?backend=wasm` or `?backend=webgl` in the URL forces one, for side-by-side testing.
 * - The loop can be started and stopped; it processes one frame at a time (no overlap),
 *   skips frames when the video isn't playing, and measures frames per second.
 */

const TF_VERSION = '4.11.0';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${TF_VERSION}/dist/`;

let detector = null;
let loading = null;
let backendInfo = { name: '', reason: '', float32: null };

let loopId = 0;   // increments on every start/stop so stale loops exit
let running = false;
let paused = false;     // set while the debug model check borrows the detector
let inflight = null;    // the estimate currently running, so a check can wait for it
const stats = { fps: 0, frames: 0, lastError: '' };

export function getPoseInfo() {
  return { ready: !!detector, running, backend: backendInfo, fps: stats.fps, frames: stats.frames, lastError: stats.lastError };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

async function useWasm(reason) {
  if (!tf.wasm) await loadScript(WASM_BASE + 'tf-backend-wasm.min.js');
  tf.wasm.setWasmPaths(WASM_BASE);
  await tf.setBackend('wasm');
  await tf.ready();
  backendInfo = { name: 'wasm', reason, float32: backendInfo.float32, gpu: backendInfo.gpu || gpuName() };
}

async function chooseBackend() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced === 'wasm') return useWasm('forced by URL');
  try {
    const ok = await tf.setBackend('webgl');
    if (!ok) throw new Error('WebGL unavailable');
    await tf.ready();
    const float32 = tf.env().getBool('WEBGL_RENDER_FLOAT32_CAPABLE');
    const gpu = gpuName();
    backendInfo = { name: 'webgl', reason: forced === 'webgl' ? 'forced by URL' : 'default', float32, gpu };
    if (forced !== 'webgl') {
      if (/Mali/i.test(gpu)) await useWasm('Mali GPU: WebGL results unreliable');
      else if (!float32) await useWasm('GPU cannot render 32-bit floats');
    }
  } catch (error) {
    await useWasm('WebGL failed: ' + error.message);
  }
}

export function loadMoveNet() {
  if (!loading) {
    loading = (async () => {
      await chooseBackend();
      detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
      );
      return detector;
    })().catch((error) => {
      loading = null; // allow a retry
      stats.lastError = String(error && error.message || error);
      throw error;
    });
  }
  return loading;
}

/**
 * Run pose estimation on videoEl until stopPoseLoop() is called.
 * onPoses(poses, tGrab) gets MoveNet poses with keypoints in the video's own pixels, and
 * tGrab = performance.now() when the frame was taken (used to timestamp recorded movement).
 */
export function startPoseLoop(videoEl, onPoses) {
  stopPoseLoop();
  if (!detector) return;
  if (detector.reset) detector.reset(); // clear smoothing from any previous stream
  const id = ++loopId;
  running = true;
  let windowStart = performance.now();
  let windowFrames = 0;

  async function tick() {
    if (id !== loopId) return;
    const playing = videoEl.readyState >= 2 && !videoEl.paused && videoEl.videoWidth > 0;
    if (playing && !paused) {
      try {
        const tGrab = performance.now();
        inflight = detector.estimatePoses(videoEl);
        const poses = await inflight;
        inflight = null;
        if (id !== loopId) return; // stopped while estimating
        stats.frames++;
        windowFrames++;
        onPoses(poses, tGrab);
      } catch (error) {
        inflight = null;
        stats.lastError = String(error && error.message || error);
      }
    }
    const now = performance.now();
    if (now - windowStart >= 1000) {
      stats.fps = Math.round((windowFrames * 1000) / (now - windowStart));
      windowStart = now;
      windowFrames = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function stopPoseLoop() {
  loopId++;
  running = false;
  stats.fps = 0;
}

/* ---------------------------------------------------------------------------------------
 * Model check (debug only). Answers: is the model getting a good picture, and does it find
 * a body in it? Runs on the current frame with the live loop paused:
 *   1. "Screen frame": the frame drawn by the browser onto a 2D canvas (what you see).
 *   2. "Model input": what TensorFlow reads from the video element (what the model sees).
 *   3. The model's raw output (no 25 % cut-off) on (a) the video element and (b) a plain
 *      2D-canvas copy of the same frame.
 * If (1) looks right but (2) is blank or garbled, the camera-to-GPU upload is broken on this
 * device. If both look right but scores are low, the problem is in the model's maths on this
 * GPU (compare with ?backend=wasm). If scores are good here, the live loop is at fault.
 * --------------------------------------------------------------------------------------- */

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no WebGL');
  } catch (e) { return 'unknown'; }
}

function lumaStats(rgba) {
  let n = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const y = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    sum += y; sum2 += y * y; n++;
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(1), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1) };
}

function summarise(poses) {
  const p = poses && poses[0];
  if (!p) return { poseScore: null, maxKeypointScore: null, above03: 0, keypoints: [] };
  return {
    poseScore: +(p.score || 0).toFixed(3),
    maxKeypointScore: +Math.max(...p.keypoints.map((k) => k.score)).toFixed(3),
    above03: p.keypoints.filter((k) => k.score >= 0.3).length,
    keypoints: p.keypoints.map((k) => [k.name, +k.score.toFixed(2), Math.round(k.x), Math.round(k.y)]),
  };
}

export async function runModelCheck(videoEl) {
  if (!detector) throw new Error('Model not loaded yet');
  if (!videoEl.videoWidth) throw new Error('Camera not running');
  paused = true;
  try {
    if (inflight) await inflight.catch(() => {});
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const W = 96, H = Math.max(1, Math.round(96 * vh / vw));
    const out = { backend: tf.getBackend(), gpu: gpuName(), video: vw + 'x' + vh };

    // 1. Screen frame via 2D canvas
    const full = document.createElement('canvas');
    full.width = vw; full.height = vh;
    full.getContext('2d').drawImage(videoEl, 0, 0, vw, vh);
    const small = document.createElement('canvas');
    small.width = W; small.height = H;
    const sctx = small.getContext('2d');
    sctx.drawImage(full, 0, 0, W, H);
    const screenPx = sctx.getImageData(0, 0, W, H).data;
    out.screenFrame = { ...lumaStats(screenPx), thumb: small.toDataURL('image/jpeg', 0.7) };

    // 2. Model input: what TensorFlow reads from the video element
    const t = tf.browser.fromPixels(videoEl);
    out.modelInputShape = t.shape.join('x');
    // tf-core alone has no chained tensor methods, so use the functional ops
    const thumbT = tf.tidy(() => tf.cast(tf.clipByValue(tf.image.resizeBilinear(t, [H, W]), 0, 255), 'int32'));
    t.dispose();
    const tc = document.createElement('canvas');
    tc.width = W; tc.height = H;
    await tf.browser.toPixels(thumbT, tc);
    thumbT.dispose();
    const modelPx = tc.getContext('2d').getImageData(0, 0, W, H).data;
    let diff = 0;
    for (let i = 0; i < modelPx.length; i += 4) diff += Math.abs(modelPx[i] - screenPx[i]) + Math.abs(modelPx[i + 1] - screenPx[i + 1]) + Math.abs(modelPx[i + 2] - screenPx[i + 2]);
    out.modelInput = { ...lumaStats(modelPx), differenceFromScreen: +(diff / (W * H * 3)).toFixed(1), thumb: tc.toDataURL('image/jpeg', 0.7) };

    // 3. Raw model output on the video element and on the 2D copy (cut-off disabled)
    const saved = detector.minPoseScore;
    // MoveNet's pose score is the mean of keypoints above 0.2, or 0 if none: a negative cut-off returns every result
    detector.minPoseScore = -1;
    try {
      detector.reset();
      const t0 = performance.now();
      out.fromVideo = summarise(await detector.estimatePoses(videoEl));
      out.fromVideo.ms = Math.round(performance.now() - t0);
      detector.reset();
      out.fromCanvasCopy = summarise(await detector.estimatePoses(full));
    } finally {
      detector.minPoseScore = saved;
      detector.reset();
    }

    // Plain-English reading of the numbers
    const blank = out.modelInput.std < 4;
    const mismatch = out.modelInput.differenceFromScreen > 30;
    out.modelInputShape += ' (height x width x colours)';
    const v = out.fromVideo.poseScore || 0, c = out.fromCanvasCopy.poseScore || 0;
    out.verdict =
      out.screenFrame.std < 4 ? 'The camera picture itself is blank or uniform: check lighting / lens.' :
      blank ? 'Model input is BLANK although the screen shows a picture: camera-to-GPU upload is broken on this device.' :
      mismatch ? 'Model input does NOT match the screen: camera-to-GPU upload is corrupted on this device.' :
      (c >= 0.25 && v < 0.25) ? 'Model finds the body in a canvas copy but not in the video: video upload path is the problem.' :
      (v < 0.25 && c < 0.25) ? 'Model gets a correct picture but finds no body: model maths on this backend, or the player is not in frame. Repeat with ?backend=wasm.' :
      'Model finds the body on this frame. If the live view still fails, the live loop is at fault.';
    return out;
  } finally {
    paused = false;
  }
}

/**
 * One pose on a still frame (used by replay to measure skeleton sync). Must not run while the
 * live loop is running; replay only runs after the camera screens have stopped it.
 */
export async function estimateFrame(el) {
  await loadMoveNet();
  const saved = detector.minPoseScore;
  detector.minPoseScore = -1;
  try {
    if (detector.reset) detector.reset();
    return (await detector.estimatePoses(el))[0] || null;
  } finally {
    detector.minPoseScore = saved;
    if (detector.reset) detector.reset();
  }
}
