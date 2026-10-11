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
import { readReports, tidyBatch, reportKey } from '../js/reports.js';
import { fileToText, FileError } from '../js/filetext.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importUnusuals } from '../js/unusualimport.js';
import { EXTRA_RECORDS } from './records.js';
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
  loco: ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'det', 'reason'],
  cw: ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason'],
  other: ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason'],
};
const LABEL = {
  day: 'Date', time: 'Time', title: 'Train details (heading)', location: 'Location', trainNo: 'Train no',
  locoNo: 'Loco no', load: 'Load', wagonNo: 'Wagon no', bpcNo: 'BPC no', detFrom: 'DET from', detTo: 'DET to', det: 'DET (detention)', reason: 'Reason (what happened)',
};
const HINT = {
  title: 'brake binding', location: 'TNGM-YP/GNN', trainNo: 'ICDT C/S', locoNo: '42821', load: '40/40/3910',
  wagonNo: 'CNCR 6125060159 BLCM', bpcNo: '70000102716 TKD/25-03/CC', det: 'AT GNN 03:20 HRS',
  reason: 'Times, km, what was done, relief loco, TXR fit...',
};
const WIDE = new Set(['title', 'locoNo', 'wagonNo', 'bpcNo', 'reason']);
const FILE_TYPES = 'image/*,.docx,.pdf,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// The DPWCS LOCO app keeps a list of its own (app = 'dpwcs'); it is not part of this register.
const rows = () => state.unusuals.filter((u) => u.app !== 'dpwcs');
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
const ui = { view: 'overview', search: '', month: 'all', range: 'all', from: '', to: '' };
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

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** "07-09-2026 (MONDAY)", the way a day is written on a report. */
const officialDay = (key) => { const [y, m, d] = key.split('-').map(Number); return `${L.fmtDay(key)} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`; };
/** "MONDAY, 12-10-2026 | 14:35 HRS", the clock in the header. */
const officialNow = () => { const n = new Date(); return `${WEEKDAYS[n.getDay()]}, ${L.fmtDay(L.dayKey(n))}  |  ${L.fmtTime(n)} HRS`; };
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' }); };

// ---------- reading files and pasted text ----------

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
  for (const key of ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'reason', 'det', 'detFrom', 'detTo', 'rep']) {
    if (r[key] && (key === 'day' || key === 'time' || !String(draft[key] || '').trim())) draft[key] = r[key];
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
  const draft = existing ? { ...existing } : { ...L.blankUnusual(today()), type, time: L.fmtTime(new Date()) };
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
      const el = key === 'reason'
        ? h('textarea', { rows: 6, value: draft[key], placeholder: HINT[key] })
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
      h('div', { class: 'grid' }, [...FORM[kind].slice(0, -1), ...['load', 'wagonNo', 'bpcNo'].filter((k) => !FORM[kind].includes(k) && String(draft[k] || '').trim()), 'reason']
        .map((k) => (k === 'det' ? h('div', { class: 'det-row' }, field('detFrom'), field('detTo'), field('det')) : field(k)))),
      h('div', { id: 'repeat-hint', class: 'repeat-hint', style: 'display:none' }),
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
      h('div', { class: 'udate' }, h('b', null, d), h('span', null, `${MONTHS[Number(m) - 1]} ${u.day.slice(0, 4)}`), u.time && h('em', null, `${u.time} HRS`)),
      h('div', { class: 'utitle' },
        showTag && h('span', { class: 'tag' }, TYPES[kind].name),
        h('strong', null, u.title || '(no heading)'),
        h('div', { class: 'chips' },
          chip('LOCATION', u.location), chip('TRAIN', u.trainNo), chip('LOCO', u.locoNo), chip('LOAD', u.load),
          chip('WAGON', u.wagonNo, true), chip('BPC', u.bpcNo, true))),
      u.det && h('span', { class: 'det' }, h('small', null, 'DET'), u.det)),
    u.reason && h('p', { class: 'ucard-reason' }, u.reason),
    repeatNote(u),
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
    h('button', { class: 'btn', onclick: run(() => copyText(getText())) }, 'Copy as text'),
    h('button', { class: 'btn whatsapp', onclick: () => sendWhatsApp(getText()) }, 'Send on WhatsApp'));
}

