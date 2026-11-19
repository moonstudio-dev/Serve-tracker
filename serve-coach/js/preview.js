/*
 * preview.js — one live camera preview with the MoveNet skeleton, reusable on any screen.
 *
 * Used by camera setup (step 4) and the Record screen. Only one camera stream exists at a
 * time (camera.js); a Preview attaches it to its own <video>, runs the pose loop and draws
 * the skeleton with the shared video-to-screen mapping (overlay.js).
 *
 * Front camera: the live preview box is mirrored (selfie view). Recordings are not mirrored.
 */

import { startCamera, stopCamera, isCameraActive, isMobileDevice } from './camera.js';
import { loadMoveNet, startPoseLoop, stopPoseLoop, getPoseInfo } from './pose.js';
import { SkeletonOverlay } from './overlay.js';

export class Preview {
  /**
   * els: { video, canvas, box (element mirrored for the front camera), status, retry }
   * opts: { debug, onPoses(poses, tGrab, video) }
   */
  constructor(els, opts = {}) {
    this.els = els;
    this.video = els.video;
    this.overlay = new SkeletonOverlay(els.canvas, els.video);
    this.debug = opts.debug || { note() {}, onPoses() {} };
    this.onPoses = opts.onPoses || null;
    this.token = 0;
    this.on = false;
    this.facing = 'environment';
    this.info = null;
    if (els.retry) els.retry.addEventListener('click', () => { if (this.wantOn) this.start(this.facing); });
  }

  setStatus(text, kind, retry) {
    const el = this.els.status;
    if (!el) return;
    el.textContent = text || '';
    el.dataset.kind = kind || '';
    el.hidden = !text;
    if (this.els.retry) this.els.retry.hidden = !retry;
  }

  get ready() { return this.on && !!this.info && getPoseInfo().running; }
  /** Camera picture available (tracking may or may not be running). */
  get cameraOn() { return this.on && !!this.info && this.video.videoWidth > 0; }
  get stream() { return this.video.srcObject; }

  /** Start (or restart with another camera). Resolves true when the camera and tracking run. */
  async start(facing = this.facing) {
    this.wantOn = true;
    if (this.on && facing === this.facing) return true;
    if (this.on) this.stop(true);
    this.facing = facing;
    this.on = true;
    const token = ++this.token;
    this.setStatus('Starting camera…');
    const res = await startCamera(this.video, facing);
    if (token !== this.token || res.code === 'Cancelled') return false;
    if (!res.ok) {
      this.on = false;
      this.debug.note('camera error ' + res.code);
      this.setStatus(res.message, 'error', true);
      return false;
    }
    this.info = res.info;
    this.debug.note('camera on ' + res.info.videoWidth + 'x' + res.info.videoHeight + ' facing=' + res.info.facingMode + ' (' + res.info.request + ')');
    const front = res.info.facingMode === 'user' || (facing === 'user' && res.info.facingMode === 'unknown');
    if (this.els.box) this.els.box.classList.toggle('mirror', front);
    this.trackingFailed = false;
    this.setStatus('Loading body tracking…');
    try {
      await loadMoveNet();
    } catch (e) {
      if (token !== this.token) return false;
      this.trackingFailed = true;
      this.setStatus('Body tracking couldn’t load. Check your connection, then try again.', 'error', true);
      this.debug.note('model error ' + e.message);
      return false;
    }
    if (token !== this.token) return false;
    startPoseLoop(this.video, (poses, tGrab) => {
      const pose = poses && poses[0];
      this.overlay.draw(pose ? pose.keypoints : null);
      this.debug.onPoses(poses);
      if (this.onPoses) this.onPoses(poses, tGrab, this.video);
    });
    const wrongCamera = isMobileDevice() && facing === 'environment' && res.info.facingMode === 'user';
    this.setStatus(wrongCamera ? 'No rear camera was available, so the front camera is in use.' : '', wrongCamera ? 'warn' : '');
    return true;
  }

  /** Stop the camera and tracking. keepWanted: internal restart, don't forget the wish to run. */
  stop(keepWanted = false) {
    if (!keepWanted) this.wantOn = false;
    this.token++;
    if (!this.on && !isCameraActive()) return;
    this.on = false;
    this.info = null;
    stopPoseLoop();
    stopCamera(this.video);
    this.overlay.clear();
    this.setStatus('');
    this.debug.note('camera off');
  }

  /** Camera details for clip metadata. */
  cameraMeta() {
    const i = this.info || {};
    return { facing: i.facingMode && i.facingMode !== 'unknown' ? i.facingMode : this.facing, label: i.label || '', requested: this.facing };
  }
}
