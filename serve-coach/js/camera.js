/*
 * camera.js — camera permission and stream lifecycle.
 *
 * Stage 0: behaviour moved unchanged from new-app/index.html.
 * Known issues fixed in Stage 1 (see audit C2, C3, C7):
 *   - no rear-camera request (facingMode), fixed 640x480 request
 *   - a new stream is opened on every call and never stopped
 *   - errors are shown with alert() and not told apart
 */

export async function startCamera(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();
  } catch (error) {
    alert("We couldn't access your camera. Please check your camera permissions.");
    console.error(error);
  }
}
