// Unusals: write and keep unusual reports, day by day, in three groups:
// loco failures, C&W failures and others. It shares the data layer, the
// sheet / image / Excel export and the PDF / Excel reader with the DPWCS LOCO
// app next door, and the shared database table of unusual reports.

import * as L from '../js/logic.js';
import { createSync } from '../js/sync.js';
import { diffOps } from '../js/syncdata.js';
import { SUPABASE_URL, SUPABASE_KEY, REQUIRE_LOGIN } from '../js/config.js';
import { unusualSheet, blockSheet } from '../js/sheet.js';
import { blankBlock, blankRow, computeBlock, blockMessage, blockTitle, rowDetention, longMins } from '../js/block.js';
import { buildPdf, buildPdfPages } from '../js/pdf.js';
import { drawReport } from '../js/unusalcanvas.js';
import { photosOf, reportFile } from '../js/unusalreport.js';
import { eventsEditor } from '../js/events.js';
import { repEditor } from '../js/repercussions.js';
import { blankStalling, readStalling, detShort, whatsappText, reportTitle, detentionText, hasContent, remarksText, markPosition } from '../js/stalling.js';
import { drawStalling } from '../js/stallingcanvas.js';
import { sheetToCanvas, canvasToBlob } from '../js/canvas.js';
import { sheetToXlsx } from '../js/xlsx.js';
import { readReports, tidyBatch, reportKey } from '../js/reports.js';
import { fileToText, FileError } from '../js/filetext.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importUnusuals } from '../js/unusualimport.js';
import { EXTRA_RECORDS } from './records.js';
import { dailySummary } from '../js/summary.js';
import { locoNumbers, topCounts, repeatLocos, lastDays, longestDetentions, addDays, fmtMinutes } from './stats.js';

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
  loco: ['day', 'title', 'location', 'trainNo', 'locoNo', 'load', 'det', 'reason', 'rep'],
  cw: ['day', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason', 'rep'],
  other: ['day', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason', 'rep'],
};
const LABEL = {
  day: 'Date', time: 'Time', title: 'Train details (heading)', location: 'Location', trainNo: 'Train no',
  locoNo: 'Loco no', load: 'Load', wagonNo: 'Wagon no', bpcNo: 'BPC no', detFrom: 'DET from', detTo: 'DET to', det: 'DET (detention)', reason: 'Sequence of events', rep: 'Repercussions',
};
const HINT = {
  title: 'brake binding', location: 'TNGM-YP/GNN', trainNo: 'ICDT C/S', locoNo: '42821', load: '40/40/3910',
  wagonNo: 'CNCR 6125060159 BLCM', bpcNo: '70000102716 TKD/25-03/CC', det: 'AT GNN 03:20 HRS',
  reason: 'Times, km, what was done, relief loco, TXR fit...',
  rep: '1. 17030 - VKB ARR 22:47 (leave empty if none)',
};
const WIDE = new Set(['title', 'locoNo', 'wagonNo', 'bpcNo', 'reason', 'rep']);
const FILE_TYPES = 'image/*,.docx,.pdf,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// The DPWCS LOCO app keeps a list of its own (app = 'dpwcs'); it is not part of this register.
const rows = () => state.unusuals.filter((u) => u.app !== 'dpwcs' && u.type !== 'block' && u.type !== 'stalling');
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

// A redraw (from the shared database) waits while a cell is being typed in, then happens.
let pendingRender = false;
function renderSafe() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('table.cells, .newcard')) { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });


const SHARED = !!(SUPABASE_URL && SUPABASE_KEY) && !REQUIRE_LOGIN;
const NO_SYNC = { outbox: [], cursor: {}, linked: false };
let state = L.emptyState();
let sync = null;
let status = { phase: SHARED ? 'syncing' : 'local', pending: 0, email: '', error: '', unusualsMissing: false };
const ui = { view: 'loco', search: '', month: 'all', range: 'all', from: '', to: '', sumDay: '', span: {}, focusNew: false, drafts: {}, edit: null };
let repeatMap = new Map(); // loco number -> reports in the last 90 days, when more than one

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
  commit(L.reduce(state, { type: 'saveUnusual', unusual: { ...unusual, time: '' }, now: new Date().toISOString(), by: who() }));
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

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** "07-09-2026 (MONDAY)", the way a day is written on a report. */
const officialDay = (key) => { const [y, m, d] = key.split('-').map(Number); return `${L.fmtDay(key)} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`; };
/** "MONDAY, 12-10-2026 | 14:35 HRS", the clock in the header. */
const officialNow = () => { const n = new Date(); return `${WEEKDAYS[n.getDay()]}, ${L.fmtDay(L.dayKey(n))}  |  ${L.fmtTime(n)} HRS`; };
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' }); };

// ---------- reading files and pasted text ----------

/** The repercussions of a record: as written, else the ones in its attached official report. */
const repOf = (u) => String(u.rep || (readOfficial(u) || {}).repercussions || '').trim();
function readOfficial(u) { try { const o = JSON.parse(u.official); return o && typeof o === 'object' ? o : null; } catch { return null; } }

/** Adds the new reports of a batch (many files, or a sheet of many) in one go, after asking. */
function addBatch(reports, { files = 1, unreadable = [] } = {}) {
  const have = new Set(rows().map(reportKey));
  const usable = reports.filter((r) => r.day && r.title);
  const { fresh, folded, held } = tidyBatch(usable, have);
  if (!usable.length) {
    toast(unreadable.length ? `Nothing could be read. ${unreadable.join('; ')}` : 'Found the reports but not their dates. Add the dates and try again.');
    return false;
  }
  if (!fresh.length) { toast(`All ${usable.length} report${usable.length === 1 ? '' : 's'} are already in the list.`); return false; }
  const by = { loco: 0, cw: 0, other: 0 };
  for (const r of fresh) by[r.type || 'cw']++;
  const dated = fresh.filter((r) => r.datedFromFile).length;
  const msg = [
    `Found ${usable.length} report${usable.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`,
    '',
    `New: ${fresh.length} (C&W failures ${by.cw}, loco failures ${by.loco}, others ${by.other})`,
    held ? `Already in the list: ${held}` : '',
    folded ? `Copies of the same report merged: ${folded}` : '',
    dated ? `${dated} had no date, so the day the file was saved is used.` : '',
    unreadable.length ? `\nCould not read: ${unreadable.join('; ')}` : '',
    `\nAdd the ${fresh.length} new one${fresh.length === 1 ? '' : 's'}?`,
  ].filter((x) => x !== '').join('\n');
  if (!confirm(msg)) return false;
  for (const r of fresh) save({ ...L.blankUnusual(r.day), ...r, type: r.type || 'cw' });
  toast(`Added ${fresh.length} report${fresh.length === 1 ? '' : 's'}`);
  return true;
}

/** Reads many files at once. One report fills the open form, if there is one; more are added as a batch. */
async function readFiles(list, { draft, rebuild, close } = {}) {
  const files = [...list];
  if (!files.length) return;
  toast(files.length > 1 ? `Reading ${files.length} files...` : `Reading ${files[0].name}...`);
  const all = [];
  const bad = [];
  for (const file of files) {
    try {
      const photo = /^image\//.test(file.type || '') || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i.test(file.name);
      if (photo) toast(`Reading the photo ${file.name}. The first photo can take a minute...`);
      const text = await fileToText(file, (pct) => toast(`Reading the photo ${file.name}: ${pct}%`));
      const recs = readReports(text, { fileName: file.name, lastModified: file.lastModified });
      if (!recs.length) bad.push(`${file.name} (nothing found in it)`);
      all.push(...recs);
    } catch (e) {
      console.error(e);
      bad.push(`${file.name} (${e instanceof FileError ? e.message : 'could not be read'})`);
    }
  }
  if (files.length === 1 && all.length === 1 && draft) { fillForm(draft, all[0], rebuild); return; }
  if (!all.length) { toast(bad.length ? `Nothing could be read. ${bad.join('; ')}` : 'Nothing found in those files.'); return; }
  if (addBatch(all, { files: files.length, unreadable: bad }) && close) close();
  render();
}

function fillForm(draft, r, rebuild) {
  for (const key of ['day', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'reason', 'det', 'detFrom', 'detTo', 'rep']) {
    if (r[key] && (key === 'day' || !String(draft[key] || '').trim())) draft[key] = r[key];
  }
  if (r.type && !draft.type) draft.type = r.type;
  if (r.official) { draft.official = r.official; draft.incident = r.incident || ''; }
  toast('Read the report. Check the boxes, then save.');
  rebuild();
}

/** Pasted text: one report fills the form, many are added as a batch. */
function takeText(draft, text, rebuild, close) {
  const reports = readReports(text, { fileName: '', lastModified: 0 });
  if (!reports.length) { toast('Could not find a report in that. Paste the whole report, or attach the file.'); return; }
  if (reports.length === 1) { fillForm(draft, reports[0], rebuild); return; }
  if (addBatch(reports, { files: 1 })) { close(); render(); }
}

