/*
 * pose.js — TensorFlow.js + MoveNet initialisation and the frame loop.
 *
 * Uses the globals `tf` and `poseDetection` from the pinned CDN scripts in index.html.
 *
 * Stage 0: behaviour moved from new-app/index.html, with two small guards:
 *   - the model is loaded once, even if requested again while still loading
 *   - the frame loop is started once
 * Known issue fixed in Stage 1 (audit C4): the loop never stops once started.
 */

let detector = null;
let loading = null;
let loopStarted = false;

export function isModelReady() {
  return detector !== null;
}

export function loadMoveNet() {
  if (!loading) {
    loading = (async () => {
      await tf.setBackend('webgl');
      await tf.ready();
      detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
      );
      return detector;
    })().catch((error) => {
      loading = null; // allow a retry
      console.error('MoveNet loading failed:', error);
      throw error;
    });
  }
  return loading;
}

/** Runs pose estimation on every animation frame and hands the poses to onPoses. */
export function startPoseLoop(videoEl, onPoses) {
  if (loopStarted) return;
  loopStarted = true;
  async function tick() {
    if (detector && videoEl.videoWidth) {
      try {
        onPoses(await detector.estimatePoses(videoEl));
      } catch (error) {
        console.error('Body detection error:', error);
      }
    }
    requestAnimationFrame(tick);
  }
  tick();
}
