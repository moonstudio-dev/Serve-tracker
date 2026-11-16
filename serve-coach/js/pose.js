/*
 * pose.js — TensorFlow.js + MoveNet initialisation and a controlled frame loop.
 *
 * Uses the globals `tf` and `poseDetection` from the pinned scripts in index.html.
 *
 * - The model is loaded once (a second request while loading waits for the first).
 * - Backend: WebGL (GPU) by default. Some phone GPUs can't render 32-bit float textures and
 *   fall back to 16-bit, which is known to degrade MoveNet's keypoints and confidence scores.
 *   On those devices we use the WASM (CPU) backend instead. `?backend=wasm` or
 *   `?backend=webgl` in the URL forces one, for side-by-side testing.
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
  backendInfo = { name: 'wasm', reason, float32: backendInfo.float32 };
}

async function chooseBackend() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced === 'wasm') return useWasm('forced by URL');
  try {
    const ok = await tf.setBackend('webgl');
    if (!ok) throw new Error('WebGL unavailable');
    await tf.ready();
    const float32 = tf.env().getBool('WEBGL_RENDER_FLOAT32_CAPABLE');
    backendInfo = { name: 'webgl', reason: forced === 'webgl' ? 'forced by URL' : 'default', float32 };
    if (!float32 && forced !== 'webgl') await useWasm('GPU cannot render 32-bit floats');
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
 * onPoses(poses) gets MoveNet poses with keypoints in the video's own pixels.
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
    if (playing) {
      try {
        const poses = await detector.estimatePoses(videoEl);
        if (id !== loopId) return; // stopped while estimating
        stats.frames++;
        windowFrames++;
        onPoses(poses);
      } catch (error) {
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