/** Attach files without opening a form: every report in them is added. */
function bulkAttach() {
  const input = h('input', { type: 'file', multiple: true, accept: FILE_TYPES, style: 'display:none', onchange: () => { readFiles(input.files); } });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

// ---------- the form ----------

function openForm(type, existing) {
  const dlg = document.getElementById('editor');
  const draft = existing ? { ...existing, rep: repOf(existing) } : { ...L.blankUnusual(today()), type };
  const locos = [...new Set(state.locos.map((l) => l.locoNo).filter(Boolean))];
  const close = () => dlg.close();

  // Pasting a whole report anywhere in the form is picked up and fills the boxes.
  dlg.onpaste = (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/DETENTION\s+PARTICULARS|ASSET\s+FAILURE|FIRST\s+INFORMATION\s+REPORT|BRIEF\s+HISTORY|Failure Report|Incident ID|TRAIN\s+DETAILS/i.test(text)) return;
    e.preventDefault();
    takeText(draft, text, build, close);
  };

  // A loco that already has reports in the last 90 days is flagged as you type it.
  const showRepeat = () => {
    const box = dlg.querySelector('#repeat-hint');
    if (!box) return;
    const since = addDays(today(), -90);
    const nums = locoNumbers(draft.locoNo);
    const seen = nums.map((n) => ({ n, items: rows().filter((u) => u.id !== draft.id && u.day >= since && locoNumbers(u.locoNo).includes(n)) }))
      .filter((x) => x.items.length);
    box.style.display = seen.length ? 'block' : 'none';
    box.textContent = seen.map((x) => `Loco ${x.n} already has ${x.items.length} report${x.items.length === 1 ? '' : 's'} in the last 90 days (latest ${L.fmtDay(x.items.map((u) => u.day).sort().pop())})`).join('. ');
  };

  const build = () => {
    const kind = kindOf(draft);
    const titles = [...new Set([...TYPES[kind].titles, ...rows().filter((u) => kindOf(u) === kind).map((u) => u.title).filter(Boolean)])];
    const field = (key) => {
      if (key === 'rep') return h('div', { class: 'field wide' }, h('span', null, 'Repercussions (leave empty if none)'), repEditor(h, draft.rep, (v) => { draft.rep = v; }, { asOn: draft.repAsOn, onAsOn: (v) => { draft.repAsOn = v; } }));
      const el = key === 'reason' || key === 'rep'
        ? h('textarea', { rows: key === 'rep' ? 3 : 6, value: draft[key], placeholder: HINT[key] })
        : h('input', {
          type: key === 'day' ? 'date' : (key === 'time' || key === 'detFrom' || key === 'detTo') ? 'time' : 'text', value: draft[key], placeholder: HINT[key] || '',
          autocapitalize: key === 'day' || key === 'time' || key === 'detFrom' || key === 'detTo' ? null : 'characters', autocomplete: 'off',
        });
      el.addEventListener('input', (e) => {
        draft[key] = e.target.value;
        if (key === 'locoNo') showRepeat();
        if (key === 'detFrom' || key === 'detTo') {
          const d = L.detentionBetween(draft.detFrom, draft.detTo);
          if (d) { draft.det = d; const box = dlg.querySelector('[data-detbox]'); if (box) box.value = d; }
        }
      });
      if (key === 'det') el.setAttribute('data-detbox', '1');
      if (key === 'title') el.setAttribute('list', 'u-titles');
      if (key === 'locoNo') el.setAttribute('list', 'u-locos');
      return h('label', { class: `field ${WIDE.has(key) ? 'wide' : ''}` }, h('span', null, LABEL[key]), el);
    };
    const take = (list) => readFiles(list, { draft, rebuild: build, close });
    const chooser = h('input', {
      type: 'file', multiple: true, accept: FILE_TYPES, style: 'display:none',
      onchange: (e) => { const list = [...e.target.files]; e.target.value = ''; take(list); },
    });
    const attach = h('button', { type: 'button', class: 'attach', onclick: () => chooser.click() },
      h('b', null, 'Attach a photo, Word, PDF or Excel file'),
      h('span', null, 'Select as many files as you like at a time. The data is read from them and the boxes are filled; several reports are all added together.'));
    const paste = h('textarea', { rows: 2, placeholder: 'Or paste the report here (it is read as soon as you paste)', style: 'margin-bottom:6px' });
    const pasteRow = h('div', { class: 'opaste-actions', style: 'margin:0 0 14px' },
      h('button', { type: 'button', class: 'btn small', onclick: () => takeText(draft, paste.value, build, close) }, 'Read the pasted text'));
    attach.addEventListener('dragover', (e) => { e.preventDefault(); attach.classList.add('over'); });
    attach.addEventListener('dragleave', () => attach.classList.remove('over'));
    attach.addEventListener('drop', (e) => { e.preventDefault(); attach.classList.remove('over'); take(e.dataTransfer.files); });

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
      h('div', { class: 'grid' }, [...FORM[kind].filter((k) => k !== 'reason' && k !== 'rep'), ...['load', 'wagonNo', 'bpcNo'].filter((k) => !FORM[kind].includes(k) && String(draft[k] || '').trim()), 'reason', 'rep']
        .map((k) => (k === 'det' ? h('div', { class: 'det-row' }, field('detFrom'), field('detTo'), field('det')) : field(k)))),
      h('div', { id: 'repeat-hint', class: 'repeat-hint', style: 'display:none' }),
      photoStrip(draft, build),
      h('datalist', { id: 'u-titles' }, titles.map((t) => h('option', { value: t }))),
      h('datalist', { id: 'u-locos' }, locos.map((t) => h('option', { value: t }))),
      h('div', { class: 'editor-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Save report'),
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancel')))));
  };
  build();
  showRepeat();
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

function repeatNote(u) {
  const hits = locoNumbers(u.locoNo).filter((n) => repeatMap.has(n));
  if (!hits.length) return null;
  return h('p', { class: 'rep-note' }, hits.map((n) => `Loco ${n}: ${repeatMap.get(n)} reports in 90 days`).join('  |  '));
}

function card(u, showTag) {
  const kind = kindOf(u);
  const [, m, d] = u.day.split('-');
  const chip = (label, value, red) => value && h('span', { class: `chip ${red ? 'red' : ''}` }, h('small', null, label), value);
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  return h('article', { class: `ucard ${TYPES[kind].accent}` },
    h('div', { class: 'ucard-top' },
      h('div', { class: 'udate' }, h('b', null, d), h('span', null, `${MONTHS[Number(m) - 1]} ${u.day.slice(0, 4)}`)),
      h('div', { class: 'utitle' },
        showTag && h('span', { class: 'tag' }, TYPES[kind].name),
        h('strong', null, u.title || '(no heading)'),
        h('div', { class: 'chips' },
          chip('LOCATION', u.location), chip('TRAIN', u.trainNo), chip('LOCO', u.locoNo), chip('LOAD', u.load),
          chip('WAGON', u.wagonNo, true), chip('BPC', u.bpcNo, true))),
      u.det && h('span', { class: 'det' }, h('small', null, 'DET'), u.det)),
    u.reason && h('p', { class: 'ucard-reason' }, u.reason),
    u.rep && h('p', { class: 'ucard-rep' }, h('b', null, 'REPERCUSSIONS '), u.rep),
    repeatNote(u),
    officialDetails(u),
    h('div', { class: 'ucard-actions' },
      h('button', { class: 'link', onclick: () => openForm(kind, u) }, 'Edit'),
      h('button', { class: 'link', onclick: run(async () => {
        await shareOrDownload(await canvasToBlob(sheetToCanvas(unusualSheet([u]))), `Unusal-${L.fmtDay(u.day)}-${(u.trainNo || 'report').replace(/[^0-9A-Za-z]+/g, '-')}.png`, `UNUSALS-DATE-${L.fmtDay(u.day)}`);
      }) }, 'Share image'),
      h('button', { class: 'link', onclick: run(() => copyText(L.unusualText([u]))) }, 'Copy as text'),
      h('button', { class: 'link', onclick: run(async () => shareOrDownload(await reportPdfBlob([u]), `${reportFile(u)}.pdf`, u.title || 'Unusal')) }, 'PDF'),
      h('button', { class: 'link', onclick: () => openPhotos(u) }, photosOf(u).length ? `Photos (${photosOf(u).length})` : 'Add photos'),
      kind === 'loco' && h('button', { class: 'link', onclick: () => openStallingForm(null, u) }, 'Stalling report'),
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

function exportBar(sheet, base, title, getText, reports) {
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  return h('div', { class: 'actions' },
    h('button', { class: 'btn primary', onclick: run(async () => shareOrDownload(await canvasToBlob(sheetToCanvas(sheet)), `${base}.png`, title)) }, 'Share image'),
    h('button', { class: 'btn', onclick: run(async () => shareOrDownload(new Blob([sheetToXlsx(sheet)], { type: XLSX_TYPE }), `${base}.xlsx`, title)) }, 'Excel file'),
    h('button', { class: 'btn', onclick: run(() => copyText(getText())) }, 'Copy as text'),
    reports && h('button', { class: 'btn', onclick: run(async () => { toast('Making the PDF...'); shareOrDownload(await reportPdfBlob(L.unusualsInOrder(reports)), `${base}.pdf`, title); }) }, 'PDF, a page each'),
    h('button', { class: 'btn whatsapp', onclick: () => sendWhatsApp(getText()) }, 'Send on WhatsApp'));
}

/** Each report as a page like the report format (details, events, remarks, repercussions, photographs), in one PDF. */
async function reportPdfBlob(list) {
  const pages = [];
  for (const u of list) {
    const canvas = await drawReport(u, 1);
    const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), w: canvas.width, h: canvas.height });
  }
  return new Blob([buildPdfPages(pages)], { type: 'application/pdf' });
}

const MAX_PHOTOS = 6;

/** In a report form: take or choose the photographs of the unusual, so they are saved with the report. */
function photoStrip(draft, rebuild) {
  const list = photosOf(draft);
  const set = () => { draft.photos = list.length ? JSON.stringify(list) : ''; };
  const add = async (input) => {
    const files = [...input.files].slice(0, MAX_PHOTOS - list.length);
    input.value = '';
    if (!files.length) return;
    toast('Adding the photos...');
    for (const f of files) { try { list.push(await pictureData(f, 900)); } catch { toast('That photo could not be read.'); } }
    set();
    rebuild();
  };
  const tile = (label, capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: !capture, hidden: true, onchange: () => add(input) });
    if (capture) input.setAttribute('capture', 'environment');
    return h('button', { type: 'button', class: 'btn', disabled: list.length >= MAX_PHOTOS, onclick: () => input.click() }, label, input);
  };
  return h('div', { class: 'photo-strip' },
    h('div', { class: 'photo-strip-head' }, h('b', null, 'Photos of the unusual'), h('span', null, list.length ? `${list.length} of ${MAX_PHOTOS}` : 'optional'), tile('Camera', true), tile('Gallery', false)),
    list.length > 0 && h('div', { class: 'photo-grid' }, list.map((src, i) => h('figure', null, h('img', { src, alt: `Photo ${i + 1}` }),
      h('button', { type: 'button', class: 'link danger', onclick: () => { list.splice(i, 1); set(); rebuild(); } }, 'Remove')))));
}

