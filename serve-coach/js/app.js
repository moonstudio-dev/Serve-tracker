/*
 * app.js — routing, navigation and screen interactions.
 *
 * Ported from new-app/index.html. Routes: #home, #setup, #record, #progress.
 * Old prototype links still work: #live -> #record, #log and #coach -> #progress.
 *
 * Camera experience (Stage 1): the camera and tracking run only while setup step 4 is on
 * screen. Leaving the step or the screen, or hiding the page, stops both.
 *
 * Demo-only behaviour still in place (replaced in later stages, see README):
 *   - scripted picture checks in setup step 4 (Stage 2)
 *   - level bubble animation when no orientation sensor is available (Stage 2)
 *   - button-driven serve counting and scripted cues on Record (Stages 3 and 6)
 *   - example coaching, comparisons, sessions and answers in Progress (Stage 7)
 */

import { KEYS, prefs } from './store.js';
import { startCamera, stopCamera, isCameraActive } from './camera.js';
import { loadMoveNet, startPoseLoop, stopPoseLoop } from './pose.js';
import { SkeletonOverlay, MIN_DRAW_SCORE } from './overlay.js';
import { initDebug } from './debug.js';

const $ = (id) => document.getElementById(id);

/* ---------- routing ---------- */
const VIEWS = ['home', 'setup', 'record', 'progress'];
let currentView = null;
const ALIASES = { live: 'record', log: 'progress', coach: 'progress' };
const TAB_FOR = { home: 'home', setup: 'record', record: 'record', progress: 'progress' };

function route() {
  let h = (location.hash || '#home').slice(1);
  if (ALIASES[h]) { h = ALIASES[h]; history.replaceState(null, '', '#' + h); }
  if (VIEWS.indexOf(h) < 0) h = 'home';
  if (h === 'record' && !prefs.get(KEYS.spot) && !window.__skipSetup) {
    h = 'setup';
    history.replaceState(null, '', '#setup');
  }
  currentView = h;
  if (h !== 'setup') stopPreview();
  VIEWS.forEach((v) => { $(v).hidden = v !== h; });
  const tab = TAB_FOR[h];
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (h === 'setup') showStep(step);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function say(text, force) {
  if ($('voice').getAttribute('aria-pressed') !== 'true' && force !== 'force') return;
  try {
    const s = window.speechSynthesis;
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    s.speak(u);
  } catch (e) { /* speech not available */ }
}

/* ---------- setup ---------- */
const cfg = prefs.get(KEYS.cfg) || { hand: 'R', side: 'deuce' };
let step = 1;
let checksDone = false;

function pick(attr, val) {
  document.querySelectorAll('[data-' + attr + ']').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset[attr] === val));
  });
}
document.querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => { cfg.hand = b.dataset.hand; pick('hand', cfg.hand); layout(); }));
document.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { cfg.side = b.dataset.side; pick('side', cfg.side); layout(); }));
pick('hand', cfg.hand);
pick('side', cfg.side);

function layout() {
  const px = cfg.side === 'deuce' ? 77 : 63;
  const right = cfg.hand === 'R';
  const cx = right ? 131 : 9;
  $('player').querySelector('circle').setAttribute('cx', px);
  $('player').querySelector('text').setAttribute('x', px);
  $('tripod').querySelector('circle').setAttribute('cx', cx);
  $('tripT').setAttribute('x', right ? 136 : 4);
  $('tripT').setAttribute('text-anchor', right ? 'end' : 'start');
  $('cone').setAttribute('points', cx + ',133 ' + px + ',123 ' + px + ',143');
  $('sight').setAttribute('x1', cx);
  $('sight').setAttribute('x2', px);
  const far = Math.abs(cx - px) / 10 > 6;
  $('distOut').firstChild.nodeValue = far ? 'About 7 m' : 'About 5 m';
  $('distSteps').textContent = far ? 'roughly 8 big steps' : 'roughly 6 big steps';
  $('sideTip').textContent = 'On your ' + (right ? 'right' : 'left') + ', the side your chest faces';
  $('farNote').hidden = !far;
  prefs.set(KEYS.cfg, cfg);
}
layout();

