// Unusals: write and keep unusual reports, day by day, in three groups:
// loco failures, C&W failures and others. It shares the data layer, the
// sheet / image / Excel export and the PDF / Excel reader with the DPWCS LOCO
// app next door, and the shared database table of unusual reports.

import * as L from '../js/logic.js';
import { createSync } from '../js/sync.js';
import { diffOps } from '../js/syncdata.js';
import { SUPABASE_URL, SUPABASE_KEY, REQUIRE_LOGIN } from '../js/config.js';
import { unusualSheet } from '../js/sheet.js';
import { sheetToCanvas, canvasToBlob } from '../js/canvas.js';
import { sheetToXlsx } from '../js/xlsx.js';
import { parseBlocks, parseOfficial, fillFromOfficial, parseDetention } from '../js/official.js';
import { fileToText, FileError } from '../js/filetext.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importUnusuals } from '../js/unusualimport.js';
import { EXTRA_RECORDS } from './records.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const today = () => L.dayKey(new Date());
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// The three groups and the boxes each one has. Others has them all.
const TYPES = {
  loco: { name: 'Loco failures', accent: 'k-fail', titles: ['LOCO TROUBLE-DPWCS', 'LOCO TROUBLE', 'LOCO FAILED', 'STALLED DUE TO LOCO PROBLEM', 'LOCO TROUBLE DUE TO DPWCS COMMUNICATION PROBLEM'] },
  cw: { name: 'C&W failures', accent: 'k-other', titles: ['BRAKE BINDING', 'HOT AXLE', 'DRAGGING PARTS', 'WHEEL FLAT', 'COUPLING BREAK'] },
  other: { name: 'Others', accent: 'k-dpwcs', titles: [] },
};
const FORM = {
  loco: ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'det', 'reason'],
  cw: ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason'],
  other: ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason'],
};
const LABEL = {
  day: 'Date', time: 'Time', title: 'Train details (heading)', location: 'Location', trainNo: 'Train no',
  locoNo: 'Loco no', load: 'Load', wagonNo: 'Wagon no', bpcNo: 'BPC no', det: 'DET (detention)', reason: 'Reason (what happened)',
};
const HINT = {
  title: 'brake binding', location: 'TNGM-YP/GNN', trainNo: 'ICDT C/S', locoNo: '42821', load: '40/40/3910',
  wagonNo: 'CNCR 6125060159 BLCM', bpcNo: '70000102716 TKD/25-03/CC', det: 'AT GNN 03:20 HRS',
  reason: 'Times, km, what was done, relief loco, TXR fit...',
};
const WIDE = new Set(['title', 'locoNo', 'wagonNo', 'bpcNo', 'reason']);
const kindOf = (u) => (TYPES[u.type] ? u.type : 'loco');

// ---------- storage on this device ----------

const DB = 'unusals-app';
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => { db.close(); resolve(req.result); };
      t.onerror = t.onabort = () => { db.close(); reject(t.error); };
    };
  });
}
async function loadState() {
  try { const v = await idb('readonly', (s) => s.get('state')); if (v) return v; } catch { /* fall through */ }
  try { return JSON.parse(localStorage.getItem(DB)); } catch { return null; }
}
async function saveState(s) {
  try { await idb('readwrite', (st) => st.put(s, 'state')); return true; } catch { /* fall through */ }
  try { localStorage.setItem(DB, JSON.stringify(s)); return true; } catch { return false; }
}

// ---------- state ----------

const SHARED = !!(SUPABASE_URL && SUPABASE_KEY) && !REQUIRE_LOGIN;
const NO_SYNC = { outbox: [], cursor: {}, linked: false };
let state = L.emptyState();
let sync = null;
let status = { phase: SHARED ? 'syncing' : 'local', pending: 0, email: '', error: '', unusualsMissing: false };
const ui = { view: 'loco', search: '', month: 'all' };

const who = () => (sync && sync.email ? sync.email.split('@')[0] : '');
const persist = () => { saveState(state).then((ok) => { if (!ok) toast('Could not save on this device'); }); };

function commit(next) {
  if (next === state) return;
  if (sync) {
    const ops = diffOps(state, next, who());
    state = { ...next, sync: { ...next.sync, outbox: [...next.sync.outbox, ...ops] } };
    sync.kick();
  } else {
    state = next;
  }
  persist();
}

function save(unusual) {
  if (sync && !sync.email) {
    const name = prompt('Your name, shown next to the reports you write:');
    if (name && name.trim()) sync.setName(name);
  }
  commit(L.reduce(state, { type: 'saveUnusual', unusual, now: new Date().toISOString(), by: who() }));
}