/** The photographs of a record: take or choose them, look at them, remove one. They go on the PDF. */
function openPhotos(u) {
  const dlg = document.getElementById('editor');
  let list = photosOf(u);
  const build = () => {
    const add = async (input) => {
      const files = [...input.files].slice(0, MAX_PHOTOS - list.length);
      input.value = '';
      if (!files.length) return;
      toast('Adding the photos...');
      for (const f of files) { try { list.push(await pictureData(f, 900)); } catch { toast('That photo could not be read.'); } }
      build();
    };
    const tile = (label, capture) => {
      const input = h('input', { type: 'file', accept: 'image/*', multiple: !capture, hidden: true, onchange: () => add(input) });
      if (capture) input.setAttribute('capture', 'environment');
      return h('button', { type: 'button', class: 'btn', disabled: list.length >= MAX_PHOTOS, onclick: () => input.click() }, label, input);
    };
    dlg.replaceChildren(h('div', { class: 'editor' },
      h('h2', null, `Photos: ${u.title || 'report'}`),
      h('p', { class: 'hint' }, `Up to ${MAX_PHOTOS} photos. They are saved with the report and printed on its PDF.`),
      h('div', { class: 'photo-grid' }, list.length
        ? list.map((src, i) => h('figure', null, h('img', { src, alt: `Photo ${i + 1}` }),
          h('button', { type: 'button', class: 'link danger', onclick: () => { list.splice(i, 1); build(); } }, 'Remove')))
        : h('p', { class: 'nothing' }, 'No photos yet.')),
      h('div', { class: 'actions' }, tile('Camera', true), tile('Gallery', false)),
      h('div', { class: 'editor-actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => { dlg.close(); save({ ...u, photos: list.length ? JSON.stringify(list) : '' }); toast('Photos saved'); render(); } }, 'Save'),
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'))));
  };
  build();
  dlg.showModal();
}

/** The daily message for a day: counts, then a short line for each report. */
const daySummaryText = (day) => dailySummary(rows(), day, { title: 'SCR UNUSALS', kindOf });

/** Opens WhatsApp with the reports as a message to send to anyone or any group. */
function sendWhatsApp(text) {
  const max = 5500; // a longer message does not fit in a WhatsApp link
  const cut = text.length > max;
  const body = cut ? `${text.slice(0, max).replace(/\n[^\n]*$/, '')}\n...` : text;
  // One named tab for every send: the WhatsApp Web already opened is used again, not a new tab each time.
  // (A phone has no WhatsApp Web, so it goes to the WhatsApp app.)
  const link = window.matchMedia('(pointer: coarse)').matches ? 'https://wa.me/' : 'https://web.whatsapp.com/send';
  window.open(`${link}?text=${encodeURIComponent(body)}`, 'scr-whatsapp-web');
  if (cut) toast('A long list is cut for WhatsApp. Use Share image or Excel file to send all of it.');
}

// ---------- block detention ----------

const blocks = () => state.unusuals.filter((u) => u.type === 'block');
const readBlock = (u) => { try { return { ...blankBlock(u.day), ...JSON.parse(u.block) }; } catch { return blankBlock(u.day); } };
const blockFile = (b, ext) => `Block-detention-${L.fmtDay(b.day)}-${String(b.name || b.station || 'report').replace(/[^0-9A-Za-z]+/g, '-')}.${ext}`;

async function blockPdfBlob(b) {
  const canvas = sheetToCanvas(blockSheet(b));
  const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  return new Blob([buildPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height)], { type: 'application/pdf' });
}

function blockCard(u) {
  const b = readBlock(u);
  const k = computeBlock(b);
  const [, m, d] = u.day.split('-');
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  const chip = (label, value, red) => value && h('span', { class: `chip ${red ? 'red' : ''}` }, h('small', null, label), value);
  return h('article', { class: 'ucard k-dpwcs' },
    h('div', { class: 'ucard-top' },
      h('div', { class: 'udate' }, h('b', null, d), h('span', null, `${MONTHS[Number(m) - 1]} ${u.day.slice(0, 4)}`)),
      h('div', { class: 'utitle' },
        h('strong', null, k.title || 'BLOCK'),
        h('div', { class: 'chips' },
          chip('BLOCK', b.from || b.to ? `${b.from || '--:--'} to ${b.to || '--:--'}` : ''),
          chip('CLEARED', b.cleared),
          chip('BURST', k.burst === null ? '' : (k.burst > 0 ? `${k.burst} MINS` : 'NIL'), k.burst > 0),
          chip('TRAINS', k.rows.length ? String(k.rows.length) : '')))),
    k.rows.length > 0 && h('ol', { class: 'brows' }, k.rows.map((r) => h('li', null,
      h('b', null, `${String(r.tr || 'TRAIN').toUpperCase()}${r.at ? ` at ${String(r.at).toUpperCase()}` : ''}`),
      h('span', null, r.det ? `${r.det.mins} MINS${r.det.still ? ' (not departed)' : ''}` : '')))),
    k.total > 0 && h('p', { class: 'ucard-rep' }, h('b', null, 'TOTAL DETENTION '), `${k.total} MINS`),
    h('div', { class: 'ucard-actions' },
      h('button', { class: 'link', onclick: () => openBlockForm(u) }, 'Edit'),
      h('button', { class: 'link', onclick: () => sendWhatsApp(blockMessage(b)) }, 'Send on WhatsApp'),
      h('button', { class: 'link', onclick: run(() => copyText(blockMessage(b))) }, 'Copy text'),
      h('button', { class: 'link', onclick: run(async () => shareOrDownload(await canvasToBlob(sheetToCanvas(blockSheet(b))), blockFile(b, 'png'), k.title)) }, 'Image'),
      h('button', { class: 'link', onclick: run(async () => shareOrDownload(await blockPdfBlob(b), blockFile(b, 'pdf'), k.title)) }, 'PDF'),
      h('button', {
        class: 'link danger',
        onclick: () => {
          if (!confirm(`Delete the block report of ${L.fmtDay(u.day)} (${k.title || 'block'})?`)) return;
          commit(L.reduce(state, { type: 'removeUnusual', id: u.id }));
          toast('Deleted');
          render();
        },
      }, 'Delete')));
}

/** The form: the block, then the trains held up. Durations, burst and detentions come by themselves. */
function openBlockForm(existing, inline) {
  const dlg = inline ? inline.host : document.getElementById('editor');
  const b = inline ? inline.b : (existing ? readBlock(existing) : blankBlock(today()));
  const detEls = [];
  let durEl;
  let burstEl;
  let totalEl;

  const refresh = () => {
    const k = computeBlock(b);
    durEl.textContent = k.duration === null ? '' : longMins(k.duration);
    burstEl.textContent = k.burst === null ? '' : (k.burst > 0 ? `${k.burst} MINS` : 'NIL (cleared in time)');
    b.rows.forEach((r, i) => {
      const d = rowDetention(b, r);
      if (detEls[i]) detEls[i].textContent = d ? `${d.mins}${d.still ? '*' : ''}` : '';
    });
    totalEl.textContent = k.total > 0 ? `${k.rows.length} trains, ${k.total} MINS in all` : '';
  };
  const box = (get, set, label, type = 'text', placeholder = '') => {
    const el = h('input', { type, value: get(), placeholder, autocomplete: 'off', autocapitalize: type === 'text' ? 'characters' : null });
    el.addEventListener('input', (e) => { set(e.target.value); refresh(); });
    return h('label', { class: 'field' }, h('span', null, label), el);
  };
  // a box with no label of its own: the row heads above the rows name the columns
  const bare = (get, set, label, type = 'text', placeholder = '') => {
    const el = h('input', { type, value: get(), placeholder, 'aria-label': label, autocomplete: 'off', autocapitalize: type === 'text' ? 'characters' : null });
    el.addEventListener('input', (e) => { set(e.target.value); refresh(); });
    return el;
  };
  const auto = (label, setEl) => h('div', { class: 'field' }, h('span', null, `${label} (automatic)`), h('div', { class: 'autochip' }, setEl(h('b'))));

  const build = () => {
    detEls.length = 0;
    // UP, DN, or NO DIRECTION when the block has none to name: the heading then leaves the direction out
    const dirs = h('div', { class: 'segs' }, [['UP', 'UP'], ['DN', 'DN'], ['', 'NO DIRECTION']].map(([v, text]) => h('button', { type: 'button', class: `seg ${(b.dir || '') === v ? 'on' : ''}`, onclick: () => { b.dir = v; build(); } }, text)));
    const rowsBox = h('div', { class: 'rep-rows' },
      h('div', { class: 'rep-head' }, ['S', 'Tr.no', 'At stn', 'From', 'To', 'Det mins'].map((t) => h('span', null, t))),
      b.rows.map((r, i) => h('div', { class: 'rep-row' },
        h('span', { class: 'rn' }, String(i + 1)),
        bare(() => r.tr, (v) => { r.tr = v; }, 'Train number', 'text', 'KSNK'),
        bare(() => r.at, (v) => { r.at = v; }, 'At station', 'text', 'CT'),
        bare(() => r.from, (v) => { r.from = v; }, 'From', 'time'),
        bare(() => r.to, (v) => { r.to = v; }, 'To (empty if not departed)', 'time'),
        h('div', { class: 'autochip', title: 'Detention in minutes, worked out by itself' }, (detEls[i] = h('b'))))),
      h('p', { class: 'rep-note' }, 'Leave To empty if the train has not left: its detention then runs up to the "As on" time (marked *). For a train kept at the home signal or in the section, write the place yourself, for example CT HOME or CT-SUH SEC: STN is added only to a plain station name.'));

    dlg.replaceChildren(h('div', { class: inline ? 'editor inline-form' : 'editor' },
      !inline && h('div', { class: 'dlg-head block' }, existing ? 'Edit block detention report' : 'New block detention report'),
      h('form', {
        class: 'u-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!b.day) { toast('Pick the date'); return; }
          if (!String(b.name).trim() && !String(b.station).trim()) { toast('Enter the name of the block or the station'); return; }
          b.name = String(b.name).trim().toUpperCase();
          b.station = String(b.station).trim().toUpperCase();
          if (!inline) dlg.close();
          save({ ...(existing || L.blankUnusual(b.day)), day: b.day, type: 'block', title: blockTitle(b), location: b.station, block: JSON.stringify(b) });
          toast('Block report saved');
          if (inline) inline.saved(b.day);
          render();
        },
      },
      h('div', { class: 'grid' },
        box(() => b.day, (v) => { b.day = v; }, 'Date', 'date'),
        h('div', { class: 'field' }, h('span', null, 'Direction'), dirs),
        box(() => b.station, (v) => { b.station = v; }, '1. Station (two with a dash: WP-BG)', 'text', 'WP-BG'),
        box(() => b.name, (v) => { b.name = v; }, '2. Name of block (BLOCK is added at the end)', 'text', 'BCM'),
        h('div', { class: 'det-row three' },
          box(() => b.from, (v) => { b.from = v; }, '3. Block permitted from', 'time'),
          box(() => b.to, (v) => { b.to = v; }, 'to', 'time'),
          auto('Duration', (el) => { durEl = el; return el; })),
        h('div', { class: 'det-row three' },
          box(() => b.cleared, (v) => { b.cleared = v; }, '4. Block cleared at', 'time'),
          auto('5. Block burst', (el) => { burstEl = el; return el; }),
          box(() => b.asOn, (v) => { b.asOn = v; }, 'As on (trains not departed)', 'time'))),
      h('h3', { class: 'rep-title' }, 'Repercussion'),
      rowsBox,
      h('div', { class: 'rep-foot' },
        h('button', { type: 'button', class: 'btn small', onclick: () => { b.rows.push(blankRow()); build(); } }, '+ Add a row'),
        (totalEl = h('span', { class: 'total' }))),
      h('div', { class: 'editor-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Save report'),
        h('button', { type: 'button', class: 'btn', onclick: inline ? inline.clear : () => dlg.close() }, inline ? 'Clear' : 'Cancel')))));
    refresh();
  };
  build();
  if (!inline) dlg.showModal();
}

/** The reports of the chosen days, a heading for each day, newest day first. */
const groupedCards = (items, card) => (items.length
  ? L.unusualsByDay(items).map(([day, list]) => h('section', null,
    h('h2', { class: 'section-title' }, officialDay(day), h('span', { class: 'count' }, String(list.length))),
    h('div', { class: 'ucards' }, list.map(card))))
  : h('p', { class: 'empty-big' }, 'No report in these dates.'));

/** Send or copy all the reports of the chosen days as one message. */
function messageBar(items, textOf) {
  if (!items.length) return null;
  const text = () => L.unusualsInOrder(items).map(textOf).join('\n\n----------\n\n');
  return h('div', { class: 'actions' },
    h('button', { class: 'btn whatsapp', onclick: () => sendWhatsApp(text()) }, 'Send on WhatsApp'),
    h('button', { class: 'btn', onclick: () => copyText(text()) }, 'Copy text'));
}

/** A new report on the page: a card with the form in it, kept in ui so a redraw loses nothing. */
function entryCard(kind, title, fill) {
  const host = h('div');
  const fresh = (day) => { ui.drafts[kind] = null; fill(day); };
  const draft = ui.drafts[kind];
  fill(draft.day, host, {
    saved: (day) => { ui.drafts[kind] = null; ui.span[kind] = { from: day, to: day }; },
    clear: () => { const day = draft.day; fresh(day); render(); },
  });
  return h('section', { class: `newcard ${kind}` }, h('div', { class: 'newhead' }, h('h2', null, title)), host);
}

function viewBlocks() {
  const list = blocks();
  if (!ui.drafts.block) ui.drafts.block = blankBlock(today());
  const card = entryCard('block', 'New block detention report', (day, host, inline) => {
    if (!host) { ui.drafts.block = blankBlock(day); return; }
    openBlockForm(null, { ...inline, host, b: ui.drafts.block });
  });
  return h('div', { class: 'failures' },
    SHARED && status.unusualsMissing && h('p', { class: 'notice' }, 'Reports are being kept on this device only for now. To share them with everyone, run supabase/setup-unusuals.sql once in Supabase.'),
    card,
    h('h2', { class: 'section-title saved-title' }, 'Saved reports', h('small', null, 'today to begin with')),
    dayShell('block', list, (items) => [messageBar(items, (u) => blockMessage(readBlock(u))), groupedCards(items, blockCard)]));
}

// ---------- by date ----------
// Nothing from the past is shown until a date is clicked. The dates are listed at the
// side; the reports of the clicked day are shown on their own.

/**
 * The saved reports of a tab: a slim bar with From, To and Today, and the reports of those days
 * right under it. Today's are shown to begin with. content(items, label): what to show.
 */
function dayShell(view, items, content) {
  const r = (ui.span[view] && (ui.span[view].from || ui.span[view].to)) ? ui.span[view] : { from: today(), to: today() };
  const set = (from, to) => {
    if (from && to && from > to) [from, to] = [to, from]; // typed the wrong way round
    ui.span[view] = { from, to };
    render();
  };
  const box = (key, label) => h('label', { class: 'dfield' }, label, h('input', {
    type: 'date', value: r[key], 'aria-label': `${label} date`,
    onchange: (e) => set(key === 'from' ? e.target.value : r.from, key === 'to' ? e.target.value : r.to),
  }));
  const isToday = r.from === today() && r.to === today();
  const inRange = items.filter((u) => (!r.from || u.day >= r.from) && (!r.to || u.day <= r.to));
  const label = r.from && r.to && r.from === r.to ? officialDay(r.from)
    : `${r.from ? L.fmtDay(r.from) : 'the start'} to ${r.to ? L.fmtDay(r.to) : L.fmtDay(today())}`;
  return h('div', { class: 'dayview' },
    h('div', { class: 'rangebar' }, box('from', 'From'), box('to', 'To'),
      h('button', { class: `btn small ${isToday ? 'on' : ''}`, onclick: () => set(today(), today()) }, 'Today')),
    h('div', { class: 'daymain' },
      h('h2', { class: 'section-title' }, label, h('span', { class: 'count' }, String(inRange.length))),
      content(inRange, label)));
}

// ---------- loco, C&W and all failures ----------
// The tab opens with a new report ready to fill in, cells with Save and Clear. The
// reports already saved are not listed: they appear when a date is clicked, one
// row each, with Edit and Delete.

const KIND_NAME = { loco: 'Loco', cw: 'C&W', other: 'Other' };
const REPORT_BOXES = ['title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'detFrom', 'detTo', 'reason'];
const isBlankDraft = (d) => !REPORT_BOXES.some((k) => String(d[k] || '').trim());
const boxesOf = (kind) => FORM[kind].filter((k) => k !== 'day');

function draftFor(view) {
  if (!ui.drafts[view]) ui.drafts[view] = { ...L.blankUnusual(today()), type: view === 'all' ? 'loco' : view };
  return ui.drafts[view];
}

/** The report as it is typed: the cells, Save, Clear, and a way to read a file or a pasted report into them. */
function newReportCard(view) {
  const draft = draftFor(view);
  const kind = view === 'all' ? draft.type : view;
  const titles = [...new Set([...TYPES[kind === 'other' ? 'other' : kind].titles, ...rows().filter((u) => kindOf(u) === kind).map((u) => u.title).filter(Boolean)])].filter((t) => t.length <= 32).slice(0, 6);
  const locos = [...new Set(state.locos.map((l) => l.locoNo).filter(Boolean))];
  let hintEl;

  const showRepeat = () => {
    if (!hintEl) return;
    const since = addDays(today(), -90);
    const seen = locoNumbers(draft.locoNo).map((n) => ({ n, items: rows().filter((u) => u.day >= since && locoNumbers(u.locoNo).includes(n)) })).filter((x) => x.items.length);
    hintEl.style.display = seen.length ? 'block' : 'none';
    hintEl.textContent = seen.map((x) => `Loco ${x.n} already has ${x.items.length} report${x.items.length === 1 ? '' : 's'} in the last 90 days (latest ${L.fmtDay(x.items.map((u) => u.day).sort().pop())})`).join('. ');
  };

  const cell = (key) => {
    if (key === 'reason') {
      return h('div', { class: 'ncell s4 events' }, h('span', null, 'Sequence of events'),
        eventsEditor(h, draft.reason, (v) => { draft.reason = v; }));
    }
    if (key === 'rep') {
      return h('div', { class: 'ncell s4 events' }, h('span', null, 'Repercussions (leave empty if none)'),
        repEditor(h, draft.rep, (v) => { draft.rep = v; }, { asOn: draft.repAsOn, onAsOn: (v) => { draft.repAsOn = v; } }));
    }
    const isText = false;
    const el = isText
      ? h('textarea', { rows: 3, placeholder: HINT[key] || '' })
      : h('input', {
        type: key === 'detFrom' || key === 'detTo' ? 'time' : 'text', placeholder: HINT[key] && key !== 'detFrom' && key !== 'detTo' ? `e.g. ${HINT[key]}` : '',
        autocapitalize: key === 'detFrom' || key === 'detTo' ? null : 'characters', autocomplete: 'off',
      });
    el.value = draft[key] || '';
    el.setAttribute('data-box', key);
    if (key === 'title') el.setAttribute('list', 'u-titles');
    if (key === 'locoNo') el.setAttribute('list', 'u-locos');
    el.addEventListener('input', (e) => {
      draft[key] = e.target.value;
      if (key === 'locoNo') showRepeat();
      if (key === 'detFrom' || key === 'detTo') {
        const d = L.detentionBetween(draft.detFrom, draft.detTo);
        if (d) { draft.det = d; const box = card.querySelector('[data-box="det"]'); if (box) box.value = d; }
      }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); } });
    return h('label', { class: `ncell ${key === 'reason' || key === 'rep' ? 's4' : WIDE.has(key) ? 's2' : ''}` }, h('span', null, LABEL[key]), el);
  };

  const doSave = () => {
    if (!draft.day) { toast('Pick the date'); return; }
    if (isBlankDraft(draft)) { toast('Type the report first'); return; }
    if (!String(draft.title || '').trim()) { toast('Enter the train details (the heading)'); const t = card.querySelector('[data-box="title"]'); if (t) t.focus(); return; }
    save({ ...draft, type: kind });
    const day = draft.day;
    ui.drafts[view] = null;
    draftFor(view).day = day; // the next report is usually of the same day
    ui.span[view] = { from: day, to: day }; // and the saved one is shown below
    toast('Report saved');
    render();
  };
  const doClear = () => { const day = draft.day; ui.drafts[view] = null; draftFor(view).day = day; render(); };

  const take = (list) => readFiles(list, { draft, rebuild: render, close: () => {} });
  const chooser = h('input', {
    type: 'file', multiple: true, accept: FILE_TYPES, style: 'display:none',
    onchange: (e) => { const list = [...e.target.files]; e.target.value = ''; take(list); },
  });

  const segs = view === 'all' && h('div', { class: 'segs kind-segs' }, Object.entries(KIND_NAME).map(([k, n]) => h('button', {
    type: 'button', class: `seg ${draft.type === k ? 'on' : ''}`, onclick: () => { draft.type = k; render(); },
  }, n)));

  const grid = h('div', { class: 'ngrid' }, boxesOf(kind).map((k) => (k === 'det'
    ? h('div', { class: 'ncell s4 det3' }, h('label', { class: 'ncell' }, h('span', null, LABEL.detFrom), cell('detFrom').querySelector('input')),
      h('label', { class: 'ncell' }, h('span', null, LABEL.detTo), cell('detTo').querySelector('input')), cell('det'))
    : cell(k))));

  const card = h('section', { class: `newcard ${kind}` },
    h('div', { class: 'newhead' },
      h('h2', null, `New ${view === 'all' ? '' : `${KIND_NAME[kind].toLowerCase()} failure `}report`.replace('  ', ' ')),
      segs,
      h('label', { class: 'ndate' }, h('span', null, 'Date'), h('input', {
        type: 'date', value: draft.day, 'aria-label': 'Date of the report',
        onchange: (e) => { draft.day = e.target.value; if (draft.day) ui.span[view] = { from: draft.day, to: draft.day }; render(); },
      }))),
    grid,
    titles.length > 0 && h('div', { class: 'quick' }, h('span', null, 'Quick heading:'), titles.map((t) => h('button', {
      type: 'button', class: 'qchip', onclick: () => { draft.title = t; const el = card.querySelector('[data-box="title"]'); if (el) { el.value = t; el.focus(); } },
    }, t))),
    (hintEl = h('div', { class: 'repeat-hint', style: 'display:none' })),
    photoStrip(draft, render),
    h('datalist', { id: 'u-titles' }, titles.map((t) => h('option', { value: t }))),
    h('datalist', { id: 'u-locos' }, locos.map((t) => h('option', { value: t }))),
    h('div', { class: 'newactions' },
      h('button', { type: 'button', class: 'btn primary', onclick: doSave }, 'Save report'),
      h('button', { type: 'button', class: 'btn', onclick: doClear }, 'Clear'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn', onclick: () => chooser.click() }, 'Attach a file or photo'),
      chooser),
    h('p', { class: 'hint' }, 'You can also paste a whole report anywhere in this box, or attach Word, PDF, Excel files or photos: the cells are filled for you. Ctrl+Enter saves.'));

  card.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/DETENTION\s+PARTICULARS|ASSET\s+FAILURE|FIRST\s+INFORMATION\s+REPORT|BRIEF\s+HISTORY|Failure Report|Incident ID|TRAIN\s+DETAILS/i.test(text)) return;
    e.preventDefault();
    takeText(draft, text, render, () => {});
  });
  showRepeat();
  return card;
}

