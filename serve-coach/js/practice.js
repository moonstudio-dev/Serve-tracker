/*
 * practice.js — Practice setup screen (MVP1 Stage C).
 *
 * The player picks which side(s) to practise (Both / Deuce only / Ad only) and, optionally,
 * a target of up to 10 serves per selected side (Both = target on Deuce + target on Ad).
 * Targets are a guide, not a limit: nothing stops recording when they're reached, and the
 * side can still be changed on the Record screen. Serves are not counted in MVP1.
 *
 * Starting a practice ends any unfinished one (its clips stay saved) and creates a new
 * session with the plan stored on it: plan = { sides, targetPerSide, targets: {deuce, ad} }.
 */

import * as store from './store.js';

const $ = (id) => document.getElementById(id);
export const MAX_TARGET = 10;

export function planSides(plan) {
  const s = plan && plan.sides;
  return s === 'deuce' ? ['deuce'] : s === 'ad' ? ['ad'] : ['deuce', 'ad'];
}

/** Short human description, e.g. "Both sides · 10 serves each". */
export function planText(plan) {
  if (!plan) return '';
  const sides = plan.sides === 'deuce' ? 'Deuce only' : plan.sides === 'ad' ? 'Ad only' : 'Both sides';
  if (!plan.targetPerSide) return sides;
  return `${sides} · ${plan.targetPerSide} serve${plan.targetPerSide === 1 ? '' : 's'}${plan.sides === 'both' ? ' each' : ''}`;
}

export function initPractice({ onStart, getHand = () => null }) {
  let sides = 'both';
  let useTarget = true;
  let target = MAX_TARGET;

  function paint() {
    document.querySelectorAll('[data-psides]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.psides === sides)));
    document.querySelectorAll('[data-ptarget]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.ptarget === 'on') === useTarget)));
    $('pStepper').hidden = !useTarget;
    $('pTargetN').textContent = String(target);
    $('pMinus').disabled = target <= 1;
    $('pPlus').disabled = target >= MAX_TARGET;
    $('pSummary').textContent = !useTarget
      ? 'No target. Record as many clips as you like.'
      : sides === 'both' ? `Aim for ${target} on Deuce and ${target} on Ad (${target * 2} in total).`
        : `Aim for ${target} serve${target === 1 ? '' : 's'} on the ${sides === 'deuce' ? 'Deuce' : 'Ad'} side.`;
  }
  document.querySelectorAll('[data-psides]').forEach((b) => b.addEventListener('click', () => { sides = b.dataset.psides; paint(); }));
  document.querySelectorAll('[data-ptarget]').forEach((b) => b.addEventListener('click', () => { useTarget = b.dataset.ptarget === 'on'; paint(); }));
  $('pMinus').addEventListener('click', () => { target = Math.max(1, target - 1); paint(); });
  $('pPlus').addEventListener('click', () => { target = Math.min(MAX_TARGET, target + 1); paint(); });

  $('pStart').addEventListener('click', async () => {
    $('pStart').disabled = true;
    try {
      const old = await store.getActiveSession();
      if (old) await store.endSession(old.id);
      const t = useTarget ? target : null;
      const plan = {
        sides, targetPerSide: t,
        targets: { deuce: sides !== 'ad' ? t : null, ad: sides !== 'deuce' ? t : null },
      };
      // Handedness is copied onto the session so clips keep the right value if the profile changes.
      const session = await store.createSession(plan, { playerHand: getHand(), cameraSetup: null });
      onStart(session, planSides(plan)[0]);
    } finally { $('pStart').disabled = false; }
  });

  async function enter() {
    paint();
    const s = await store.getActiveSession();
    const clips = s ? await store.getSessionClips(s.id) : [];
    $('pResume').hidden = !clips.length;
    if (clips.length) {
      $('pResumeText').textContent = `You have an unfinished practice from ${new Date(s.createdAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} with ${clips.length} clip${clips.length === 1 ? '' : 's'}. Starting a new one keeps those clips saved.`;
      $('pContinue').onclick = () => { location.hash = '#record'; };
    }
  }

  return { enter };
}
