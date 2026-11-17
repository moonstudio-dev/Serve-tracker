/*
 * app.js — routing, navigation and screen interactions.
 *
 * Ported from new-app/index.html. Routes: #home, #setup, #record, #progress.
 * Old prototype links still work: #live -> #record, #log and #coach -> #progress.
 *
 * Camera: runs only on setup step 4 and on the Record screen (each has its own Preview).
 * Leaving the step or screen, or hiding the page, stops it. Record screen: record.js.
 *
 * Demo-only behaviour still in place:
 *   - scripted picture checks in setup step 4
 *   - level bubble animation when no orientation sensor is available
 *   - example coaching, comparisons, sessions and answers in Progress (below the real
 *     Video recordings library)
 */

import { KEYS, prefs, recoverUnfinishedClips, markUnknownTripodPositions } from './store.js';
import { probeCamera, CAMERA_TEST_VARIANTS } from './camera.js';
import { MIN_DRAW_SCORE } from './overlay.js';
import { Preview } from './preview.js';
import { initRecord } from './record.js';
import { initReplay } from './replay.js';
import { initLibrary } from './library.js';
import { initPractice, planText } from './practice.js';
import * as store from './store.js';
import { initDebug } from './debug.js';

const $ = (id) => document.getElementById(id);

/* ---------- routing ---------- */
const VIEWS = ['home', 'practice', 'setup', 'record', 'progress', 'replay'];
let currentView = null;
const ALIASES = { live: 'record', log: 'progress', coach: 'progress' };
const TAB_FOR = { home: 'home', practice: 'record', setup: 'record', record: 'record', progress: 'progress', replay: 'progress' };

