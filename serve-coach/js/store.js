/*
 * store.js — persistence.
 *
 * Stage 0: small preferences in LocalStorage (same keys as the new-app prototype,
 * so an existing saved camera spot and notes carry over on the same origin).
 * Stage 3/4: IndexedDB for session records, attempts and video blobs.
 *
 * Everything stays on this device. Clearing browser data deletes it.
 */

export const KEYS = {
  cfg: 'sc-cfg',     // { hand: 'R'|'L', side: 'deuce'|'ad' }
  spot: 'sc-spot',   // { hand, side, saved: timestamp }
  notes: 'sc-notes', // string[]
};

export const prefs = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  },
};