/** Opens WhatsApp with the reports as a message to send to anyone or any group. */
function sendWhatsApp(text) {
  const max = 5500; // a longer message does not fit in a WhatsApp link
  const cut = text.length > max;
  const body = cut ? `${text.slice(0, max).replace(/\n[^\n]*$/, '')}\n...` : text;
  window.open(`https://wa.me/?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
  if (cut) toast('A long list is cut for WhatsApp. Use Share image or Excel file to send all of it.');
}

function viewOverview() {
  const list = rows();
  const t = today();
  const month = t.slice(0, 7);
  const week = addDays(t, -6);
  const count = (k) => list.filter((u) => kindOf(u) === k).length;
  const kpi = (view, label, n) => h('button', { class: `kpi ${TYPES[view] ? TYPES[view].accent : ''}`, onclick: () => { ui.view = view; render(); window.scrollTo(0, 0); } },
    h('b', null, String(n)), h('span', null, label));
  const days = lastDays(list, 14, t, kindOf);
  const peak = Math.max(1, ...days.map((d) => d.loco + d.cw + d.other));
  const rank = (items, empty, sub) => (items.length
    ? h('ul', { class: 'rank' }, items.map(([name, n, extra]) => h('li', null,
      h('div', { class: 'row' }, h('span', null, name), h('span', null, extra || `${n}`)),
      h('div', { class: 'meter' }, h('i', { style: `width:${Math.round((n / items[0][1]) * 100)}%` })),
      sub && h('div', { class: 'sub' }, sub(name)))))
    : h('p', { class: 'nothing' }, empty));
  const since90 = addDays(t, -90);
  const repeats = repeatLocos(list, since90).slice(0, 5);
  const longest = longestDetentions(list.filter((u) => u.day >= since90), 5);
  const latest = L.unusualsByDay(list).slice(0, 2).flatMap(([, items]) => items).slice(0, 4);
  return h('div', null,
    h('section', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('div', null, h('div', { class: 'big' }, String(list.length)), h('small', null, 'unusual reports on record')),
        h('div', { class: 'when' }, h('b', null, String(list.filter((u) => u.day.startsWith(month)).length)), ' this month', h('br'), h('b', null, String(list.filter((u) => u.day >= week).length)), ' in the last 7 days')),
      h('div', { class: 'hero-actions' }, [...Object.entries(TYPES).map(([k, ty]) => h('button', { class: 'btn', onclick: () => openForm(k) }, `+ ${ty.name.replace(/s$/, '')}`)), h('button', { class: 'btn', onclick: bulkAttach }, 'Attach many files')])),
    h('div', { class: 'kpis' }, kpi('loco', 'Loco failures', count('loco')), kpi('cw', 'C&W failures', count('cw')), kpi('other', 'Others', count('other')), kpi('all', 'All reports', list.length)),
    h('section', { class: 'card-box' },
      h('h2', null, 'Last 14 days', h('span', { class: 'legend' }, h('span', null, h('i', { style: 'background:var(--k-fail)' }), 'Loco'), h('span', null, h('i', { style: 'background:var(--k-other)' }), 'C&W'), h('span', null, h('i', { style: 'background:var(--k-dpwcs)' }), 'Other'))),
      h('div', { class: 'chart' }, days.map((d) => {
        const n = d.loco + d.cw + d.other;
        return h('div', { class: `bar ${d.day === t ? 'today' : ''}`, title: `${L.fmtDay(d.day)}: ${n}` },
          h('div', { class: 'stack', style: `flex:${n ? n / peak : 0.02} 0 0` },
            ['loco', 'cw', 'other'].map((k) => d[k] > 0 && h('i', { class: k, style: `flex:${d[k]} 0 0` }))),
          h('div', { class: 'lab' }, d.day.slice(8)));
      }))),
    h('div', { class: 'cols' },
      h('section', { class: 'card-box' }, h('h2', null, 'Loco numbers to watch'),
        rank(repeats.map((r) => [r.loco, r.count, `${r.count} reports`]), 'No loco has more than one report in the last 90 days.', (n) => `latest ${L.fmtDay(repeats.find((r) => r.loco === n).last)}`)),
      h('section', { class: 'card-box' }, h('h2', null, 'Where it happens'),
        rank(topCounts(list.filter((u) => u.day >= since90), (u) => [String(u.location || '').trim().toUpperCase()]), 'Nothing in the last 90 days.')),
      h('section', { class: 'card-box' }, h('h2', null, 'Longest detentions (90 days)'),
        longest.length
          ? h('ul', { class: 'rank alert' }, longest.map((x) => h('li', null,
            h('div', { class: 'row' }, h('span', null, x.u.title || '(no heading)'), h('span', null, fmtMinutes(x.min))),
            h('div', { class: 'meter' }, h('i', { style: `width:${Math.round((x.min / longest[0].min) * 100)}%` })),
            h('div', { class: 'sub' }, `${L.fmtDay(x.u.day)}  |  ${x.u.location || ''}  |  ${x.u.trainNo || ''}`))))
          : h('p', { class: 'nothing' }, 'No detention times written in the last 90 days.'))),
    h('h2', { class: 'section-title' }, 'Latest reports'),
    h('div', { class: 'ucards' }, latest.map((u) => card(u, true))));
}

function viewList() {
  const type = ui.view;
  const pool = type === 'all' ? rows() : rows().filter((u) => kindOf(u) === type);
  const months = [...new Set(pool.map((u) => u.day.slice(0, 7)))].sort().reverse();
  if (ui.month !== 'all' && !months.includes(ui.month)) ui.month = 'all';

  const buildList = () => {
    const q = ui.search.trim().toLowerCase();
    // the quick chips, or the From and To dates typed in
    let since = ui.range === 'all' || ui.range === 'custom' ? '' : addDays(today(), -(Number(ui.range) - 1));
    let until = '';
    if (ui.range === 'custom') { since = ui.from || ''; until = ui.to || ''; }
    const visible = pool.filter((u) => (ui.month === 'all' || u.day.startsWith(ui.month)) && u.day >= since && (!until || u.day <= until) &&
      (!q || [u.title, u.location, u.trainNo, u.locoNo, u.reason, u.load, u.wagonNo, u.bpcNo, u.incident, L.fmtDay(u.day)].some((v) => (v || '').toLowerCase().includes(q))));
    if (!visible.length) return [h('p', { class: 'empty-big' }, pool.length ? 'No report matches.' : 'No reports yet. Press the button above to write the first one.')];
    const name = type === 'all' ? 'All' : TYPES[type].name.replace(/\W+/g, '-');
    const span = since || until ? `${since ? L.fmtDay(since) : 'the start'} to ${until ? L.fmtDay(until) : L.fmtDay(today())}` : '';
    const heading = `SCR UNUSALS ${TYPES[type] ? TYPES[type].name : 'all reports'}${span ? ` ${span}` : ''}`;
    return [
      h('p', { class: 'hint' }, `${visible.length} report${visible.length === 1 ? '' : 's'}${span ? `, ${span}` : ''}, day by day. Share them all as one sheet, oldest first.`),
      exportBar(unusualSheet(visible, 'Unusals'),
        `Unusals-${name}${ui.month === 'all' ? '' : `-${monthLabel(ui.month).replace(' ', '-')}`}${span ? `-${(since || 'start')}_to_${until || today()}` : ''}`,
        heading, () => `*${heading}*\n\n${L.unusualText(visible)}`),
      L.unusualsByDay(visible).map(([day, items]) => h('section', null,
        h('h2', { class: 'section-title' }, officialDay(day), h('span', { class: 'count' }, items.length)),
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
  newButtons.push(h('button', { class: 'btn', onclick: bulkAttach }, 'Attach many files'));
  return h('div', null,
    SHARED && status.unusualsMissing && h('p', { class: 'notice' },
      'Reports are being kept on this device only for now. To share them with everyone, run supabase/setup-unusuals.sql once in Supabase (steps are in the README). Nothing is lost meanwhile.'),
    h('div', { class: 'uhead' }, newButtons),
    h('div', { class: 'uhead' }, search, month),
    h('div', { class: 'chips-row' },
      [['all', 'All time'], ['30', 'Last 30 days'], ['7', 'Last 7 days'], ['1', 'Today']].map(([v, text]) => h('button', {
        class: `rchip ${ui.range === v ? 'on' : ''}`,
        onclick: () => { ui.range = v; ui.from = ''; ui.to = ''; render(); },
      }, text)),
      ...['from', 'to'].map((k) => h('label', { class: 'dfield' }, k === 'from' ? 'From' : 'To', h('input', {
        type: 'date', value: ui[k], 'aria-label': k === 'from' ? 'From date' : 'To date',
        onchange: (e) => {
          ui[k] = e.target.value;
          ui.range = ui.from || ui.to ? 'custom' : 'all';
          // swap them if they were typed the wrong way round
          if (ui.from && ui.to && ui.from > ui.to) { [ui.from, ui.to] = [ui.to, ui.from]; }
          render();
        },
      }))),
      (ui.from || ui.to) && h('button', { class: 'rchip', onclick: () => { ui.range = 'all'; ui.from = ''; ui.to = ''; render(); } }, 'Clear dates')),
    h('div', { id: 'ulist' }, buildList().flat()));
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
  const tabs = [['overview', 'Overview', null], ['loco', 'Loco failures', count('loco')], ['cw', 'C&W failures', count('cw')], ['other', 'Others', count('other')], ['all', 'All', rows().length]];
  const dots = { loco: 'var(--k-fail)', cw: 'var(--k-other)', other: 'var(--k-dpwcs)', all: 'var(--navy)', overview: 'var(--navy)' };
  repeatMap = new Map(repeatLocos(rows(), addDays(today(), -90)).map((r) => [r.loco, r.count]));
  document.getElementById('app').replaceChildren(
    h('header', { class: `top ${!isInstalled() && !bannerClosed() ? 'has-banner' : ''}` },
      !isInstalled() && !bannerClosed() && h('div', { class: 'install-banner' },
        h('button', { class: 'install-go', onclick: installApp },
          h('strong', null, 'Tap here to install SCR UNUSALS'),
          h('span', null, 'Opens from your home screen or Start menu like any other app')),
        h('button', { class: 'install-close', 'aria-label': 'Hide the install message', onclick: () => { try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* private mode */ } render(); } }, '\u00d7')),
      h('div', { class: 'top-inner' },
      h('div', { class: 'top-row' },
        h('div', { class: 'brand' },
          h('img', { class: 'brand-l', src: 'icons/tigoods.png', alt: 'TI GOODS', width: 64, height: 64 }),
          h('div', { class: 'brand-mid' }, h('h1', null, 'SCR UNUSALS'), h('span', { class: 'brand-sub' }, 'SOUTH CENTRAL RAILWAY')),
          h('img', { class: 'brand-r', src: '../icons/logo.png', alt: 'Indian Railways', width: 64, height: 64 })),
        !isInstalled() && h('button', { class: 'install', onclick: installApp }, 'Install app')),
      h('p', { class: 'clock', id: 'clock' }, officialNow()),
      h('p', { class: 'count-line' }, `${rows().length} unusual reports on record`),
      h('p', { class: 'top-meta' }, h('button', {
        class: `sync ${status.phase}`, id: 'sync-status', title: SHARED ? 'Tap to sync now' : '',
        onclick: () => { if (sync) sync.syncNow(); },
      }, statusText())))),
    h('nav', { class: 'tabs' }, tabs.map(([id, text, n]) => h('button', {
      class: ui.view === id ? 'on' : '',
      onclick: () => { ui.view = id; ui.month = 'all'; ui.search = ''; ui.range = 'all'; ui.from = ''; ui.to = ''; render(); window.scrollTo(0, 0); },
    }, h('i', { class: 'dot-k', style: `--c:${dots[id]}` }), text, n != null && h('span', { class: 'n' }, String(n))))),
    h('main', null, ui.view === 'overview' ? viewOverview() : viewList()));
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
  setInterval(() => { const el = document.getElementById('clock'); if (el) el.textContent = officialNow(); }, 15000);
  if (sync) sync.start(); else seed();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