function route() {
  let h = (location.hash || '#home').slice(1);
  if (ALIASES[h]) { h = ALIASES[h]; history.replaceState(null, '', '#' + h); }
  if (VIEWS.indexOf(h) < 0) h = 'home';
  if (h === 'record' && !prefs.get(KEYS.spot) && !window.__skipSetup) {
    h = 'setup';
    history.replaceState(null, '', '#setup');
  }
  if (h === 'replay' && !replay.hasClip()) { h = 'progress'; history.replaceState(null, '', '#progress'); }
  const prev = currentView;
  currentView = h;
  if (h !== 'setup') stopPreview();
  if (prev === 'record' && h !== 'record') record.leave();
  if (prev === 'replay' && h !== 'replay') replay.leave();
  VIEWS.forEach((v) => { $(v).hidden = v !== h; });
  const tab = TAB_FOR[h];
  document.querySelectorAll('.tab').forEach((t) => {
    if (t.dataset.tab === tab) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (h === 'setup') {
    Object.assign(cfg, prefs.get(KEYS.cfg) || {}); // Record may have changed side or tripod position
    pick('side', cfg.side); pick('pos', cfg.position || ''); layout();
    showStep(step);
  }
  if (h === 'record' && prev !== 'record') record.enter();
  if (h === 'progress') library.render();
  if (h === 'practice') practice.enter();
  if (h === 'home') renderHome();
  if (h === 'replay') replay.enter();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

function say(text, force) {
  if (force !== 'force') return; // spoken only when explicitly requested
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
// Tripod position (physical place on court) — separate from serving side and phone camera.
// No default: the player must choose, so clips never carry a guessed position.
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => {
  cfg.position = b.dataset.pos; pick('pos', cfg.position); layout();
  record.setTripod(cfg.position);
  if (step === 1) { $('nextStep').disabled = false; $('nextStep').style.opacity = 1; }
}));
pick('hand', cfg.hand);
pick('side', cfg.side);
if (cfg.position) pick('pos', cfg.position);

function layout() {
  const px = cfg.side === 'deuce' ? 77 : 63;
  const right = cfg.hand === 'R';
  const behind = cfg.position === 'behind';
  $('s2Title').innerHTML = behind ? 'Put the tripod behind you' : 'Put the tripod side&#8209;on';
  $('s2Text').textContent = behind ? 'From behind, the camera looks past you towards the net.' : 'From the side, the camera sees your whole body side-on.';
  $('tipsBehind').hidden = !behind;
  $('tipsSide').hidden = behind;
  $('s3Dist').textContent = behind ? 'about 3–4 m' : 'about 5 m';
  if (behind) {
    $('player').querySelector('circle').setAttribute('cx', px);
    $('player').querySelector('text').setAttribute('x', px + 13);
    $('player').querySelector('text').setAttribute('y', 135);
    $('tripod').querySelector('circle').setAttribute('cx', px);
    $('tripod').querySelector('circle').setAttribute('cy', 160);
    $('tripT').setAttribute('x', px + 9); $('tripT').setAttribute('y', 162); $('tripT').setAttribute('text-anchor', 'start');
    $('cone').setAttribute('points', px + ',160 ' + (px - 13) + ',96 ' + (px + 13) + ',96');
    $('sight').setAttribute('x1', px); $('sight').setAttribute('x2', px);
    $('sight').setAttribute('y1', 160); $('sight').setAttribute('y2', 96);
    $('distOut').firstChild.nodeValue = 'About 3–4 m behind you';
    $('distSteps').textContent = 'roughly 4–5 big steps';
    $('farNote').hidden = true;
    prefs.set(KEYS.cfg, cfg);
    return;
  }
  $('player').querySelector('text').setAttribute('y', 146);
  $('tripod').querySelector('circle').setAttribute('cy', 133);
  $('tripT').setAttribute('y', 124);
  $('sight').setAttribute('y1', 133); $('sight').setAttribute('y2', 133);
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

let plannedSide = null; // side chosen in Practice setup; camera setup then doesn't ask again
function showStep(n) {
  step = n;
  if (n === 1) {
    $('sideField').hidden = !!plannedSide;
    $('sidePlanned').hidden = !plannedSide;
    if (plannedSide) $('sidePlanned').textContent = `You’re starting on the ${plannedSide === 'deuce' ? 'Deuce' : 'Ad'} side (from your practice plan). You can switch sides on the Record screen.`;
  }
  document.querySelectorAll('.step').forEach((s) => { s.hidden = +s.dataset.step !== n; });
  document.querySelectorAll('#stepBar span').forEach((s, i) => { s.className = i < n - 1 ? 'on' : (i === n - 1 ? 'now' : ''); });
  $('backBtn').hidden = n === 1;
  $('backBtn').parentNode.style.gridTemplateColumns = n === 1 ? '1fr' : '';
  const nb = $('nextStep');
  nb.textContent = n === 5 ? 'Save spot and start' : 'Next';
  nb.disabled = (n === 4 && !checksDone) || (n === 1 && !cfg.position);
  nb.style.opacity = nb.disabled ? 0.45 : 1;
  if (n === 3) startLevel();
  if (n === 4) startPreview(); else stopPreview();
  if (n === 5) fillSummary();
  window.scrollTo(0, 0);
}
$('backBtn').addEventListener('click', () => { if (step > 1) showStep(step - 1); });
$('nextStep').addEventListener('click', () => {
  if (step < 5) { showStep(step + 1); return; }
  prefs.set(KEYS.spot, { hand: cfg.hand, side: cfg.side, position: cfg.position, saved: Date.now() });
  record.setTripod(cfg.position);
  updatePill();
  location.hash = '#record';
});

function fillSummary() {
  const right = cfg.hand === 'R';
  const far = (cfg.side === 'deuce') !== right;
  const behind = cfg.position === 'behind';
  const rows = [
    ['Tripod position', behind ? 'Behind you, facing the net' : 'Side, filming you side-on'],
    ['Tripod spot', behind ? 'Straight behind your serving spot' : 'Baseline line, outside the ' + (right ? 'right' : 'left') + ' doubles line'],
    ['Distance', behind ? 'About 3–4 m' : far ? 'About 7 m' : 'About 5 m'],
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

/* ---------- camera preview + MoveNet skeleton (setup step 4) ---------- */
let debugTarget = null; // the preview the debug panel follows
const debug = initDebug({ getTarget: () => debugTarget, minScore: MIN_DRAW_SCORE, cameraTest: runCameraTest });
const setupPreview = new Preview(
  { video: $('cameraPreview'), canvas: $('skeletonCanvas'), box: $('setupBox'), status: $('camStatus'), retry: $('camRetry') },
  { debug },
);
debugTarget = { video: setupPreview.video, canvas: $('skeletonCanvas'), overlay: setupPreview.overlay };

/** Debug only: stop the preview, try each camera request in turn, then restart the preview. */
async function runCameraTest() {
  const wasSetup = inCameraStep();
  stopPreview();
  if (currentView === 'record') record.preview.stop(true);
  const results = [];
  for (const v of CAMERA_TEST_VARIANTS) results.push(await probeCamera(v));
  if (wasSetup) startPreview();
  if (currentView === 'record') record.preview.start();
  return results;
}
function startPreview() {
  debugTarget = { video: setupPreview.video, canvas: $('skeletonCanvas'), overlay: setupPreview.overlay };
  return setupPreview.start(prefs.get(KEYS.camera) || 'environment');
}
function stopPreview() { setupPreview.stop(); }
function inCameraStep() {
  return currentView === 'setup' && step === 4;
}
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

/* ---------- record screen (record.js) ---------- */
const replay = initReplay();
const library = initLibrary({ openClip: (id) => replay.open(id) });
const record = initRecord({ debug, openClip: (id) => replay.open(id, 'record') });
const practice = initPractice({
  onStart(session, firstSide) {
    plannedSide = firstSide;
    cfg.side = firstSide; pick('side', cfg.side); layout();
    record.setSide(firstSide);
    location.hash = prefs.get(KEYS.spot) ? '#record' : '#setup';
  },
});

/* ---------- home: latest practice ---------- */
async function renderHome() {
  const s = (await store.listSessions()).find((x) => x.clips.some((c) => c.status !== 'recording'));
  const el = $('homeRecent');
  if (!s) { el.textContent = 'No practice sessions yet.'; return; }
  const clips = s.clips.filter((c) => c.status !== 'recording');
  const secs = Math.round(clips.reduce((n, c) => n + ((c.video && c.video.durationMs) || 0), 0) / 1000);
  el.textContent = `${new Date(s.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${clips.length} clip${clips.length === 1 ? '' : 's'} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${s.plan ? ' · ' + planText(s.plan) : ''}${s.status === 'active' ? ' · in progress' : ''}`;
}
const recordDebugTarget = { video: $('recVideo'), canvas: $('recCanvas'), overlay: record.preview.overlay };
const _enter = record.enter;
record.enter = () => { debugTarget = recordDebugTarget; return _enter(); };

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

recoverUnfinishedClips().then(markUnknownTripodPositions).catch(() => {}); // clips left 'recording' by a crash/closed tab → kept as interrupted
route();