/** The saved reports of the chosen days: one row each, a heading row for each day. Edit turns a row into cells with Save and Cancel. */
const runSafe = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };

function dayRecords(view, items, label) {
  const order = boxesOf(view === 'loco' ? 'loco' : 'cw');
  const grow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  const span = order.length + 2;
  const body = h('tbody');
  let n = 0;
  for (const [day, list] of L.unusualsByDay(items).reverse()) { // oldest day first, like the shared sheet
    body.append(h('tr', { class: 'dayrow' }, h('td', { colspan: span }, officialDay(day), h('span', { class: 'count' }, String(list.length)))));
    for (const u of list) {
      n++;
      if (ui.edit && ui.edit.id === u.id) {
        const buf = ui.edit.buf;
        const tr = h('tr', { class: 'editing' }, h('td', { class: 'sr' }, String(n)));
        for (const key of order) {
          if (key === 'rep') { tr.append(h('td', { class: 'c-reason' }, repEditor(h, buf.rep || '', (v) => { buf.rep = v; }, { min: 1, asOn: buf.repAsOn, onAsOn: (v) => { buf.repAsOn = v; } }))); continue; }
          if (key === 'reason') { tr.append(h('td', { class: 'c-reason' }, eventsEditor(h, buf.reason || '', (v) => { buf.reason = v; }, { min: 2 }))); continue; }
          const el = h('textarea', { rows: 1, class: 'cell', 'aria-label': LABEL[key], autocapitalize: key === 'reason' ? null : 'characters' });
          el.value = buf[key] || '';
          el.addEventListener('input', () => { buf[key] = el.value; grow(el); });
          requestAnimationFrame(() => grow(el));
          tr.append(h('td', { class: key === 'title' ? 'c-title' : key === 'reason' ? 'c-reason' : '' }, el));
        }
        tr.append(h('td', { class: 'act' },
          h('button', { class: 'btn small primary', onclick: () => { save({ ...u, ...buf }); ui.edit = null; toast('Saved'); render(); } }, 'Save'),
          h('button', { class: 'btn small', onclick: () => { ui.edit = null; render(); } }, 'Cancel')));
        body.append(tr);
        continue;
      }
      const tr = h('tr', null, h('td', { class: 'sr' }, String(n)));
      for (const key of order) tr.append(h('td', { class: `ro ${key === 'title' ? 'c-title strong' : key === 'reason' ? 'c-reason' : ''}` }, String((key === 'rep' ? repOf(u) : u[key]) || '')));
      tr.append(h('td', { class: 'act' },
        h('button', { class: 'link', onclick: () => { ui.edit = { id: u.id, buf: { ...Object.fromEntries(order.map((k) => [k, (k === 'rep' ? repOf(u) : u[k]) || ''])), repAsOn: u.repAsOn || '' } }; render(); } }, 'Edit'),
        h('button', { class: 'link', onclick: runSafe(async () => shareOrDownload(await canvasToBlob(await drawReport(u, 1)), `${reportFile(u)}.png`, u.title || 'Unusal')) }, 'Share'),
        h('button', { class: 'link', onclick: runSafe(async () => shareOrDownload(await reportPdfBlob([u]), `${reportFile(u)}.pdf`, u.title || 'Unusal')) }, 'PDF'),
        h('button', { class: 'link', onclick: runSafe(() => copyText(L.unusualText([u]))) }, 'Copy text'),
        h('button', { class: 'link', onclick: () => sendWhatsApp(L.unusualText([u])) }, 'WhatsApp'),
        h('button', { class: 'link', onclick: () => openPhotos(u) }, photosOf(u).length ? `Photos (${photosOf(u).length})` : 'Photos'),
        kindOf(u) === 'loco' && h('button', { class: 'link', onclick: () => openStallingForm(null, u) }, 'Stalling'),
        h('button', { class: 'link danger', onclick: () => {
          if (!confirm(`Delete the report of ${L.fmtDay(u.day)} (${u.title || 'no heading'})?`)) return;
          commit(L.reduce(state, { type: 'removeUnusual', id: u.id }));
          toast('Deleted');
          render();
        } }, 'Delete')));
      body.append(tr);
      const extra = officialDetails(u);
      if (extra) body.append(h('tr', { class: 'subrow' }, h('td', { colspan: span }, extra)));
    }
  }
  const head = h('thead', null, h('tr', null, h('th', { class: 'sr' }, '#'), order.map((k) => h('th', null, LABEL[k])), h('th', { class: 'act' }, '')));
  const heading = `SCR UNUSALS ${label}`;
  return h('div', null,
    items.length > 0 && exportBar(unusualSheet(items, 'Unusals'), `Unusals-${label.replace(/[^0-9A-Za-z]+/g, '-')}`, heading, () => `*${heading}*\n\n${L.unusualText(items)}`, items),
    items.length
      ? h('div', { class: 'cells-wrap' }, h('table', { class: 'cells' }, head, body))
      : h('p', { class: 'empty-big' }, 'No report in these dates. Write one in the box above: it is saved on the date shown there.'));
}

