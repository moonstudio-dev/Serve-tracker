/*
 * overlay.js — drawing the skeleton over the video.
 *
 * Stage 0: drawing moved unchanged from new-app/index.html (keypoint dots only).
 * Known issue fixed in Stage 1 (audit C1): the canvas uses the video's intrinsic size
 * and is stretched into the portrait preview, while the video is cropped with
 * object-fit: cover — so dots are squashed toward the centre horizontally.
 * Stage 1 replaces this with one shared video-to-screen mapping and full skeleton lines.
 */

export function drawPoses(canvas, videoEl, poses) {
  const ctx = canvas.getContext('2d');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!poses.length) return;
  poses[0].keypoints.forEach((point) => {
    if (point.score < 0.5) return;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#00E5A8';
    ctx.fill();
  });
}