function showStep(n) {
  step = n;
  document.querySelectorAll('.step').forEach((s) => { s.hidden = +s.dataset.step !== n; });
  document.querySelectorAll('#stepBar span').forEach((s, i) => { s.className = i < n - 1 ? 'on' : (i === n - 1 ? 'now' : ''); });
  $('backBtn').hidden = n === 1;
  $('backBtn').parentNode.style.gridTemplateColumns = n === 1 ? '1fr' : '';
  const nb = $('nextStep');
  nb.textContent = n === 5 ? 'Save spot and start' : 'Next';
  nb.disabled = n === 4 && !checksDone;
  nb.style.opacity = nb.disabled ? 0.45 : 1;
  if (n === 3) startLevel();
  if (n === 4) startPreview(); else stopPreview();
  if (n === 5) fillSummary();
  window.scrollTo(0, 0);
}
$('backBtn').addEventListener('click', () => { if (step > 1) showStep(step - 1); });
$('nextStep').addEventListener('click', () => {
  if (step < 5) { showStep(step + 1); return; }
  prefs.set(KEYS.spot, { hand: cfg.hand, side: cfg.side, saved: Date.now() });
  updatePill();
  location.hash = '#record';
});

function fillSummary() {
  const right = cfg.hand === 'R';
  const far = (cfg.side === 'deuce') !== right;
  const rows = [
    ['Camera', 'Baseline line, outside the ' + (right ? 'right' : 'left') + ' doubles line'],
    ['Distance', far ? 'About 7 m' : 'About 5 m'],
    ['Height', 'Hip height, phone upright'],
    ['Lens', 'Main 1× lens'],
    ['Serving from', cfg.side === 'deuce' ? 'Deuce side' : 'Ad side'],
  ];
  $('summary').innerHTML = rows.map((r) => '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('');
}

/* level: real sensor if available, otherwise a demo that settles (replaced in Stage 2) */
let levelOn = false;
function setBubble(g) {
  const off = Math.max(-60, Math.min(60, g * 4));
  $('bubble').style.left = 'calc(50% - 12px + ' + off + 'px)';
  const ok = Math.abs(g) < 2;
  $('levelTxt').firstChild.nodeValue = ok ? 'Level' : 'Tilt it a little ' + (g > 0 ? 'left' : 'right');
  $('levelSub').textContent = ok ? 'Shoulder angles will read true' : 'Until the ball sits between the lines';
}
function startLevel() {
  if (levelOn) return;
  levelOn = true;
  let got = false;
  window.addEventListener('deviceorientation', (e) => { if (e.gamma == null) return; got = true; setBubble(e.gamma); });
  const demo = [9, -6, 4, -2.5, 1.2, 0.3];
  let t = 0;
  (function tick() { if (got) return; if (t < demo.length) { setBubble(demo[t]); t++; setTimeout(tick, 500); } })();
}

/* ---------- camera preview + MoveNet skeleton ---------- */
const video = $('cameraPreview');
const canvas = $('skeletonCanvas');
const overlay = new SkeletonOverlay(canvas, video);
const debug = initDebug({ video, canvas, overlay, minScore: MIN_DRAW_SCORE });
let previewToken = 0;   // changes whenever the preview is started or stopped
let previewOn = false;

function setCamStatus(text, kind, retry) {
  const el = $('camStatus');
  el.textContent = text || '';
  el.dataset.kind = kind || '';
  el.hidden = !text;
  $('camRetry').hidden = !retry;
}

async function startPreview() {
  if (previewOn) return; // already running or starting: never open a second stream
  previewOn = true;
  const token = ++previewToken;
  setCamStatus('Starting camera…');
  const res = await startCamera(video);
  if (token !== previewToken || res.code === 'Cancelled') return; // left while starting (camera.js discards the stream)
  if (!res.ok) {
    previewOn = false;
    debug.note('camera error ' + res.code);
    setCamStatus(res.message, 'error', true);
    return;
  }
  debug.note('camera on ' + res.info.videoWidth + 'x' + res.info.videoHeight + ' facing=' + res.info.facingMode);
  const frontOnly = res.info.facingMode === 'user';
  setCamStatus('Loading body tracking…');
  try {
    await loadMoveNet();
  } catch (e) {
    if (token !== previewToken) return;
    setCamStatus('Body tracking couldn’t load. Check your connection, then try again.', 'error', true);
    debug.note('model error ' + e.message);
    return;
  }
  if (token !== previewToken) return;
  startPoseLoop(video, (poses) => {
    const pose = poses && poses[0];
    overlay.draw(pose ? pose.keypoints : null);
    debug.onPoses(poses);
  });
  setCamStatus(frontOnly ? 'No rear camera was available, so the front camera is in use. For practice, use the rear camera on a tripod.' : '', frontOnly ? 'warn' : '');
}

function stopPreview() {
  previewToken++;
  if (!previewOn && !isCameraActive()) return;
  previewOn = false;
  stopPoseLoop();
  stopCamera(video);
  overlay.clear();
  setCamStatus('');
  debug.note('camera off');
}

function inCameraStep() {
  return currentView === 'setup' && step === 4;
}
$('camRetry').addEventListener('click', () => { if (inCameraStep()) startPreview(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPreview();
  else if (inCameraStep()) startPreview();
});
window.addEventListener('pagehide', stopPreview);

/* frame check demo (scripted; replaced by real checks in Stage 2) */
$('runCheck').addEventListener('click', function () {
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Checking…';
  const items = [].slice.call(document.querySelectorAll('#checks li'));
  items.forEach((li) => {
    li.dataset.s = '';
    const ic = li.querySelector('.ic');
    ic.textContent = ic.dataset.n || ic.textContent;
    const f = li.querySelector('.fix');
    if (f) f.remove();
  });
  const firstRun = !btn.dataset.ran;
  btn.dataset.ran = '1';
  let i = 0;
  (function next() {
    if (i >= items.length) {
      const failed = items.some((li) => li.dataset.s === 'fail');
      btn.disabled = false;
      btn.textContent = failed ? 'Check again' : 'All good';
      checksDone = !failed;
      showStep(4);
      if (!failed) { btn.disabled = true; say("You're all set.", 'force'); }
      return;
    }
    const li = items[i];
    const ic = li.querySelector('.ic');
    ic.dataset.n = ic.dataset.n || ic.textContent;
    li.dataset.s = 'busy';
    setTimeout(() => {
      if (firstRun && li.dataset.k === 'light') {
        li.dataset.s = 'fail';
        ic.textContent = '!';
        const f = document.createElement('span');
        f.className = 'fix';
        f.textContent = 'A floodlight is in shot. Slide the tripod a step along the line until it’s gone.';
        li.querySelector('div').appendChild(f);
      } else {
        li.dataset.s = 'pass';
        ic.textContent = '✓';
      }
      i++;
      next();
    }, 550);
  })();
});

function updatePill() {
  const p = $('spotPill');
  if (prefs.get(KEYS.spot)) { p.textContent = 'Spot saved'; p.classList.add('ok'); }
  else { p.textContent = 'Set up camera'; p.classList.remove('ok'); }
}
updatePill();

/* ---------- record (demo: button-driven, replaced in Stages 3 and 6) ---------- */
const seq = ['', '', '', 'knee', '', 'knee', '', 'knee', 'turn', 'knee'];
const cues = {
  '': ['Good', 'Just like your best serves.', 'good', 'Good'],
  knee: ['Knee', 'Bend down, not forward.', 'warn', 'Knee. Bend down, not forward.'],
  turn: ['Turn', 'Get more side-on.', 'warn', 'Turn. Get more side-on.'],
};
let served = 0;
let liveState = 'idle';

function cue(word, tip, k) {
  const c = $('cue');
  c.dataset.k = k || '';
  $('cueWord').textContent = word;
  $('cueTip').textContent = tip;
  c.classList.remove('bounce');
  void c.offsetWidth;
  c.classList.add('bounce');
}
$('voice').addEventListener('click', function () {
  const on = this.getAttribute('aria-pressed') !== 'true';
  this.setAttribute('aria-pressed', String(on));
  this.textContent = on ? 'Voice on' : 'Voice off';
});
$('liveBtn').addEventListener('click', function () {
  const b = this;
  if (liveState === 'idle') {
    liveState = 'count';
    b.disabled = true;
    let n = 5;
    $('track').textContent = 'Walk to your mark';
    (function tick() {
      if (n === 0) {
        liveState = 'live';
        b.disabled = false;
        b.textContent = 'Next serve';
        $('track').textContent = 'Tracking you';
        $('track').classList.add('on');
        cue('Go', 'Serve when you’re ready.', 'good');
        say('Go');
        return;
      }
      cue(String(n), 'Walk to your mark.', '');
      n--;
      setTimeout(tick, 800);
    })();
    return;
  }
  if (liveState === 'live') {
    if (served >= seq.length) { endSession(); return; }
    const c = cues[seq[served]];
    served++;
    $('count').textContent = served;
    cue(c[0], c[1], c[2]);
    say(c[3]);
    if (served >= seq.length) b.textContent = 'See coaching';
  }
});
function endSession() {
  liveState = 'idle';
  served = 0;
  $('count').textContent = '0';
  $('liveBtn').textContent = 'Start';
  $('track').textContent = 'Waiting to start';
  $('track').classList.remove('on');
  cue('Ready', 'Tap start, then walk to your mark.', '');
  location.hash = '#progress';
  $('coachBody').hidden = true;
  $('coachLoading').hidden = false;
  setTimeout(() => { $('coachLoading').hidden = true; $('coachBody').hidden = false; }, 1000);
}
$('endBtn').addEventListener('click', endSession);

/* ---------- progress: AI coaching insights (example content) ---------- */
$('hearBtn').addEventListener('click', () => {
  say("Nice session. Your toss didn't drift once. Next time, keep your front knee over your ankle on second serves. Do the knee bend pause, two sets of eight.", 'force');
});
const phases = {
  toss: ['assets/phase-toss.svg', 'Placeholder for the toss: your frame and the coach reference will appear here', '<b>Looking good here.</b> Coach keeps the tossing arm straight and releases high, slightly in front.'],
  trophy: ['assets/phase-trophy.svg', 'Placeholder for the trophy position: your frame and the coach reference will appear here', '<b>This is where your fix lives.</b> Coach bends the knees over the feet, then drives up.'],
  follow: ['assets/phase-follow.svg', 'Placeholder for the finish: your frame and the coach reference will appear here', '<b>Not measured yet.</b> Coach lands on the front foot inside the baseline, balanced.'],
};
document.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', () => {
  const p = phases[b.dataset.phase];
  document.querySelectorAll('[data-phase]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('phaseImg').src = p[0];
  $('phaseImg').alt = p[1];
  $('phaseCap').innerHTML = p[2];
}));
$('doneBtn').addEventListener('click', function () {
  const s = document.createElement('span');
  s.className = 'stamp';
  s.textContent = 'Done today. Nice work.';
  this.replaceWith(s);
});