function viewList() {
  const view = ['loco', 'cw', 'all'].includes(ui.view) ? ui.view : 'all';
  const pool = view === 'all' ? rows() : rows().filter((u) => kindOf(u) === view);
  return h('div', { class: 'failures' },
    SHARED && status.unusualsMissing && h('p', { class: 'notice' },
      'Reports are being kept on this device only for now. To share them with everyone, run supabase/setup-unusuals.sql once in Supabase (steps are in the README). Nothing is lost meanwhile.'),
    newReportCard(view),
    h('h2', { class: 'section-title saved-title' }, 'Saved reports'),
    dayShell(view, pool, (items, label) => dayRecords(view, items, label)));
}

// ---------- stalling reports ----------

const stallings = () => state.unusuals.filter((u) => u.type === 'stalling');
const readStallingOf = (u) => readStalling(u.stalling, u.day);
const stallingFile = (s, ext) => `Stalling-${L.fmtDay(s.day)}-${String(s.trainNo || 'report').replace(/[^0-9A-Za-z]+/g, '-')}.${ext}`;

/** A picture chosen on this device, made small enough to be kept with the report. */
async function pictureData(file, maxW = 1100) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let width = Math.min(maxW, img.width);
    let out = '';
    for (const q of [0.6, 0.5, 0.4]) {
      const c = document.createElement('canvas');
      c.width = Math.round(width);
      c.height = Math.round(img.height * (width / img.width));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length < 220000) break;
      width *= 0.8;
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