// The older reports, loaded once. With a shared database this waits until the
// device is in step with it, so reports another device loaded are not repeated.
function seed() {
  if (sync && !(state.sync.linked && status.phase === 'synced')) return;
  let next = importUnusuals(state, UNUSUAL_RECORDS);
  if (!next.extraSeeded) {
    const have = new Set(next.unusuals.map((u) => u.id));
    const now = new Date().toISOString();
    const added = EXTRA_RECORDS.filter((r) => !have.has(r.id))
      .map((r) => ({ ...L.pickUnusual(r), id: r.id, updatedAt: now, updatedBy: 'record' }));
    next = { ...next, unusuals: [...next.unusuals, ...added], extraSeeded: true };
  }
  if (next !== state) { commit(next); render(); }
}

// ---------- small helpers ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (window.matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Saved ${filename}`);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied. Paste it in WhatsApp or a message.');
}

const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' }); };

// ---------- reading files and pasted text ----------

function readOfficial(u) { try { const o = JSON.parse(u.official); return o && typeof o === 'object' ? o : null; } catch { return null; } }

function addMany(blocks) {
  const key = (u) => `${u.day}|${u.trainNo}|${u.locoNo}`.toUpperCase();
  const have = new Set(state.unusuals.map(key));
  const usable = blocks.filter((b) => b.day && b.title);
  const fresh = usable.filter((b) => !have.has(key(b)));
  if (!usable.length) { toast('Found the reports but not their dates. Add the dates and try again.'); return false; }
  if (!fresh.length) { toast(`All ${usable.length} reports in that file are already in the list.`); return false; }
  const dup = usable.length - fresh.length;
  if (!confirm(`Found ${usable.length} reports in that file${dup ? `, ${dup} already in the list` : ''}.\n\nAdd the ${fresh.length} new one${fresh.length === 1 ? '' : 's'}?`)) return false;
  // Each goes to the open group, or by its boxes (wagon or BPC number: C&W) when "All" is open.
  for (const b of fresh) {
    const type = TYPES[ui.view] ? ui.view : (b.wagonNo || b.bpcNo ? 'cw' : 'loco');
    save({ ...L.blankUnusual(b.day), ...b, type });
  }
  toast(`Added ${fresh.length} report${fresh.length === 1 ? '' : 's'}`);
  return true;
}

/** Fills the open form from a Sr.DEE report or one sheet; a sheet of many is added whole. */
function takeText(draft, text, rebuild, close) {
  // A C&W "Detention particulars of goods train" report becomes a C&W failure report.
  const cw = parseDetention(text);
  if (cw) {
    draft.type = 'cw';
    for (const key of ['day', 'title', 'location', 'trainNo', 'locoNo', 'load', 'bpcNo', 'wagonNo', 'reason', 'det']) {
      if (cw[key] && (key === 'day' || !String(draft[key] || '').trim())) draft[key] = cw[key];
    }
    toast('Read the C&W detention report. Check the boxes, then save.');
    rebuild();
    return;
  }
  const sree = /Failure Report|Incident ID/i.test(text) ? parseOfficial(text) : null;
  if (sree) {
    for (const [key, value] of Object.entries(fillFromOfficial(sree))) {
      if (value && (key === 'day' || !String(draft[key] || '').trim())) draft[key] = value;
    }
    draft.official = JSON.stringify(sree);
    draft.incident = sree.id;
    toast(`Read the Sr.DEE report, incident ${sree.id}. Check the boxes, then save.`);
    rebuild();
    return;
  }
  const blocks = parseBlocks(text);
  if (blocks.length === 1) {
    for (const key of ['day', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'reason', 'det']) {
      if (blocks[0][key] && (key === 'day' || !String(draft[key] || '').trim())) draft[key] = blocks[0][key];
    }
    toast('Read the report. Check the boxes, then save.');
    rebuild();
    return;
  }
  if (blocks.length > 1) { if (addMany(blocks)) { close(); render(); } return; }
  toast('Could not find a report in that file. Attach a Sr.DEE PDF or an Excel / PDF unusual sheet.');
}

// ---------- the form ----------

