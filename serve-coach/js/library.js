/*
 * library.js — Progress → Video recordings (MVP1 Stage B).
 *
 * Lists practice sessions newest first, each with its clips. Tapping a clip opens Replay.
 * A whole practice can be deleted (two taps). Everything lives only on this device.
 */

import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmtMB = (b) => (b / 1e6 >= 10 ? Math.round(b / 1e6) : (b / 1e6).toFixed(1)) + ' MB';
const sideName = (s) => (s === 'ad' ? 'Ad' : s === 'deuce' ? 'Deuce' : '–');
const camName = (c) => (c && c.facing === 'user' ? 'Front' : 'Rear');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function initLibrary({ openClip }) {
  let token = 0;

  async function render() {
    const my = ++token;
    const [sessions, st] = await Promise.all([store.listSessions(), store.storageStatus()]);
    if (my !== token) return;
    const list = $('libList');
    list.innerHTML = '';
    const withClips = sessions.filter((s) => s.clips.some((c) => c.status !== 'recording'));
    $('libEmpty').hidden = withClips.length > 0;
    withClips.forEach((s) => list.appendChild(sessionCard(s)));

    let line = `Stored only on this device · ${fmtMB(st.ourMB * 1e6)} used`;
    if (st.freeMB != null && !isIOS()) line += ` · about ${st.freeMB >= 1000 ? (st.freeMB / 1000).toFixed(1) + ' GB' : Math.round(st.freeMB) + ' MB'} free`;
    $('libStorage').textContent = line;
    $('libTip').hidden = !(isIOS() && !standalone() && st.persisted !== true);
  }

  function sessionCard(s) {
    const clips = s.clips.filter((c) => c.status !== 'recording');
    const li = document.createElement('li');
    li.className = 'lib-session';
    const head = document.createElement('div'); head.className = 'lib-head';
    const title = document.createElement('h3');
    title.textContent = new Date(s.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const total = clips.reduce((n, c) => n + ((c.video && c.video.durationMs) || 0), 0);
    const bytes = clips.reduce((n, c) => n + ((c.video && c.video.bytes) || 0), 0);
    const d = clips.filter((c) => c.side === 'deuce').length, a = clips.filter((c) => c.side === 'ad').length;
    const sub = document.createElement('p'); sub.className = 'lib-sub';
    sub.textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'} · ${[d && `Deuce ${d}`, a && `Ad ${a}`].filter(Boolean).join(' · ')} · ${fmtTime(total)} · ${fmtMB(bytes)}`;
    head.append(title);
    if (s.status === 'active') { const tag = document.createElement('span'); tag.className = 'lib-tag'; tag.textContent = 'In progress'; head.append(tag); }
    li.append(head, sub);

    const ul = document.createElement('ul'); ul.className = 'lib-clips';
    clips.forEach((c) => {
      const row = document.createElement('li');
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'lib-clip';
      const name = document.createElement('b'); name.textContent = `Clip ${c.seq} · ${sideName(c.side)}`;
      const meta = document.createElement('span');
      meta.textContent = `${camName(c.camera)} · ${fmtTime((c.video && c.video.durationMs) || 0)}` +
        (c.status === 'interrupted-empty' ? ' · no video saved' : c.status === 'interrupted' ? ' · interrupted' : '');
      const go = document.createElement('span'); go.className = 'lib-go'; go.textContent = 'Replay ›';
      btn.append(name, meta, go);
      btn.addEventListener('click', () => openClip(c.id));
      row.appendChild(btn);
      ul.appendChild(row);
    });
    li.appendChild(ul);

    if (s.status !== 'active') {
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn btn-danger lib-del'; del.textContent = 'Delete practice';
      let t = null;
      del.addEventListener('click', async () => {
        if (!del.classList.contains('armed')) {
          del.classList.add('armed'); del.textContent = `Tap again to delete ${clips.length} clip${clips.length === 1 ? '' : 's'}`;
          t = setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Delete practice'; }, 4000);
          return;
        }
        clearTimeout(t);
        await store.deleteSession(s.id);
        render();
      });
      li.appendChild(del);
    }
    return li;
  }

  return { render };
}