async function stallingBlob(s, type) {
  const canvas = await drawStalling(s, 1);
  if (type === 'png') return canvasToBlob(canvas);
  const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  return new Blob([buildPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height)], { type: 'application/pdf' });
}

/** The saved record for a stalling report. The whole report is kept as text in the "stalling" box. */
function stallingRecord(existing, s) {
  return {
    ...(existing || L.blankUnusual(s.day)), day: s.day, type: 'stalling', title: reportTitle(s), trainNo: s.trainNo, locoNo: s.locoNo,
    load: s.load, location: s.section, reason: s.cause, det: detShort(s), stalling: JSON.stringify(s),
  };
}

/** The report on screen, with the ways to send it. */
async function openStallingReport(u) {
  const dlg = document.getElementById('editor');
  const s = readStallingOf(u);
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  dlg.replaceChildren(h('div', { class: 'editor wide' }, h('p', { class: 'loading' }, 'Drawing the report...')));
  dlg.showModal();
  const canvas = await drawStalling(s, 1);
  canvas.className = 'spage';
  dlg.replaceChildren(h('div', { class: 'editor wide' },
    h('div', { class: 'dlg-head stalling' }, reportTitle(s)),
    h('div', { class: 'spage-wrap' }, canvas),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: run(async () => shareOrDownload(await stallingBlob(s, 'pdf'), stallingFile(s, 'pdf'), reportTitle(s))) }, 'PDF'),
      h('button', { class: 'btn', onclick: run(async () => shareOrDownload(await stallingBlob(s, 'png'), stallingFile(s, 'png'), reportTitle(s))) }, 'Image'),
      h('button', { class: 'btn whatsapp', onclick: () => sendWhatsApp(whatsappText(s)) }, 'Send on WhatsApp'),
      h('button', { class: 'btn', onclick: run(() => copyText(whatsappText(s))) }, 'Copy text'),
      h('button', { class: 'btn', onclick: () => { dlg.close(); openStallingForm(u); } }, 'Edit'),
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close'))));
}

