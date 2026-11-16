/*
 * overlay.js — video-to-screen coordinate mapping and skeleton drawing.
 *
 * Why this exists (Stage 1 fix, audit C1):
 * The preview box is portrait, but cameras often deliver landscape frames. The <video> uses
 * object-fit: cover, so it is scaled uniformly and its sides are cropped. MoveNet returns
 * keypoints in the camera's own pixels. To land on the body, every keypoint must go through
 * the SAME scale-and-crop as the video. Stretching a canvas of the video's size into the box
 * (Stage 0 behaviour) squashes points toward the centre whenever the frame and box shapes
 * differ — badly for landscape frames (seen on Android), mildly for portrait (iPhone).
 *
 * The canvas is drawn at its displayed size × devicePixelRatio, so it is sharp and has no
 * second scaling step. The mapping is recomputed only when sizes change, not every frame.
 */

export const MIN_DRAW_SCORE = 0.3; // MoveNet's own demos draw from 0.3; Stage 0 used 0.5

// MoveNet keypoint indices: 0 nose, 1/2 eyes, 3/4 ears, 5/6 shoulders, 7/8 elbows,
// 9/10 wrists, 11/12 hips, 13/14 knees, 15/16 ankles (odd = left, even = right).
export const SKELETON_EDGES = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

/**
 * Pure mapping from video pixels to display (CSS) pixels for object-fit cover/contain/fill,
 * with the default centred object-position.
 */
export function computeMapping(videoW, videoH, boxW, boxH, fit = 'cover') {
  if (!videoW || !videoH || !boxW || !boxH) return null;
  if (fit === 'fill') {
    return { sx: boxW / videoW, sy: boxH / videoH, ox: 0, oy: 0, videoW, videoH, boxW, boxH, fit };
  }
  const s = fit === 'contain' ? Math.min(boxW / videoW, boxH / videoH) : Math.max(boxW / videoW, boxH / videoH);
  return {
    sx: s, sy: s,
    ox: (boxW - videoW * s) / 2,
    oy: (boxH - videoH * s) / 2,
    videoW, videoH, boxW, boxH, fit,
  };
}

export function toScreen(m, p) {
  return { x: m.ox + p.x * m.sx, y: m.oy + p.y * m.sy };
}

/** True when a video-pixel point is inside the part of the frame the player can see. */
export function isVisible(m, p) {
  const q = toScreen(m, p);
  return q.x >= 0 && q.y >= 0 && q.x <= m.boxW && q.y <= m.boxH;
}

export class SkeletonOverlay {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
    this.mapping = null;
    this.dpr = 1;
    this.dirty = true;
    const markDirty = () => { this.dirty = true; };
    video.addEventListener('loadedmetadata', markDirty);
    video.addEventListener('resize', markDirty); // intrinsic size changed (e.g. phone rotated)
    window.addEventListener('resize', markDirty);
    if ('ResizeObserver' in window) new ResizeObserver(markDirty).observe(canvas);
  }

  /** Recompute canvas size and mapping if anything changed. Returns the current mapping. */
  update() {
    if (!this.dirty && this.mapping) return this.mapping;
    const boxW = this.canvas.clientWidth;
    const boxH = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const fit = getComputedStyle(this.video).objectFit || 'fill';
    const m = computeMapping(this.video.videoWidth, this.video.videoHeight, boxW, boxH, fit);
    if (!m) return null; // video not ready yet; try again next frame
    const w = Math.round(boxW * dpr);
    const h = Math.round(boxH * dpr);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.dpr = dpr;
    this.mapping = m;
    this.dirty = false;
    return m;
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Draw one pose (MoveNet keypoints in video pixels). */
  draw(keypoints, minScore = MIN_DRAW_SCORE) {
    const m = this.update();
    this.clear();
    if (!m || !keypoints) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); // draw in CSS pixels
    const pts = keypoints.map((k) => ({ ...toScreen(m, k), ok: (k.score || 0) >= minScore }));

    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 229, 168, 0.85)';
    ctx.beginPath();
    SKELETON_EDGES.forEach(([a, b]) => {
      if (!pts[a] || !pts[b] || !pts[a].ok || !pts[b].ok) return;
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
    });
    ctx.stroke();

    pts.forEach((p) => {
      if (!p.ok) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#00E5A8';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0B1426';
      ctx.stroke();
    });
  }
}