const qa = [
  ['Why do my second serves go wrong?', 'When you ease off, your front knee slides forward instead of bending down. Sit into the bend, knee over ankle, then drive up. The knee bend pause fixes exactly that.'],
  ['What should I warm up with?', 'Ten toss-and-catch reps to settle the toss, then five slow shadow serves with a full turn. Keep it easy; it’s about feel.'],
  ['Is my serve getting better?', 'Yes. Your toss drifting forward was the big problem three weeks ago, and it’s gone. In matches your serve is still your weakest shot, so keep going.'],
];
$('qs').innerHTML = qa.map((q, k) => '<button type="button" class="q" data-q="' + k + '" aria-pressed="false">' + q[0] + '</button>').join('');
document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('answer').hidden = false;
  $('answerTxt').textContent = qa[+b.dataset.q][1];
}));

/* ---------- progress: comparisons and sessions (example content) ---------- */
const cmp = {
  last: ['Your toss stayed put on every serve', 'Shoulder turn still fades near the end', 'Front knee over your ankle'],
  first: ['Your toss no longer drifts forward, and more serves land in', 'Toss height is steady, just as it was', 'Front knee over your ankle'],
};
document.querySelectorAll('[data-cmp]').forEach((b) => b.addEventListener('click', () => {
  const c = cmp[b.dataset.cmp];
  document.querySelectorAll('[data-cmp]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('vBetter').textContent = c[0];
  $('vSame').textContent = c[1];
  $('vNext').textContent = c[2];
}));

const exampleSessions = [
  { d: 'Example 3', main: 'Front knee', chip: 'fix', r: 'iiioioioii', f: [4, 6, 8, 9, 10] },
  { d: 'Example 2', main: 'Shoulder turn', chip: 'watch', r: 'iiioioiioo', f: [4, 8, 9, 10] },
  { d: 'Example 1', main: 'Toss drift', chip: 'watch', r: 'iooiioiooo', f: [2, 3, 5, 6, 8, 10] },
];
$('sessions').innerHTML = exampleSessions.map((s) => {
  const balls = s.r.split('').map((c, k) => '<span class="b' + (c === 'o' ? ' out' : '') + (s.f.indexOf(k + 1) >= 0 ? ' flag' : '') + '"></span>').join('');
  const ins = s.r.split('i').length - 1;
  return '<li class="sess"><div class="sess-top"><b>' + s.d + '</b><span class="chip ' + s.chip + '">' + s.main + '</span></div><div class="balls" role="img" aria-label="' + ins + ' of 10 serves in, ' + s.f.length + ' flagged">' + balls + '</div></li>';
}).join('');

/* ---------- notes ---------- */
const notes = prefs.get(KEYS.notes) || [];
function drawNotes() {
  $('notes').innerHTML = '';
  notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; $('notes').appendChild(li); });
  $('notesEmpty').hidden = notes.length > 0;
}
drawNotes();
$('noteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('noteIn').value.trim();
  if (!v) return;
  notes.unshift(v);
  prefs.set(KEYS.notes, notes);
  $('noteIn').value = '';
  drawNotes();
});

route();