function stallingCard(u) {
  const s = readStallingOf(u);
  const [, m, d] = u.day.split('-');
  const chip = (label, value, red) => value && h('span', { class: `chip ${red ? 'red' : ''}` }, h('small', null, label), value);
  const run = (fn) => async () => { try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); } };
  return h('article', { class: 'ucard k-stall' },
    h('div', { class: 'ucard-top' },
      h('div', { class: 'udate' }, h('b', null, d), h('span', null, `${MONTHS[Number(m) - 1]} ${u.day.slice(0, 4)}`)),
      h('div', { class: 'utitle' },
        h('strong', null, reportTitle(s)),
        h('div', { class: 'chips' },
          chip('SECTION', s.section), chip('KM', s.km), chip('LOCO', s.locoNo), chip('LOAD', s.load), chip('CAUSE', s.cause, true))),
      u.det && h('span', { class: 'det' }, h('small', null, 'DET'), u.det)),
    detentionText(s) && h('p', { class: 'ucard-rep' }, detentionText(s)),
    h('div', { class: 'ucard-actions' },
      h('button', { class: 'link', onclick: () => openStallingReport(u) }, 'Open report'),
      h('button', { class: 'link', onclick: () => openStallingForm(u) }, 'Edit'),
      h('button', { class: 'link', onclick: () => sendWhatsApp(whatsappText(s)) }, 'Send on WhatsApp'),
      h('button', { class: 'link', onclick: run(async () => shareOrDownload(await stallingBlob(s, 'pdf'), stallingFile(s, 'pdf'), reportTitle(s))) }, 'PDF'),
      h('button', { class: 'link', onclick: run(async () => shareOrDownload(await stallingBlob(s, 'png'), stallingFile(s, 'png'), reportTitle(s))) }, 'Image'),
      h('button', {
        class: 'link danger',
        onclick: () => {
          if (!confirm(`Delete the stalling report of ${L.fmtDay(u.day)} (train ${s.trainNo || ''})?`)) return;
          commit(L.reduce(state, { type: 'removeUnusual', id: u.id }));
          toast('Deleted');
          render();
        },
      }, 'Delete')));
}

/**
 * The form, with the boxes of the stalling report in its own order: when it happened, the train
 * and stalling details, the sequence of events, remarks, repercussions, then the two pictures.
 * existing: a saved stalling report to edit. from: a loco failure to start from (its train, loco,
 * load, section and what it says happened are carried over).
 */
function openStallingForm(existing, from, inline) {
  const dlg = inline ? inline.host : document.getElementById('editor');
  const s = inline ? inline.s : (existing ? readStallingOf(existing) : blankStalling(from ? from.day : today()));
  if (!inline && !existing && from) {
    Object.assign(s, { trainNo: from.trainNo || '', locoNo: from.locoNo || '', load: from.load || '', section: from.location || '', remarks: from.reason || '' });
  }
  let autoEl;
  let markEl;
  const locos = [...new Set(state.locos.map((l) => l.locoNo).filter(Boolean))];
  const refresh = () => {
    if (autoEl) autoEl.textContent = detentionText(s) || 'The detention is worked out by itself from the time of the incident and the spot departure.';
    if (markEl) {
      const p = markPosition(s);
      markEl.textContent = s.markOff ? 'The stall is not marked on the profile.'
        : p === null ? 'Give the km at the left and right edge of the profile picture and the stall is marked at its km by itself.'
          : `The stall (km ${s.km}) is marked ${Math.round(p)}% along the picture${String(s.markX) !== '' ? ' (set by hand)' : ''}.`;
    }
  };

  const box = (key, label, type = 'text', placeholder = '', wide = false, list = '') => {
    const el = h('input', { type, value: s[key], placeholder, autocomplete: 'off', autocapitalize: type === 'text' ? 'characters' : null });
    if (list) el.setAttribute('list', list);
    el.addEventListener('input', (e) => { s[key] = e.target.value; refresh(); });
    return h('label', { class: `field ${wide ? 'wide' : ''}` }, h('span', null, label), el);
  };
  const bare = (get, set, label, placeholder, type = 'text') => {
    const el = h('input', { type, value: get(), placeholder, 'aria-label': label, autocomplete: 'off' });
    el.addEventListener('input', (e) => { set(e.target.value); refresh(); });
    return el;
  };

  const picture = (imgKey, label) => {
    const holder = h('div', { class: 'pic-holder' });
    const chooser = h('input', {
      type: 'file', accept: 'image/*', style: 'display:none',
      onchange: async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try { s[imgKey] = await pictureData(f); show(); } catch { toast('That picture could not be read.'); }
      },
    });
    const show = () => holder.replaceChildren(
      s[imgKey] ? h('img', { src: s[imgKey], alt: label, class: 'pic-thumb' }) : h('span', { class: 'nothing' }, 'No picture yet. Take a photo of the page or choose one.'),
      h('div', { class: 'pic-actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => chooser.click() }, s[imgKey] ? 'Change picture' : 'Add picture'),
        s[imgKey] && h('button', { type: 'button', class: 'btn small', onclick: () => { s[imgKey] = ''; show(); } }, 'Remove')));
    show();
    return h('div', null, holder, chooser);
  };

  const build = () => {
    const eventRows = h('div', { class: 'ev-rows' },
      s.events.map((e, i) => h('div', { class: 'ev-row' },
        bare(() => e.t, (v) => { e.t = v; }, 'Time', '19:06–19:27'),
        bare(() => e.text, (v) => { e.text = v; }, 'What happened', 'Backed up to km 479/01, but did not start'),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Remove this row', onclick: () => { s.events.splice(i, 1); if (!s.events.length) s.events.push({ t: '', text: '' }); build(); } }, '×'))));
    const repRows = h('div', { class: 'ev-rows' },
      s.repercussions.map((r, i) => h('div', { class: 'ev-row rep' },
        h('span', { class: 'rn' }, String(i + 1)),
        bare(() => r, (v) => { s.repercussions[i] = v; }, 'Repercussion', 'MLSW – KMT ARR 19:33'),
        h('button', { type: 'button', class: 'x', 'aria-label': 'Remove this row', onclick: () => { s.repercussions.splice(i, 1); if (!s.repercussions.length) s.repercussions.push(''); build(); } }, '×'))));
    const remarks = h('textarea', { rows: 4, value: s.remarks, placeholder: 'Left empty, the remarks are written from the train timings and the events.' });
    remarks.addEventListener('input', (e) => { s.remarks = e.target.value; });
    const slider = h('input', {
      type: 'range', min: 0, max: 100, value: String(s.markX) !== '' ? s.markX : (markPosition(s) ?? 95), 'aria-label': 'Move the red line along the picture',
      oninput: (e) => { s.markX = e.target.value; refresh(); },
    });

    dlg.replaceChildren(h('div', { class: inline ? 'editor inline-form' : 'editor' },
      !inline && h('div', { class: 'dlg-head stalling' }, existing ? 'Edit stalling report' : 'New stalling report'),
      h('form', {
        class: 'u-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!s.day) { toast('Pick the date of the incident'); return; }
          if (!hasContent(s)) { toast('Write at least the train and what happened'); return; }
          s.trainNo = s.trainNo.trim().toUpperCase();
          const rec = stallingRecord(existing, s);
          if (!inline) dlg.close();
          save(rec);
          toast('Stalling report saved');
          if (inline) inline.saved(rec.day);
          render();
          const saved = state.unusuals.find((u) => u.id === rec.id);
          if (saved) openStallingReport(saved);
        },
      },
      h('div', { class: 'grid' }, box('day', 'Date of incident', 'date'), box('stallAt', 'Time of incident', 'time')),
      h('h3', { class: 'rep-title' }, 'Train and stalling details'),
      h('div', { class: 'grid' },
        box('trainNo', 'Train No', 'text', 'DRTA'),
        box('locoNo', 'Loco No', 'text', '44022 / G-9 / BRC / 28/10', false, 'st-locos'),
        box('load', 'Load', 'text', '47 / 47 / 4104 T (BLC wagons)'),
        box('section', 'Section', 'text', 'KMT – MLMG'),
        box('km', 'Stalled at KM', 'text', '478/01'),
        box('gradient', 'Gradient', 'text', '1 in 106 (rising for UP train)'),
        box('speed', 'Loco speed at stalling point', 'text', 'Normal'),
        box('signals', 'Signal aspects', 'text', 'Through'),
        box('cause', 'Cause of stalling', 'text', 'Drizzling weather', true)),
      h('h3', { class: 'rep-title' }, 'Sequence of events'),
      h('div', { class: 'grid three' }, box('station', 'Previous station and line', 'text', 'KMT main line'), box('arr', 'Arr', 'time'), box('dep', 'Dep', 'time')),
      eventRows,
      h('div', { class: 'rep-foot' }, h('button', { type: 'button', class: 'btn small', onclick: () => { s.events.push({ t: '', text: '' }); build(); } }, '+ Add a row')),
      h('p', { class: 'rep-note' }, 'The time of the incident becomes the first row ("Loco stalled at km ...") by itself. Write the rest: backed up, relief loco asked, relief loco arrived, EOT, spot departure, and so on.'),
      h('div', { class: 'auto-det' }, (autoEl = h('b'))),
      h('details', { class: 'o-panel' },
        h('summary', null, 'Relief loco arrived / spot departure times, if they are not written in the events'),
        h('div', { class: 'grid' }, box('reliefAt', 'Relief loco arrived', 'time'), box('spotDep', 'Spot departure', 'time'))),
      h('h3', { class: 'rep-title' }, 'Remarks'),
      remarks,
      h('div', { class: 'rep-foot' }, h('button', {
        type: 'button', class: 'btn small',
        onclick: () => { const keep = s.remarks; s.remarks = ''; const text = remarksText(s); s.remarks = keep; remarks.value = text; s.remarks = text; },
      }, 'Write the remarks from the events')),
      h('h3', { class: 'rep-title' }, 'Repercussions'),
      repRows,
      h('div', { class: 'rep-foot' }, h('button', { type: 'button', class: 'btn small', onclick: () => { s.repercussions.push(''); build(); } }, '+ Add a row')),
      h('h3', { class: 'rep-title' }, 'Load table'),
      picture('loadImg', 'Load table'),
      h('details', { class: 'o-panel' }, h('summary', null, 'Heading and note under the load table (optional)'),
        h('div', { class: 'grid' }, box('loadHead', 'Heading', 'text', 'Load table (BZA–KZJ: 220 km, ruling gradient 1 in 150)', true), box('loadNote', 'Note', 'text', 'Single WAG-9 is P* for 45 BLC. The train had 47 BLC, 2 wagons above.', true))),
      h('h3', { class: 'rep-title' }, 'Section profile at the stalling point'),
      picture('profileImg', 'Section profile'),
      h('div', { class: 'grid' },
        box('profFrom', 'Km at the left edge of the picture', 'text', '465'),
        box('profTo', 'Km at the right edge of the picture', 'text', '479')),
      h('div', { class: 'auto-det' }, (markEl = h('b'))),
      h('label', { class: 'check' }, h('input', {
        type: 'checkbox', checked: !s.markOff,
        onchange: (e) => { s.markOff = !e.target.checked; refresh(); },
      }), 'Mark the stall km on the profile with a red line'),
      h('div', { class: 'mark-tune' },
        h('span', null, 'Fine-tune'), slider,
        h('button', { type: 'button', class: 'btn small', onclick: () => { s.markX = ''; build(); } }, 'Place by km')),
      h('details', { class: 'o-panel' }, h('summary', null, 'Heading and note under the profile (optional)'),
        h('div', { class: 'grid' }, box('profileHead', 'Heading', 'text', 'Section profile at the stalling point (UP line, Warangal–Vijayawada)', true), box('profileNote', 'Note', 'text', 'At km 478/01 the profile is F 106 (1 in 106), steeper than 1 in 150.', true))),
      h('datalist', { id: 'st-locos' }, locos.map((t) => h('option', { value: t }))),
      h('div', { class: 'editor-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Save and show the report'),
        h('button', { type: 'button', class: 'btn', onclick: inline ? inline.clear : () => dlg.close() }, inline ? 'Clear' : 'Cancel')))));
    refresh();
  };
  build();
  if (!inline) dlg.showModal();
}

function viewStalling() {
  const list = stallings();
  if (!ui.drafts.stalling) ui.drafts.stalling = blankStalling(today());
  const card = entryCard('stalling', 'New stalling report', (day, host, inline) => {
    if (!host) { ui.drafts.stalling = blankStalling(day); return; }
    openStallingForm(null, null, { ...inline, host, s: ui.drafts.stalling });
  });
  return h('div', { class: 'failures' },
    SHARED && status.unusualsMissing && h('p', { class: 'notice' }, 'Reports are being kept on this device only for now. To share them with everyone, run supabase/setup-unusuals.sql once in Supabase.'),
    card,
    h('h2', { class: 'section-title saved-title' }, 'Saved reports', h('small', null, 'today to begin with')),
    dayShell('stalling', list, (items) => [messageBar(items, (u) => whatsappText(readStallingOf(u))), groupedCards(items, stallingCard)]));
}

// ---------- install as an app ----------
// Chrome and Edge (Windows and Android) hand us an install prompt; other
// browsers get short instructions. A strip at the top offers it in one tap.

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('Installed. Open SCR UNUSALS from your apps or home screen.'); render(); });