function openForm(type, existing) {
  const dlg = document.getElementById('editor');
  const draft = existing ? { ...existing } : { ...L.blankUnusual(today()), type, time: L.fmtTime(new Date()) };
  const locos = [...new Set(state.locos.map((l) => l.locoNo).filter(Boolean))];
  const close = () => dlg.close();

  // Pasting a whole report anywhere in the form is picked up and fills the boxes.
  dlg.onpaste = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/DETENTION\s+PARTICULARS|BRIEF\s+HISTORY|Failure Report|Incident ID|TRAIN\s+DETAILS/i.test(text)) return;
    e.preventDefault();
    takeText(draft, text, build, close);
  };

  const build = () => {
    const kind = kindOf(draft);
    const titles = [...new Set([...TYPES[kind].titles, ...state.unusuals.filter((u) => kindOf(u) === kind).map((u) => u.title).filter(Boolean)])];
    const field = (key) => {
      const el = key === 'reason'
        ? h('textarea', { rows: 6, value: draft[key], placeholder: HINT[key] })
        : h('input', {
          type: key === 'day' ? 'date' : key === 'time' ? 'time' : 'text', value: draft[key], placeholder: HINT[key] || '',
          autocapitalize: key === 'day' || key === 'time' ? null : 'characters', autocomplete: 'off',
        });
      el.addEventListener('input', (e) => { draft[key] = e.target.value; });
      if (key === 'title') el.setAttribute('list', 'u-titles');
      if (key === 'locoNo') el.setAttribute('list', 'u-locos');
      return h('label', { class: `field ${WIDE.has(key) ? 'wide' : ''}` }, h('span', null, LABEL[key]), el);
    };
    const readFile = async (file) => {
      if (!file) return;
      toast(`Reading ${file.name}...`);
      try { takeText(draft, await fileToText(file), build, close); } catch (e) {
        console.error(e);
        toast(e instanceof FileError ? e.message : 'Could not read that file.');
      }
    };
    const chooser = h('input', {
      type: 'file', accept: '.pdf,.xlsx,.csv,.txt,application/pdf', style: 'display:none',
      onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; readFile(f); },
    });
    const attach = h('button', { type: 'button', class: 'attach', onclick: () => chooser.click() },
      h('b', null, 'Attach PDF or Excel'),
      h('span', null, 'a C&W detention report, a Sr.DEE report or a report sheet: the data is read and the boxes are filled. A whole month adds every report.'));
    const paste = h('textarea', { rows: 2, placeholder: 'Or paste the report here (it is read as soon as you paste)', style: 'margin-bottom:6px' });
    const pasteRow = h('div', { class: 'opaste-actions', style: 'margin:0 0 14px' },
      h('button', { type: 'button', class: 'btn small', onclick: () => takeText(draft, paste.value, build, close) }, 'Read the pasted text'));
    attach.addEventListener('dragover', (e) => { e.preventDefault(); attach.classList.add('over'); });
    attach.addEventListener('dragleave', () => attach.classList.remove('over'));
    attach.addEventListener('drop', (e) => { e.preventDefault(); attach.classList.remove('over'); readFile(e.dataTransfer.files[0]); });

    dlg.replaceChildren(h('div', { class: 'editor' },
      h('div', { class: `dlg-head ${kind}` }, existing ? `Edit ${TYPES[kind].name.toLowerCase()} report, ${L.fmtDay(existing.day)}` : `New report: ${TYPES[kind].name}`),
      attach, chooser, paste, pasteRow,
      draft.official && h('p', { class: 'okline' }, `✓ Official Sr.DEE report attached${draft.incident ? `, incident ${draft.incident}` : ''}`),
      h('form', {
        class: 'u-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!draft.day) { toast('Pick the date'); return; }
          if (!draft.title.trim()) { toast('Enter the train details (the heading)'); return; }
          dlg.close();
          save(draft);
          toast(existing ? 'Saved' : 'Report saved');
          render();
        },
      },
      h('div', { class: 'grid' }, FORM[kind].map(field)),
      h('datalist', { id: 'u-titles' }, titles.map((t) => h('option', { value: t }))),
      h('datalist', { id: 'u-locos' }, locos.map((t) => h('option', { value: t }))),
      h('div', { class: 'editor-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Save report'),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel')))));
  };
  build();
  dlg.showModal();
}

// ---------- the cards ----------

function officialDetails(u) {
  const o = readOfficial(u);
  if (!o) return null;
  const tile = (label, value) => value && h('div', { class: 'o-tile' }, h('small', null, label), h('span', null, value));
  return h('details', { class: 'o-panel' },
    h('summary', null, h('span', { class: 'o-badge' }, 'Sr.DEE'), `Official report${u.incident ? `, incident ${u.incident}` : ''}`),
    h('div', { class: 'o-grid' },
      tile('Incident type', o.type), tile('Cause', o.cause), tile('Detention', o.detention), tile('Repercussions', o.repercussions),
      tile('Loco', [o.loco, o.multi && `+ ${o.multi}`].filter(Boolean).join(' ')), tile('Failed section', o.section),
      tile('Loco pilot', o.lp), tile('Assistant', o.alp), tile('CLI', o.cli)),
    o.timeline && o.timeline.length > 0 && h('ol', { class: 'o-time' }, o.timeline.map((x) => h('li', null,
      x.t ? h('b', null, x.t) : h('b', { class: 'none' }, '•'), h('span', null, x.text)))),
    o.previous && h('p', { class: 'o-prev' }, h('b', null, 'Earlier incidents: '), o.previous));
}

function card(u, showTag) {
  const kind = kindOf(u);
  const [, m, d] = u.day.split('-');
  const chip = (label, value, red) => value && h('span', { class: `chip ${red ? 'red' : ''}` }, h('small', null, label), value);
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  return h('article', { class: `ucard ${TYPES[kind].accent}` },
    h('div', { class: 'ucard-top' },
      h('div', { class: 'udate' }, h('b', null, d), h('span', null, `${MONTHS[Number(m) - 1]} ${u.day.slice(0, 4)}`), u.time && h('em', null, u.time)),
      h('div', { class: 'utitle' },
        showTag && h('span', { class: 'tag' }, TYPES[kind].name),
        h('strong', null, u.title || '(no heading)'),
        h('div', { class: 'chips' },
          chip('LOCATION', u.location), chip('TRAIN', u.trainNo), chip('LOCO', u.locoNo), chip('LOAD', u.load),
          chip('WAGON', u.wagonNo, true), chip('BPC', u.bpcNo, true))),
      u.det && h('span', { class: 'det' }, h('small', null, 'DET'), u.det)),
    u.reason && h('p', { class: 'ucard-reason' }, u.reason),
    officialDetails(u),
    h('div', { class: 'ucard-actions' },
      h('button', { class: 'link', onclick: () => openForm(kind, u) }, 'Edit'),
      h('button', { class: 'link', onclick: run(async () => {
        await shareOrDownload(await canvasToBlob(sheetToCanvas(unusualSheet([u]))), `Unusal-${L.fmtDay(u.day)}-${(u.trainNo || 'report').replace(/[^0-9A-Za-z]+/g, '-')}.png`, `UNUSALS-DATE-${L.fmtDay(u.day)}`);
      }) }, 'Share image'),
      h('button', { class: 'link', onclick: run(() => copyText(L.unusualText([u]))) }, 'Copy as text'),
      h('button', {
        class: 'link danger',
        onclick: () => {
          if (!confirm(`Delete the report of ${L.fmtDay(u.day)} (${u.title || 'no heading'})?`)) return;
          commit(L.reduce(state, { type: 'removeUnusual', id: u.id }));
          toast('Deleted');
          render();
        },
      }, 'Delete')));
}

// ---------- screens ----------

function exportBar(sheet, base, title, getText) {
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  return h('div', { class: 'actions' },
    h('button', { class: 'btn primary', onclick: run(async () => shareOrDownload(await canvasToBlob(sheetToCanvas(sheet)), `${base}.png`, title)) }, 'Share image'),
    h('button', { class: 'btn', onclick: run(async () => shareOrDownload(new Blob([sheetToXlsx(sheet)], { type: XLSX_TYPE }), `${base}.xlsx`, title)) }, 'Excel file'),
    h('button', { class: 'btn', onclick: run(() => copyText(getText())) }, 'Copy as text'));
}

function viewList() {
  const type = ui.view;
  const pool = type === 'all' ? state.unusuals : state.unusuals.filter((u) => kindOf(u) === type);
  const months = [...new Set(pool.map((u) => u.day.slice(0, 7)))].sort().reverse();
  if (ui.month !== 'all' && !months.includes(ui.month)) ui.month = 'all';

  const buildList = () => {
    const q = ui.search.trim().toLowerCase();
    const visible = pool.filter((u) => (ui.month === 'all' || u.day.startsWith(ui.month)) &&
      (!q || [u.title, u.location, u.trainNo, u.locoNo, u.reason, u.load, u.wagonNo, u.bpcNo, u.incident, L.fmtDay(u.day)].some((v) => (v || '').toLowerCase().includes(q))));
    if (!visible.length) return [h('p', { class: 'empty-big' }, pool.length ? 'No report matches.' : 'No reports yet. Press the button above to write the first one.')];
    const name = type === 'all' ? 'All' : TYPES[type].name.replace(/\W+/g, '-');
    return [
      h('p', { class: 'hint' }, `${visible.length} report${visible.length === 1 ? '' : 's'}, day by day. Share them all as one sheet, oldest first.`),
      exportBar(unusualSheet(visible, 'Unusals'), `Unusals-${name}${ui.month === 'all' ? '' : `-${monthLabel(ui.month).replace(' ', '-')}`}`, `UNUSALS ${TYPES[type] ? TYPES[type].name : ''}`.trim(), () => L.unusualText(visible)),
      L.unusualsByDay(visible).map(([day, items]) => h('section', null,
        h('h2', { class: 'section-title' }, L.fmtDay(day), h('span', { class: 'count' }, items.length)),
        h('div', { class: 'ucards' }, items.map((u) => card(u, type === 'all'))))),
    ];
  };

  const refresh = () => document.getElementById('ulist').replaceChildren(...buildList().flat());
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Search train, loco, wagon, location or reason', value: ui.search,
    oninput: (e) => { ui.search = e.target.value; refresh(); },
  });
  const month = h('select', { 'aria-label': 'Month', onchange: (e) => { ui.month = e.target.value; refresh(); } },
    h('option', { value: 'all', selected: ui.month === 'all' }, 'All months'),
    months.map((m) => h('option', { value: m, selected: m === ui.month }, monthLabel(m))));
  const newButtons = TYPES[type]
    ? [h('button', { class: `btn new ${type}`, onclick: () => openForm(type) }, `+ New ${TYPES[type].name.toLowerCase().replace(/s$/, '')} report`)]
    : Object.entries(TYPES).map(([k, t]) => h('button', { class: `btn new ${k}`, onclick: () => openForm(k) }, `+ ${t.name}`));
  return h('div', null,
    SHARED && status.unusualsMissing && h('p', { class: 'notice' },
      'Reports are being kept on this device only for now. To share them with everyone, run supabase/setup-unusuals.sql once in Supabase (steps are in the README). Nothing is lost meanwhile.'),
    h('div', { class: 'uhead' }, newButtons),
    h('div', { class: 'uhead' }, search, month),
    h('div', { id: 'ulist' }, buildList().flat()));
}

