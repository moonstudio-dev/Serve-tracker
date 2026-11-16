/*
 * debug.js — hidden development panel. Add ?debug=1 to the URL to show it, e.g.
 *   https://moonstudio-dev.github.io/Serve-tracker/serve-coach/?debug=1#setup
 *
 * Shows, in one place, everything needed to compare devices: camera dimensions and
 * orientation, display sizes, object-fit and the crop mapping, the backend, FPS, and
 * MoveNet keypoints with confidence scores. "Copy" puts it all on the clipboard as JSON.
 * Session state, detection events and recording status are added in later stages.
 */

import { getInfo } from './camera.js';
import { getPoseInfo, runModelCheck } from './pose.js';

const NAMES = ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow',
  'l_wrist', 'r_wrist', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle'];

export function debugEnabled() {
  return new URLSearchParams(location.search).has('debug');
}

export function initDebug({ video, canvas, overlay, minScore }) {
  if (!debugEnabled()) return { onPoses() {}, note() {} };

  const panel = document.createElement('div');
  panel.id = 'debugPanel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = '<div class="dbg-bar"><b>Debug</b><button type="button" data-a="check">Model check</button><button type="button" data-a="copy">Copy</button><button type="button" data-a="hide">Hide</button></div><div class="dbg-check" hidden></div><pre></pre>';
  document.body.appendChild(panel);
  const pre = panel.querySelector('pre');
  const checkBox = panel.querySelector('.dbg-check');
  let lastCheck = null;
  let lastPose = null;
  const events = [];

  function snapshot() {
    const m = overlay.update(); // computes the mapping even before any pose is drawn
    const cam = getInfo(video);
    const pose = getPoseInfo();
    const visible = m ? {
      x0: Math.round(-m.ox / m.sx), x1: Math.round((m.boxW - m.ox) / m.sx),
      y0: Math.round(-m.oy / m.sy), y1: Math.round((m.boxH - m.oy) / m.sy),
    } : null;
    const kps = lastPose ? lastPose.keypoints.map((k, i) => ({
      name: NAMES[i], score: +(k.score || 0).toFixed(2), x: Math.round(k.x), y: Math.round(k.y),
      inView: m ? (k.x >= visible.x0 && k.x <= visible.x1 && k.y >= visible.y0 && k.y <= visible.y1) : null,
    })) : [];
    return {
      time: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screen: {
        viewport: innerWidth + 'x' + innerHeight,
        dpr: window.devicePixelRatio,
        orientation: (screen.orientation && screen.orientation.type) || (innerHeight >= innerWidth ? 'portrait' : 'landscape'),
      },
      camera: { ...cam, videoShape: cam.videoWidth ? (cam.videoWidth >= cam.videoHeight ? 'landscape' : 'portrait') : '-' },
      display: {
        video: video.clientWidth + 'x' + video.clientHeight,
        canvasCss: canvas.clientWidth + 'x' + canvas.clientHeight,
        canvasBitmap: canvas.width + 'x' + canvas.height,
        objectFit: getComputedStyle(video).objectFit,
      },
      mapping: m ? { scale: +m.sx.toFixed(4), offsetX: +m.ox.toFixed(1), offsetY: +m.oy.toFixed(1), visibleVideoArea: visible } : null,
      tracking: {
        backend: pose.backend, modelReady: pose.ready, loopRunning: pose.running, fps: pose.fps,
        framesProcessed: pose.frames, lastError: pose.lastError,
        poseScore: lastPose && lastPose.score != null ? +lastPose.score.toFixed(2) : null,
        keypointsAboveThreshold: kps.filter((k) => k.score >= minScore).length + '/17 (threshold ' + minScore + ')',
      },
      keypoints: kps,
      modelCheck: lastCheck,
      events: events.slice(-10),
    };
  }

  function render() {
    const s = snapshot();
    const t = s.tracking;
    const lines = [
      `camera  ${s.camera.active ? 'ON' : 'off'}  facing=${s.camera.facingMode}  track=${s.camera.trackWidth}x${s.camera.trackHeight}  video=${s.camera.videoWidth}x${s.camera.videoHeight} (${s.camera.videoShape})`,
      `screen  ${s.screen.viewport} dpr=${s.screen.dpr} ${s.screen.orientation}`,
      `display video=${s.display.video} canvas=${s.display.canvasCss} bitmap=${s.display.canvasBitmap} fit=${s.display.objectFit}`,
      `mapping ${s.mapping ? `scale=${s.mapping.scale} off=(${s.mapping.offsetX},${s.mapping.offsetY}) visible x ${s.mapping.visibleVideoArea.x0}–${s.mapping.visibleVideoArea.x1} y ${s.mapping.visibleVideoArea.y0}–${s.mapping.visibleVideoArea.y1}` : '-'}`,
      `model   ${t.backend.name || '-'} (${t.backend.reason || '-'}, f32=${t.backend.float32}) ready=${t.modelReady} loop=${t.loopRunning} fps=${t.fps} frames=${t.framesProcessed}`,
      `pose    score=${t.poseScore} kp≥thr=${t.keypointsAboveThreshold}`,
      ...s.keypoints.map((k) => `  ${k.name.padEnd(11)} ${k.score.toFixed(2)}  (${k.x},${k.y})${k.inView === false ? ' off-screen' : ''}`),
      t.lastError ? `error   ${t.lastError}` : '',
      ...s.events.map((e) => 'event   ' + e),
    ];
    pre.textContent = lines.filter(Boolean).join('\n');
  }

  panel.addEventListener('click', async (e) => {
    const a = e.target.dataset.a;
    if (a === 'hide') { panel.classList.toggle('min'); e.target.textContent = panel.classList.contains('min') ? 'Show' : 'Hide'; }
    if (a === 'check') {
      e.target.textContent = 'Checking…';
      checkBox.hidden = false;
      checkBox.textContent = 'Running model check on the current frame… stand in full view.';
      try {
        const r = await runModelCheck(video);
        lastCheck = r;
        checkBox.innerHTML = '';
        const row = document.createElement('div');
        row.className = 'dbg-thumbs';
        [['Screen frame', r.screenFrame], ['Model input', r.modelInput]].forEach(([label, d]) => {
          const f = document.createElement('figure');
          const img = new Image(); img.src = d.thumb; img.alt = label;
          const cap = document.createElement('figcaption');
          cap.textContent = `${label} · mean ${d.mean} · std ${d.std}` + (d.differenceFromScreen != null ? ` · diff ${d.differenceFromScreen}` : '');
          f.append(img, cap); row.appendChild(f);
        });
        const txt = document.createElement('p');
        txt.textContent = `${r.verdict}  |  backend ${r.backend} · GPU ${r.gpu} · video ${r.video} · input ${r.modelInputShape}  |  ` +
          `from video: score ${r.fromVideo.poseScore}, max kp ${r.fromVideo.maxKeypointScore}, ${r.fromVideo.above03}/17 ≥0.3, ${r.fromVideo.ms} ms  |  ` +
          `from canvas copy: score ${r.fromCanvasCopy.poseScore}, max kp ${r.fromCanvasCopy.maxKeypointScore}, ${r.fromCanvasCopy.above03}/17 ≥0.3`;
        checkBox.append(row, txt);
        note('model check: ' + r.verdict);
      } catch (err) {
        checkBox.textContent = 'Model check failed: ' + err.message;
      }
      e.target.textContent = 'Model check';
    }
    if (a === 'copy') {
      const text = JSON.stringify(snapshot(), null, 1);
      try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; }
      catch (err) { pre.textContent = text; e.target.textContent = 'Select text'; }
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
    }
  });
  function note(text) { events.push(new Date().toLocaleTimeString() + ' ' + text); }
  setInterval(render, 500);
  render();

  return {
    onPoses(poses) { lastPose = poses && poses[0] ? poses[0] : null; },
    note,
  };
}