const BANNER_KEY = 'unusals-install-banner-closed';
const bannerClosed = () => { try { return localStorage.getItem(BANNER_KEY) === '1'; } catch { return false; } };
const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function installApp() {
  if (installPrompt) {
    const p = installPrompt;
    installPrompt = null;
    p.prompt();
    await p.userChoice.catch(() => null);
    return;
  }
  const dlg = document.getElementById('editor');
  const step = (title, ...lines) => h('section', null, h('h3', null, title), h('ol', null, lines.map((l) => h('li', null, l))));
  dlg.replaceChildren(h('div', { class: 'editor help' },
    h('h2', null, 'Install SCR UNUSALS'),
    h('p', null, 'It installs straight from this page. There is nothing to download from a store.'),
    step('Windows computer (Chrome or Edge)',
      'Open this page in Chrome or Edge.',
      'Click the install icon at the right end of the address bar (a small screen with a down arrow), or open the three-dot menu and choose "Install SCR UNUSALS" (Chrome: Cast, save and share, then Install page as app; Edge: Apps, then Install this site as an app).',
      'Click Install. It opens in its own window and appears in the Start menu. Right-click its taskbar icon and choose "Pin to taskbar" to keep it handy.'),
    step('Android phone (Chrome)', 'Open this page in Chrome.', 'Tap the three-dot menu at the top right.', 'Tap "Add to Home screen", then "Install".'),
    step('iPhone (Safari)', 'Open this page in Safari.', 'Tap the Share button.', 'Tap "Add to Home Screen", then "Add".'),
    h('div', { class: 'editor-actions' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Close'))));
  dlg.showModal();
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
  const count = (t) => rows().filter((u) => kindOf(u) === t).length;
  const tabs = [['loco', 'Loco failures', count('loco')], ['stalling', 'Stalling', stallings().length], ['cw', 'C&W failures', count('cw')], ['all', 'All', rows().length], ['block', 'Block detention', blocks().length]];
  const dots = { stalling: 'var(--k-stall)', loco: 'var(--k-fail)', cw: 'var(--k-other)', other: 'var(--k-dpwcs)', all: 'var(--navy)', overview: 'var(--navy)', block: '#6f8bff' };
  repeatMap = new Map(repeatLocos(rows(), addDays(today(), -90)).map((r) => [r.loco, r.count]));
  document.getElementById('app').replaceChildren(
    h('header', { class: `top ${!isInstalled() && !bannerClosed() ? 'has-banner' : ''}` },
      !isInstalled() && !bannerClosed() && h('div', { class: 'install-banner' },
        h('button', { class: 'install-go', onclick: installApp },
          h('strong', null, 'Tap here to install SCR UNUSALS'),
          h('span', null, 'Opens from your home screen or Start menu like any other app')),
        h('button', { class: 'install-close', 'aria-label': 'Hide the install message', onclick: () => { try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* private mode */ } render(); } }, '\u00d7')),
      // the Indian Railways logo on the left, the TI GOODS symbol on the right, the name between
      h('div', { class: 'top-wide' },
        h('img', { class: 'edge edge-round', src: '../icons/logo.png', alt: 'Indian Railways' }),
        h('div', { class: 'top-center' },
          h('h1', null, 'SCR UNUSALS'),
          h('span', { class: 'brand-sub' }, 'SOUTH CENTRAL RAILWAY'),
          h('p', { class: 'clock', id: 'clock' }, officialNow()),
          h('p', { class: 'count-line' }, `${rows().length} unusual reports on record`),
          h('p', { class: 'top-meta' }, h('button', {
            class: `sync ${status.phase}`, id: 'sync-status', title: SHARED ? 'Tap to sync now' : '',
            onclick: () => { if (sync) sync.syncNow(); },
          }, statusText())),
          !isInstalled() && h('button', { class: 'install', onclick: installApp }, 'Install app')),
        h('img', { class: 'edge edge-badge', src: 'icons/tigoods.png', alt: 'TI GOODS' }))),
    h('nav', { class: 'tabs' }, tabs.map(([id, text, n]) => h('button', {
      class: ui.view === id ? 'on' : '',
      onclick: () => { ui.view = id; ui.month = 'all'; ui.search = ''; ui.range = 'all'; ui.from = ''; ui.to = ''; render(); window.scrollTo(0, 0); },
    }, h('i', { class: 'dot-k', style: `--c:${dots[id]}` }), text, n != null && h('span', { class: 'n' }, String(n))))),
    h('main', null, ui.view === 'block' ? viewBlocks() : ui.view === 'stalling' ? viewStalling() : viewList()));
  if (ui.focusNew) { ui.focusNew = false; const first = document.querySelector('tr.newrow textarea'); if (first) first.focus(); }
}

function onSyncStatus(next) {
  const was = status;
  status = next;
  if (status.phase === 'synced') seed();
  if (next.unusualsMissing !== was.unusualsMissing) { renderSafe(); return; }
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
      setState: (next, redraw) => { state = next; persist(); if (redraw) renderSafe(); },
      onStatus: onSyncStatus,
    });
    status = { ...status, email: sync.email };
  }
  render();
  setInterval(() => { const el = document.getElementById('clock'); if (el) el.textContent = officialNow(); }, 15000);
  if (sync) sync.start(); else seed();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