function statusText() {
  const n = status.pending;
  switch (status.phase) {
    case 'synced': return 'All changes saved to the shared database';
    case 'syncing': return n ? `Saving ${n} change${n === 1 ? '' : 's'}` : 'Checking for updates';
    case 'offline': return n ? `No internet, ${n} change${n === 1 ? '' : 's'} waiting to upload` : 'No internet, showing the last saved data';
    case 'error': return `Database problem${status.error ? `: ${status.error}` : ''}`;
    default: return 'Saved on this device';
  }
}

function render() {
  const count = (t) => state.unusuals.filter((u) => kindOf(u) === t).length;
  const tabs = [['loco', 'Loco failures', count('loco')], ['cw', 'C&W failures', count('cw')], ['other', 'Others', count('other')], ['all', 'All', state.unusuals.length]];
  document.getElementById('app').replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'top-inner' },
      h('div', { class: 'top-row' }, h('h1', null, 'UNUSALS')),
      h('p', null, `${L.fmtDay(today())}  |  ${state.unusuals.length} reports`),
      h('p', { class: 'top-meta' }, h('button', {
        class: `sync ${status.phase}`, id: 'sync-status', title: SHARED ? 'Tap to sync now' : '',
        onclick: () => { if (sync) sync.syncNow(); },
      }, statusText())))),
    h('nav', { class: 'tabs' }, tabs.map(([id, text, n]) => h('button', {
      class: ui.view === id ? 'on' : '',
      onclick: () => { ui.view = id; ui.month = 'all'; ui.search = ''; render(); window.scrollTo(0, 0); },
    }, text, h('span', { class: 'n' }, String(n))))),
    h('main', null, viewList()));
}

function onSyncStatus(next) {
  const was = status;
  status = next;
  if (status.phase === 'synced') seed();
  if (next.unusualsMissing !== was.unusualsMissing) { render(); return; }
  const line = document.getElementById('sync-status');
  if (line) { line.textContent = statusText(); line.className = `sync ${status.phase}`; }
}

async function start() {
  const stored = await loadState();
  state = { ...L.emptyState(), ...(stored || {}) };
  state.sync = { ...NO_SYNC, ...state.sync };
  await saveState(state);
  if (SHARED) {
    sync = createSync({
      url: SUPABASE_URL, key: SUPABASE_KEY, login: false,
      getState: () => state,
      setState: (next, redraw) => { state = next; persist(); if (redraw) render(); },
      onStatus: onSyncStatus,
    });
    status = { ...status, email: sync.email };
  }
  render();
  if (sync) sync.start(); else seed();
}

start();
