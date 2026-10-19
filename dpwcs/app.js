import { eventsEditor } from '../js/events.js';
import * as L from '../js/logic.js';
import { loadState, saveState } from '../js/db.js';
import { seedState } from '../js/seed.js';
import { STYLES, reportSheet, historySheet, workKind, unusualSheet } from '../js/sheet.js';
import { sheetToXlsx } from '../js/xlsx.js';
import { sheetToCanvas, canvasToBlob } from '../js/canvas.js';
import { createSync } from '../js/sync.js';
import { diffOps } from '../js/syncdata.js';
import { importHistory, alreadyImported } from '../js/historyimport.js';
import { SUPABASE_URL, SUPABASE_KEY, REQUIRE_LOGIN } from '../js/config.js';
import { readReports, tidyBatch, reportKey } from '../js/reports.js';
import { dailySummary } from '../js/summary.js';
import { planPaste } from '../js/paste.js';
import { fileToText, FileError } from '../js/filetext.js';
import { importDpwcs, dpwcsSeeded } from '../js/unusualimport.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const today = () => L.dayKey(new Date());

// With a database configured the data is shared and everyone signs in.
// Without one the app keeps its data on this device only.
const SHARED = !!(SUPABASE_URL && SUPABASE_KEY);
const NO_SYNC = { outbox: [], cursor: {}, linked: false };
let sync = null;
let status = { phase: SHARED ? 'syncing' : 'local', pending: 0, email: '', error: '' };

let state = L.emptyState();
const ui = {
  view: 'locos',
  search: '',
  reportDay: today(),
  reportId: null, // a saved report being viewed, or null for the live one
  histLoco: null,
  histFrom: L.addDays(today(), -6),
  histTo: today(),
  histChangesOnly: false,
  histMode: 'date', // 'date': all locos on one day; 'loco': one loco over many days
  histDay: today(),
  uDraft: null, // the loco failure being written; kept here so a redraw does not lose it
  span: {}, // From and To of the saved reports
  drafts: {}, // the report being typed, kept so a redraw does not lose it
  edit: null, // the saved report being changed in its row
  histSpan: { from: '', to: '' }, // From and To of the History tab
  histCopy: null, // a report sent earlier, opened as it was sent
  sumDay: '',
};

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
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const who = () => (sync && sync.email ? sync.email.split('@')[0] : '');

function persist() {
  saveState(state).then((ok) => { if (!ok) toast('Could not save on this device'); });
}

/** Make next the current state, save it, and queue what changed for upload. */
function commit(next) {
  if (next === state) return;
  if (sync) {
    // Queue the change for the shared database; it uploads straight away
    // when online and waits safely on this device when not.
    const ops = diffOps(state, next, who());
    state = { ...next, sync: { ...next.sync, outbox: [...next.sync.outbox, ...ops] } };
    sync.kick();
  } else {
    state = next;
  }
  persist();
}

function dispatch(action) {
  commit(L.reduce(state, { ...action, by: who() }));
  render();
}

// The older records (position sheet and shed statements) are loaded once.
// With a shared database this waits until this device is fully in step with
// it, so the history attaches to the locos everyone already has.
let importing = false;
async function importOldRecords() {
  if (importing || alreadyImported(state)) return;
  if (sync && !(state.sync.linked && status.phase === 'synced')) return;
  importing = true;
  try {
    const { SNAPSHOTS } = await import('../js/history-data.js');
    if (!alreadyImported(state) && (!sync || status.phase === 'synced')) {
      commit(importHistory(state, SNAPSHOTS));
      render();
    }
  } catch (e) {
    console.error(e); // offline or blocked: tried again on the next sync
  } finally {
    importing = false;
  }
}

// The daily message for a day, and WhatsApp with it ready to send to a group.
const daySummaryText = (day) => dailySummary(mine(), day, { title: 'DPWCS LOCO FAILURES', kindOf: () => 'loco', groups: [['loco', 'LOCO FAILURES']] });
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

// The DPWCS loco failures have their own list: only reports tagged 'dpwcs' are shown
// here, and the SCR UNUSALS app leaves them out of its own.
const mine = () => state.unusuals.filter((u) => u.app === 'dpwcs');

// The first DPWCS loco failures (from the monthly statement) are loaded once, as copies of
// their own. With a shared database this waits until this device is in step with it.
function importOldUnusuals() {
  if (state.dpwcsSeeded || dpwcsSeeded(state)) {
    if (!state.dpwcsSeeded) state = { ...state, dpwcsSeeded: true };
    return;
  }
  if (sync && !(state.sync.linked && status.phase === 'synced')) return;
  commit(importDpwcs({ ...state, dpwcsSeeded: true }, UNUSUAL_RECORDS));
  render();
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** On a phone, open the share sheet (WhatsApp etc.). Elsewhere, download. */
async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  download(blob, filename);
  toast(`Saved ${filename}`);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied. Paste it in WhatsApp or a message.');
}

function sheetTable(sheet) {
  const cell = (c) => {
    const st = STYLES[c.s] || STYLES.cell;
    return h('td', {
      colSpan: c.colSpan || 1, rowSpan: c.rowSpan || 1, class: `s-${c.s}`,
      style: `background:${st.bg || 'transparent'};color:${st.color};text-align:${st.align};${st.noBorder ? 'border:0;height:14px' : ''}`,
    }, c.v);
  };
  const width = sheet.cols.reduce((n, w) => n + w * 9 + 12, 0);
  return h('table', { class: 'sheet', style: `width:${width}px` },
    h('colgroup', null, sheet.cols.map((w) => h('col', { style: `width:${w * 9 + 12}px` }))),
    h('tbody', null, sheet.rows.map((row) => h('tr', null, row.filter(Boolean).map(cell)))));
}

function exportBar(sheet, fileBase, title, getText, before) {
  const run = (fn) => async () => {
    try {
      if (before) before();
      await fn();
    } catch (e) {
      console.error(e);
      toast('Something went wrong. Please try again.');
    }
  };
  return h('div', { class: 'actions' },
    h('button', { class: 'btn primary', onclick: run(async () => {
      const blob = await canvasToBlob(sheetToCanvas(sheet));
      await shareOrDownload(blob, `${fileBase}.png`, title);
    }) }, 'Share image'),
    h('button', { class: 'btn', onclick: run(async () => {
      const blob = new Blob([sheetToXlsx(sheet)], { type: XLSX_TYPE });
      await shareOrDownload(blob, `${fileBase}.xlsx`, title);
    }) }, 'Excel file'),
    h('button', { class: 'btn', onclick: run(() => copyText(getText())) }, 'Copy as text'),
    h('button', { class: 'btn', onclick: run(() => window.print()) }, 'Print / PDF'));
}

// ---------- Locos ----------

// ---------- paste from Excel, and suggestions for the Working cell ----------

// Pasting cells copied from Excel. A block with a heading row, or rows that carry the
// loco number (as in the report sheet), is matched to the locos by name or number, wherever
// it is pasted; plain columns land from the box that was clicked, a row per loco.
const isBlock = (raw) => /[\t\n]/.test(String(raw).replace(/\r/g, '').replace(/\n+$/, ''));

function applyPaste(raw, start) {
  const order = [...document.querySelectorAll('#lists .card')].map((c) => c.querySelector('.cell-input').dataset.id);
  const plan = planPaste({ locos: state.locos, order, start, text: raw });
  if (!plan || plan.mode === 'none' || !plan.cells) {
    toast(plan && plan.unmatched
      ? `None of the ${plan.unmatched} rows matched a loco number.`
      : 'Nothing to paste here. Click a Train No, Location or Working box first, or copy the Loco No column along with the rest.');
    return;
  }
  const now = new Date().toISOString();
  let next = state;
  for (const [id, fields] of plan.edits) {
    const current = next.locos.find((l) => l.id === id);
    if (current) next = L.reduce(next, { type: 'save', loco: { ...current, ...fields }, now, by: who() });
  }
  hideSuggest();
  commit(next);
  render();
  const n = plan.edits.size;
  const how = plan.mode === 'position' ? '' : ' (matched by loco number)';
  toast(`Pasted ${plan.cells} cell${plan.cells === 1 ? '' : 's'} into ${n} loco${n === 1 ? '' : 's'}${how}.${plan.unmatched ? ` ${plan.unmatched} row${plan.unmatched === 1 ? '' : 's'} did not match a loco.` : ''}${plan.outside ? ` ${plan.outside} row${plan.outside === 1 ? '' : 's'} went past the end of the list and were left out.` : ''}`);
}

function pasteCells(e, loco, key) {
  const raw = (e.clipboardData || window.clipboardData).getData('text');
  if (!isBlock(raw)) return; // a single cell: paste as usual
  e.preventDefault();
  applyPaste(raw, { id: loco.id, field: key });
}

// A block pasted anywhere on the Locos page, outside a box, is matched by loco number.
document.addEventListener('paste', (e) => {
  if (ui.view !== 'locos') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const raw = (e.clipboardData || window.clipboardData).getData('text');
  const g = rangeOf();
  // one value over several selected cells fills them all, as in a spreadsheet
  if (multi(g) && !isBlock(raw)) { e.preventDefault(); fillRange(g, raw.trim()); return; }
  if (!isBlock(raw)) return;
  e.preventDefault();
  applyPaste(raw, g ? { id: idOfRow(g.r0), field: SEL_COLS[Math.max(g.c0, 1)] } : null);
});

// ---------- cells like a spreadsheet: select a range, copy it, paste or clear over it ----------

const SEL_COLS = ['locoNo', 'trainNo', 'location', 'working'];
let sel = null; // { a: { r, c }, b: { r, c } }: the corners of the selected cells, by row and column
let dragging = false;
const cardEls = () => [...document.querySelectorAll('#lists .card')];
const idOfRow = (r) => { const c = cardEls()[r]; const i = c && c.querySelector('.cell-input'); return i ? i.dataset.id : null; };
function locate(el) {
  const card = el.closest && el.closest('.card');
  if (!card) return null;
  const r = cardEls().indexOf(card);
  const f = el.dataset && el.dataset.field;
  const c = f ? SEL_COLS.indexOf(f) : (el.classList.contains('loco-btn') ? 0 : -1);
  return r >= 0 && c >= 0 ? { r, c } : null;
}
function rangeOf() {
  if (!sel) return null;
  return { r0: Math.min(sel.a.r, sel.b.r), r1: Math.max(sel.a.r, sel.b.r), c0: Math.min(sel.a.c, sel.b.c), c1: Math.max(sel.a.c, sel.b.c) };
}
const multi = (g) => !!g && (g.r0 !== g.r1 || g.c0 !== g.c1);

function paintSel() {
  document.querySelectorAll('.cell-sel').forEach((e) => e.classList.remove('cell-sel'));
  const g = rangeOf();
  document.body.classList.toggle('selecting', multi(g));
  if (!multi(g)) return;
  const cards = cardEls();
  for (let r = g.r0; r <= g.r1; r++) {
    for (let c = g.c0; c <= g.c1; c++) {
      const card = cards[r];
      const el = card && (c === 0 ? card.querySelector('.loco-btn') : card.querySelector(`.cell-input[data-field="${SEL_COLS[c]}"]`));
      if (el) el.classList.add('cell-sel');
    }
  }
}

/** The text of one cell: what the loco holds, even while the box shows the previous value in grey. */
function cellText(r, c) {
  const loco = state.locos.find((l) => l.id === idOfRow(r));
  return loco ? String(loco[SEL_COLS[c]] || '') : '';
}

function commitEdits(edits, message) {
  const now = new Date().toISOString();
  let next = state;
  for (const [id, fields] of edits) {
    const current = next.locos.find((l) => l.id === id);
    if (current) next = L.reduce(next, { type: 'save', loco: { ...current, ...fields }, now, by: who() });
  }
  hideSuggest();
  commit(next);
  render();
  toast(message);
}

/** The same value in every selected box (pasting one value over a range), or nothing to clear them. */
function fillRange(g, value) {
  const edits = new Map();
  let n = 0;
  for (let r = g.r0; r <= g.r1; r++) {
    const id = idOfRow(r);
    for (let c = Math.max(g.c0, 1); c <= g.c1; c++) {
      if (!id) continue;
      if (!edits.has(id)) edits.set(id, {});
      edits.get(id)[SEL_COLS[c]] = value;
      n++;
    }
  }
  if (!n) { toast('Select Train no, Location or Working cells first.'); return; }
  commitEdits(edits, value ? `Filled ${n} cell${n === 1 ? '' : 's'}` : `Cleared ${n} cell${n === 1 ? '' : 's'}`);
}

document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains('cell-input')) {
    const loc = locate(t);
    if (e.shiftKey && sel && loc) { // Shift + click extends the selection, as in a spreadsheet
      e.preventDefault();
      sel.b = loc;
      if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('cell-input')) document.activeElement.blur();
      paintSel();
      return;
    }
    sel = loc ? { a: loc, b: loc } : null;
    dragging = !!loc;
    paintSel();
  } else if (!(t.closest && (t.closest('.suggest') || t.closest('dialog')))) {
    if (sel) { sel = null; paintSel(); }
  }
});
document.addEventListener('mouseover', (e) => {
  if (!dragging || !sel) return;
  const t = e.target;
  if (!(t.classList && (t.classList.contains('cell-input') || t.classList.contains('loco-btn')))) return;
  const loc = locate(t);
  if (!loc || (sel.b.r === loc.r && sel.b.c === loc.c)) return;
  sel.b = loc;
  paintSel();
  if (multi(rangeOf())) {
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('cell-input')) document.activeElement.blur();
    window.getSelection().removeAllRanges();
  }
});
document.addEventListener('mouseup', () => { dragging = false; });

document.addEventListener('copy', (e) => {
  if (ui.view !== 'locos') return;
  const g = rangeOf();
  if (multi(g)) {
    const lines = [];
    for (let r = g.r0; r <= g.r1; r++) {
      const cols = [];
      for (let c = g.c0; c <= g.c1; c++) cols.push(cellText(r, c));
      lines.push(cols.join('\t'));
    }
    e.clipboardData.setData('text/plain', lines.join('\n'));
    e.preventDefault();
    toast(`Copied ${(g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1)} cells`);
    return;
  }
  // one box, with no text picked inside it: copy the whole cell, like a spreadsheet
  const f = document.activeElement;
  if (f && f.classList && f.classList.contains('cell-input') && f.selectionStart === f.selectionEnd) {
    const loco = state.locos.find((l) => l.id === f.dataset.id);
    const text = loco ? String(loco[f.dataset.field] || '') : '';
    if (text) { e.clipboardData.setData('text/plain', text); e.preventDefault(); }
  }
});

document.addEventListener('keydown', (e) => {
  if (ui.view !== 'locos' || !sel) return;
  const typing = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('cell-input');
  if (e.key === 'Escape') { sel = null; paintSel(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && multi(rangeOf()) && !typing) { e.preventDefault(); fillRange(rangeOf(), ''); }
});

const WORKING_OPTIONS = ['YES', 'YES/MU', 'Shed in', 'DEFICTIVE', 'P/I -PLANING'];
let suggestBox = null;

function hideSuggest() {
  if (suggestBox) { suggestBox.remove(); suggestBox = null; }
}

/** A small list under the Working box: the usual entries and any already used. */
function showSuggest(input) {
  hideSuggest();
  const typed = input.value.trim().toLowerCase();
  const all = [...new Set([...WORKING_OPTIONS, ...state.locos.map((l) => (l.working || '').trim()).filter(Boolean)])];
  const list = all.filter((o) => o.toLowerCase().includes(typed) && o.toLowerCase() !== typed);
  if (!list.length) return;
  const r = input.getBoundingClientRect();
  if (!input.isConnected || !r.width) return;
  suggestBox = h('div', { class: 'suggest', style: `left:${r.left}px;top:${r.bottom + 2}px;min-width:${r.width}px` },
    list.map((o) => h('button', {
      type: 'button',
      // mousedown, not click: the box must not lose focus before the choice is made
      onmousedown: (ev) => {
        ev.preventDefault();
        input.value = o;
        hideSuggest();
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
    }, o)));
  document.body.append(suggestBox);
}
window.addEventListener('scroll', hideSuggest, true);

function locoCard(row, since) {
  const l = row.loco;
  // Updated since the last report (or confirmed unchanged): green. Not yet: the cells show the
  // previous values in grey, and a Previous button keeps them without typing anything.
  const ok = L.isUpdated(l, since);
  // On a wide screen, train number, location and working can be changed right in the
  // table. A phone hides these boxes and opens the full form from the loco number.
  const cell = (key, label) => h('input', {
    type: 'text', class: `col cell-input${ok ? '' : ' prev'}${key === 'working' && ok && workKind(l.working) ? ` w-${workKind(l.working)}` : ''}`,
    value: ok ? l[key] : '', placeholder: ok ? '-' : (l[key] || '-'),
    'aria-label': `${label} of ${l.locoNo}`, 'data-id': l.id, 'data-field': key,
    autocapitalize: 'characters', autocomplete: 'off',
    onpaste: (e) => pasteCells(e, l, key),
    onfocus: key === 'working' ? (e) => showSuggest(e.target) : null,
    oninput: key === 'working' ? (e) => showSuggest(e.target) : null,
    onblur: key === 'working' ? hideSuggest : null,
    onkeydown: (e) => {
      if (e.key === 'Escape') { hideSuggest(); e.target.value = ok ? l[key] : ''; e.target.blur(); return; }
      // like a spreadsheet: Enter and the arrow keys move up and down the column
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        const cards = [...document.querySelectorAll('#lists .card')];
        const at = cards.indexOf(e.target.closest('.card'));
        const next = cards[at + (e.key === 'ArrowUp' ? -1 : 1)];
        const box = next && next.querySelector(`.cell-input[data-field="${key}"]`);
        if (box) box.focus(); else e.target.blur();
      }
    },
    onchange: (e) => {
      // A box removed by a redraw reports a change too; that is not the
      // person finishing their edit, so it must not be saved.
      if (redrawing || !e.target.isConnected) return;
      const value = e.target.value.trim();
      if (!ok && !value) return; // nothing typed: this loco is still waiting for its update
      // typing what was there before is a confirmation of it
      if (value === l[key]) {
        if (ok) return;
        setTimeout(() => { dispatch({ type: 'check', id: l.id, now: new Date().toISOString() }); toast(`${l.locoNo}: kept as before`); }, 0);
        return;
      }
      // Wait a moment so that, when moving to the next box with Tab, the
      // cursor is already there and stays there after the list redraws.
      setTimeout(() => {
        const current = state.locos.find((x) => x.id === l.id);
        if (!current) return;
        dispatch({ type: 'save', loco: { ...current, [key]: value }, now: new Date().toISOString() });
        toast(`${l.locoNo}: ${label.toLowerCase()} saved`);
      }, 0);
    },
  });
  const status = ok
    ? h('span', { class: 'dot ok', title: 'Updated', 'aria-label': `${l.locoNo} is updated` }, '✓')
    : h('button', {
      class: 'prev-btn', title: 'Keep the previous train no, location and working',
      'aria-label': `Keep the previous details of ${l.locoNo}`,
      onclick: () => {
        dispatch({ type: 'check', id: l.id, now: new Date().toISOString() });
        toast(`${l.locoNo}: previous details kept`);
      },
    }, 'Previous');
  // Only the loco number opens the Update form, never a click elsewhere on the row.
  return h('div', { class: 'card' },
    h('span', { class: 'serial' }, row.span === 0 ? '' : String(row.serial)),
    h('button', { class: 'loco-no loco-btn', title: 'Click to update this loco', onclick: () => openEditor(l) }, l.locoNo || '(no number)'),
    cell('trainNo', 'Train no'),
    cell('location', 'Current location'),
    cell('working', 'Working'),
    status);
}

function viewLocos() {
  const buildLists = () => {
    const since = L.roundStart(state.reports);
    const sentToday = state.reports.some((r) => r.at === since);
    const q = ui.search.trim().toLowerCase();
    const rows = L.numbered(state.locos).filter((r) => !q ||
      [r.loco.locoNo, r.loco.trainNo, r.loco.location, r.loco.working, r.loco.hoPoint, r.loco.remarks]
        .some((v) => v.toLowerCase().includes(q)));
    const section = (division, title) => {
      const list = rows.filter((r) => r.loco.division === division);
      return h('section', null,
        h('h2', { class: `section-title ${division.toLowerCase()}` }, title, h('span', { class: 'count' }, list.length)),
        list.length > 0 && h('div', { class: 'list-head', 'aria-hidden': 'true' },
          h('span', null, 'Sr. No'), h('span', null, 'Loco No'), h('span', null, 'Train No'), h('span', null, 'Current location'), h('span', null, 'Working'), h('span', null, 'Updated')),
        list.length ? list.map((r) => locoCard(r, since)) : h('p', { class: 'empty' }, q ? 'No match.' : 'No locos here.'),
        division === 'OTHER' && h('div', { class: 'add-row' }, h('button', { class: 'btn primary', onclick: () => openEditor(null, 'OTHER') }, '+ Add loco')));
    };
    const done = state.locos.filter((l) => L.isUpdated(l, since)).length;
    const total = state.locos.length;
    const progress = h('p', { class: `progress ${done === total ? 'all' : ''}` },
      h('span', { class: 'dot ok', 'aria-hidden': 'true' }, '\u2713'), `${done} updated`,
      h('span', { class: 'dot due', 'aria-hidden': 'true' }, '!'), `${total - done} to update`,
      h('span', { class: 'since' }, sentToday ? `since the report sent at ${L.fmtTime(since)}` : 'today'));
    return [progress, section('OTHER', 'In other divisions'), section('SC', 'In SC division')];
  };
  // Typing in the search box only redraws the lists, so the keyboard stays open.
  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Search loco, train or location',
    value: ui.search,
    oninput: (e) => {
      ui.search = e.target.value;
      sel = null;
      document.getElementById('lists').replaceChildren(...buildLists());
    },
  });
  const chooser = h('input', {
    type: 'file', multiple: true, accept: 'image/*,.docx,.pdf,.xlsx,.csv,.txt,application/pdf', style: 'display:none',
    onchange: (e) => { const list = [...e.target.files]; e.target.value = ''; readLocoFiles(list); },
  });
  const attach = h('div', { class: 'opaste attach-locos' },
    h('button', { type: 'button', class: 'drop', onclick: () => chooser.click() },
      h('b', null, 'Attach a photo, Word, PDF or Excel file'),
      h('span', null, 'tap here, or drop the files on this box (several at a time). The locos in them are matched by loco number and updated after you check them.')),
    chooser);
  attach.addEventListener('dragover', (e) => { e.preventDefault(); attach.classList.add('over'); });
  attach.addEventListener('dragleave', () => attach.classList.remove('over'));
  attach.addEventListener('drop', (e) => { e.preventDefault(); attach.classList.remove('over'); readLocoFiles(e.dataTransfer.files); });
  return h('div', null,
    h('div', { class: 'toolbar' }, search),
    attach,
    h('p', { class: 'hint wide-only' }, 'Type in the Train No, Current location or Working box to change it, or paste a block copied from Excel. Click a loco number for all its details.'),
    h('p', { class: 'hint narrow-only' }, 'Tap a loco number to see and update its details.'),
    h('div', { id: 'lists' }, buildLists()));
}

// A box to paste the whole report sheet (or any cells copied from Excel) into: it shows which
// locos will get which Train No and Location before anything is changed.
function openPasteBox(initial = '', problems = []) {
  const dlg = document.getElementById('editor');
  const preview = h('div', { class: 'paste-preview' }, 'Nothing pasted yet.');
  const apply = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Apply');
  const area = h('textarea', {
    rows: 8, class: 'paste-area', placeholder: 'Paste the cells copied from Excel here (Ctrl+V)',
    oninput: () => {
      const order = state.locos.map((l) => l.id);
      const plan = planPaste({ locos: state.locos, order, start: null, text: area.value });
      if (!plan || !plan.cells) {
        preview.replaceChildren(plan && plan.unmatched ? `None of the ${plan.unmatched} rows matched a loco number.` : 'No loco numbers found. Copy the rows together with the Loco No column.');
        apply.disabled = true;
        return;
      }
      const name = { trainNo: 'Train', location: 'Location', working: 'Working', hoTrain: 'H/O train', hoPoint: 'H/O point', hoTime: 'H/O time', remarks: 'Remarks', dueDate: 'Due' };
      preview.replaceChildren(
        h('p', null, `${plan.edits.size} locos found${plan.unmatched ? `, ${plan.unmatched} rows not matched` : ''}.`),
        h('ul', null, [...plan.edits].map(([id, f]) => {
          const l = state.locos.find((x) => x.id === id);
          return h('li', null, h('b', null, l.locoNo), ' \u2192 ', ['trainNo', 'location', 'working'].filter((k) => k in f).map((k) => `${name[k]}: ${f[k] || '-'}`).join(' | '));
        })));
      apply.disabled = false;
    },
  });
  apply.onclick = () => { dlg.close(); applyPaste(area.value, null); };
  dlg.replaceChildren(h('form', { method: 'dialog', class: 'editor', onsubmit: (e) => e.preventDefault() },
    h('h2', null, initial ? 'Check what was read' : 'Paste from Excel'),
    h('p', { class: 'hint' }, initial
      ? 'This is what was read from the attached file(s). Each loco gets its Train No, Location and Working by its loco number. Check the list below, then press Apply.'
      : 'Copy the table from Excel (with the headings or the Loco No column) and paste it here. Each loco gets its Train No, Location and Working by its loco number.'),
    problems.length > 0 && h('p', { class: 'form-error' }, `Could not read: ${problems.join('; ')}`),
    area, preview,
    h('div', { class: 'editor-actions' }, apply, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'))));
  dlg.showModal();
  if (initial) { area.value = initial; area.dispatchEvent(new Event('input')); } else area.focus();
}

/** Attached photos, Word, PDF or Excel files: read, then shown for checking like a paste. */
async function readLocoFiles(list) {
  const files = [...list];
  if (!files.length) return;
  toast(files.length > 1 ? `Reading ${files.length} files...` : `Reading ${files[0].name}...`);
  const parts = [];
  const bad = [];
  for (const file of files) {
    try {
      const text = await fileToText(file, (pct) => toast(`Reading the photo ${file.name}: ${pct}%`));
      if (text && text.trim()) parts.push(text); else bad.push(`${file.name} (nothing found in it)`);
    } catch (e) {
      console.error(e);
      bad.push(`${file.name} (${e instanceof FileError ? e.message : 'could not be read'})`);
    }
  }
  if (!parts.length) { toast(bad.length ? `Nothing could be read. ${bad.join('; ')}` : 'Nothing found in those files.'); return; }
  openPasteBox(parts.join('\n'), bad);
}

function openEditor(loco, division) {
  const isNew = !loco;
  const draft = loco ? { ...loco } : L.blankLoco(division || 'SC');
  const dlg = document.getElementById('editor');

  const field = (label, key, opts = {}) => h('label', { class: `field ${opts.wide ? 'wide' : ''}` },
    h('span', null, label),
    opts.area
      ? h('textarea', { rows: 3, value: draft[key], oninput: (e) => { draft[key] = e.target.value; } })
      : h('input', {
        type: 'text', value: draft[key], placeholder: opts.placeholder || '',
        autocapitalize: 'characters', autocomplete: 'off',
        oninput: (e) => { draft[key] = e.target.value; },
      }),
    opts.extra);

  // Opens with the three things updated most often. Everything else is one
  // press away.
  let showAll = isNew;

  const build = () => {
    const other = draft.division === 'OTHER';
    const seg = (value, text) => h('button', {
      type: 'button', class: `seg ${draft.division === value ? 'on' : ''}`,
      onclick: () => {
        // Handing a loco over needs its H/O details, so those open up.
        if (value === 'OTHER' && draft.division !== 'OTHER') showAll = true;
        draft.division = value;
        build();
      },
    }, text);
    const canShare = !isNew || state.locos.some((l) => l.division === draft.division);
    dlg.replaceChildren(h('form', {
      method: 'dialog', class: 'editor',
      onsubmit: (e) => {
        e.preventDefault();
        if (!draft.locoNo.trim()) { toast('Enter the loco number'); return; }
        dlg.close();
        const now = new Date().toISOString();
        if (!isNew && L.sameFields(loco, draft)) {
          // Saving without changing anything confirms the loco is as shown.
          dispatch({ type: 'check', id: loco.id, now });
          toast('Confirmed, no change');
          return;
        }
        dispatch({ type: 'save', loco: draft, now });
        toast(isNew ? 'Loco added' : 'Saved');
      },
    },
    h('h2', null, isNew ? 'Add loco' : `Update ${loco.locoNo}`),
    h('div', { class: 'segs' }, seg('SC', 'SC division'), seg('OTHER', 'Other division')),
    h('div', { class: 'grid' },
      field('Loco no', 'locoNo', { placeholder: '27609+28411', wide: !showAll }),
      field('Train no', 'trainNo'),
      field('Current location', 'location'),
      field('Working', 'working', { placeholder: 'YES, Shed in, ...' }),
      showAll && field('Due date', 'dueDate', { placeholder: '15-Oct or FRESH' }),
      showAll && other && field('H/O train to other div', 'hoTrain'),
      showAll && other && field('H/O point', 'hoPoint'),
      showAll && other && field('H/O time', 'hoTime', {
        placeholder: 'DD-MM-YY HH:MM',
        extra: h('button', { type: 'button', class: 'link', onclick: () => { draft.hoTime = L.fmtDateTime(new Date()); build(); } }, 'Use current time'),
      }),
      // Picking the FOIS message date writes the standard remark with that
      // date. The remark can still be edited by hand afterwards.
      showAll && other && h('label', { class: 'field' },
        h('span', null, 'FOIS message date'),
        h('input', {
          type: 'date',
          value: draft.foisDate || L.foisDateFromRemarks(draft.remarks),
          onchange: (e) => {
            draft.foisDate = e.target.value;
            if (draft.foisDate) draft.remarks = L.foisRemark(draft.foisDate);
            build();
          },
        }),
        h('button', {
          type: 'button', class: 'link',
          onclick: () => { draft.foisDate = today(); draft.remarks = L.foisRemark(draft.foisDate); build(); },
        }, 'Use today')),
      showAll && field('Remarks', 'remarks', { area: true, wide: true })),
    showAll && canShare && h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !!draft.sameSerial, onchange: (e) => { draft.sameSerial = e.target.checked; } }),
      'Same S.No as the loco above (split consist)'),
    h('div', { class: 'editor-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, 'Save'),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel')),
    !isNew && h('button', {
      type: 'button', class: 'link toggle', 'aria-expanded': String(showAll),
      onclick: () => { showAll = !showAll; build(); },
    }, showAll ? 'Hide other details' : 'Show all details'),
    showAll && !isNew && h('div', { class: 'editor-more' },
      h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); dispatch({ type: 'move', id: loco.id, dir: -1 }); } }, 'Move up'),
      h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); dispatch({ type: 'move', id: loco.id, dir: 1 }); } }, 'Move down'),
      h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); ui.view = 'history'; ui.histMode = 'loco'; ui.histLoco = loco.id; render(); } }, 'History'),
      h('button', {
        type: 'button', class: 'link danger',
        onclick: () => {
          if (!confirm(`Remove ${loco.locoNo} from the list? Its history is kept.`)) return;
          dlg.close();
          dispatch({ type: 'remove', id: loco.id, now: new Date().toISOString() });
        },
      }, 'Remove'))));
  };
  build();
  dlg.showModal();
}

// ---------- Report ----------

/** Counts above the position report: how the fleet stands at a glance. */
function viewReport() {
  const day = ui.reportDay;
  const isToday = day === today();
  const locos = isToday ? state.locos : L.locosOnDay(state, day);
  const sheet = reportSheet(locos, day);
  const fileBase = `DPWS-locos-${L.fmtDay(day)}`;

  // Sharing today's live report also files a copy of exactly what was sent. The copies are not
  // listed here: they are in History, under the day they were sent.
  const keepCopy = () => {
    if (!isToday) return;
    const lastOne = state.reports[state.reports.length - 1];
    const same = lastOne && lastOne.day === day && lastOne.locos.length === locos.length &&
      lastOne.locos.every((l, i) => l.id === locos[i].id && L.sameFields(l, locos[i]));
    if (same) return;
    const report = { id: L.uid(), at: new Date().toISOString(), day, by: who(), locos: locos.map((l) => ({ ...l })) };
    setTimeout(() => dispatch({ type: 'addReport', report }), 0);
  };

  let note;
  if (isToday) note = 'Current position of all locos. Update locos first, then share. A copy of what you share is kept in History.';
  else if (day > today()) note = 'This date is in the future, showing the current position.';
  else note = `Position as it stood at the end of ${L.fmtDay(day)}, rebuilt from the saved updates.`;

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('label', { class: 'inline' }, 'Date',
        h('input', {
          type: 'date', value: day,
          onchange: (e) => { ui.reportDay = e.target.value || today(); render(); },
        })),
      !isToday && h('button', { class: 'btn', onclick: () => { ui.reportDay = today(); render(); } }, 'Back to today')),
    h('p', { class: 'hint' }, note),
    exportBar(sheet, fileBase, sheet.rows[0][0].v, () => L.reportText(locos, day), keepCopy),
    h('div', { class: 'sheet-wrap', id: 'printable' }, sheetTable(sheet)));
}

// ---------- History ----------

/** Days that have any record, newest first. */
function recordDays() {
  const days = new Set(state.log.map((e) => L.dayKey(e.at)));
  for (const r of state.reports) days.add(r.day);
  return [...days].filter((d) => d <= today()).sort().reverse();
}

function viewHistory() {
  const tab = (mode, text) => h('button', {
    type: 'button', class: `seg ${ui.histMode === mode ? 'on' : ''}`,
    onclick: () => { ui.histMode = mode; render(); },
  }, text);
  return h('div', null,
    h('div', { class: 'segs' }, tab('date', 'Day-wise, all locos'), tab('loco', 'One loco')),
    ui.histMode === 'date' ? viewHistoryDay() : viewHistoryLoco(),
    backupPanel());
}

/** The sheets of several days one under the other, as one sheet to share. */
function stackSheets(sheets, name) {
  const width = sheets[0].cols.length;
  const rows = [];
  sheets.forEach((s, i) => {
    if (i) rows.push([{ v: '', s: 'gap', colSpan: width }, ...Array(width - 1).fill(null)]);
    rows.push(...s.rows);
  });
  return { name, cols: sheets[0].cols, rows };
}

/** One report as it was sent: the sheet, the ways to share it again, and a way to remove the copy. */
function viewSentCopy(copy) {
  const sheet = reportSheet(copy.locos, copy.day);
  const when = `${L.fmtDay(copy.day)} ${L.fmtTime(copy.at)}${copy.by ? ` ${copy.by}` : ''}`;
  return h('div', null,
    h('div', { class: 'toolbar wrap' },
      h('button', { class: 'btn', onclick: () => { ui.histCopy = null; render(); } }, '\u2190 Back'),
      h('button', {
        class: 'btn small danger',
        onclick: () => {
          if (!confirm('Delete this saved copy?')) return;
          ui.histCopy = null;
          dispatch({ type: 'removeReport', id: copy.id });
        },
      }, 'Delete this copy')),
    h('p', { class: 'hint' }, `The report as it was sent on ${when}.`),
    exportBar(sheet, `DPWS-locos-${L.fmtDay(copy.day)}-${L.fmtTime(copy.at).replace(':', '')}`, sheet.rows[0][0].v, () => L.reportText(copy.locos, copy.day)),
    h('div', { class: 'sheet-wrap', id: 'printable' }, sheetTable(sheet)));
}

/** The copies of the report sent on a day, as buttons: the time and who sent it. */
function sentCopies(day) {
  const sent = state.reports.filter((x) => x.day === day).sort((a, b) => a.at.localeCompare(b.at));
  if (!sent.length) return null;
  return h('div', { class: 'sentrow' }, h('span', null, 'Sent:'), sent.map((x) => h('button', {
    class: 'qchip', title: 'Open the report as it was sent',
    onclick: () => { ui.histCopy = x.id; render(); window.scrollTo(0, 0); },
  }, `${L.fmtTime(x.at)}${x.by ? `  ${x.by}` : ''}`)));
}

function viewHistoryDay() {
  const copy = ui.histCopy && state.reports.find((x) => x.id === ui.histCopy);
  if (copy) return viewSentCopy(copy);
  const r = (ui.histSpan.from || ui.histSpan.to) ? ui.histSpan : { from: today(), to: today() };
  const set = (from, to) => {
    if (from && to && from > to) [from, to] = [to, from]; // typed the wrong way round
    ui.histSpan = { from, to };
    render();
  };
  const box = (key, label) => h('label', { class: 'inline' }, label,
    h('input', { type: 'date', value: r[key], max: today(), onchange: (e) => set(key === 'from' ? e.target.value : r.from, key === 'to' ? e.target.value : r.to) }));
  const bar = h('div', { class: 'toolbar wrap' }, box('from', 'From'), box('to', 'To'),
    h('button', { class: 'btn small', onclick: () => set(today(), today()) }, 'Today'));
  const days = recordDays().filter((d) => (!r.from || d >= r.from) && (!r.to || d <= r.to)).reverse(); // oldest day first
  const label = r.from && r.to && r.from === r.to ? L.fmtDay(r.from) : `${r.from ? L.fmtDay(r.from) : 'the start'} to ${r.to ? L.fmtDay(r.to) : L.fmtDay(today())}`;
  if (!days.length) return h('div', null, bar, h('p', { class: 'empty-big' }, `No loco was updated, and no report sent, on ${label}.`));
  const perDay = days.map((d) => { const locos = d === today() ? state.locos : L.locosOnDay(state, d); return { d, locos, sheet: reportSheet(locos, d) }; });
  const stacked = stackSheets(perDay.map((x) => x.sheet), 'Locos');
  const heading = `DPWS LOCOS ${label}`;
  return h('div', null, bar,
    h('p', { class: 'hint' }, `The position of all locos at the end of each day with a record: ${days.length} day${days.length === 1 ? '' : 's'}, ${label}, oldest first.`),
    exportBar(stacked, `DPWS-locos-${label.replace(/[^0-9A-Za-z]+/g, '-')}`, heading, () => perDay.map((x) => L.reportText(x.locos, x.d)).join('\n\n')),
    h('div', { class: 'sheet-wrap', id: 'printable' }, perDay.map((x, i) => [
      h('h2', { class: 'section-title' }, L.fmtDay(x.d), h('span', { class: 'count' }, String(x.locos.length))),
      sentCopies(x.d),
      sheetTable(x.sheet),
    ])));
}

function viewHistoryLoco() {
  const choices = L.locoChoices(state);
  if (!choices.some((ch) => ch.id === ui.histLoco)) ui.histLoco = choices[0] ? choices[0].id : null;
  const choice = choices.find((ch) => ch.id === ui.histLoco);
  let rows = choice ? L.daySummary(state.log, choice.id, ui.histFrom, ui.histTo) : [];
  if (ui.histChangesOnly) rows = rows.filter((r) => !r.carried);
  const label = choice ? choice.label : '';
  const sheet = historySheet(label, rows, ui.histFrom, ui.histTo);
  const range = (n) => h('button', {
    class: 'btn small',
    onclick: () => { ui.histTo = today(); ui.histFrom = L.addDays(today(), -(n - 1)); render(); },
  }, `Last ${n} days`);

  return h('div', null,
    h('p', { class: 'hint' }, 'Day-wise summary of one loco, for when an officer asks where it has been.'),
    h('div', { class: 'toolbar wrap' },
      h('label', { class: 'inline' }, 'Loco',
        h('select', { onchange: (e) => { ui.histLoco = e.target.value; render(); } },
          choices.map((ch) => h('option', { value: ch.id, selected: ch.id === ui.histLoco }, ch.label)))),
      h('label', { class: 'inline' }, 'From',
        h('input', { type: 'date', value: ui.histFrom, onchange: (e) => { ui.histFrom = e.target.value || ui.histFrom; render(); } })),
      h('label', { class: 'inline' }, 'To',
        h('input', { type: 'date', value: ui.histTo, onchange: (e) => { ui.histTo = e.target.value || ui.histTo; render(); } }))),
    h('div', { class: 'toolbar wrap' }, range(7), range(30), range(90),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: ui.histChangesOnly, onchange: (e) => { ui.histChangesOnly = e.target.checked; render(); } }),
        'Only days with a change')),
    choice
      ? [exportBar(sheet, `Loco-${label.replace(/[^0-9A-Za-z+]+/g, '-')}-summary`, sheet.rows[0][0].v,
        () => L.historyText(label, rows, ui.histFrom, ui.histTo)),
      h('div', { class: 'sheet-wrap', id: 'printable' }, sheetTable(sheet))]
      : h('p', { class: 'empty' }, 'No locos yet.'));
}

// ---------- Unusuals ----------

const UNUSUAL_TITLES = [
  'LOCO TROUBLE-DPWCS', 'LOCO TROUBLE DUE TO DPWCS COMMUNICATION PROBLEM', 'STALLED DUE TO LOCO PROBLEM',
  'STALLED DUE TO TRAILING LOCO PROBLEM', 'LOCO FAILED', 'LOCO PROBLEM', 'LOCO TROUBLE',
];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}

function readOfficial(u) {
  try {
    const o = JSON.parse(u.official);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/** Adds the new reports of a batch (many files, or a sheet of many) in one go, after asking. */
function addManyUnusuals(reports, { files = 1, unreadable = [] } = {}) {
  const have = new Set(mine().map(reportKey));
  const usable = reports.filter((r) => r.day && r.title);
  const { fresh, folded, held } = tidyBatch(usable, have);
  if (!usable.length) { toast(unreadable.length ? `Nothing could be read. ${unreadable.join('; ')}` : 'Found the reports but not their dates. Add the dates and try again.'); return; }
  if (!fresh.length) { toast(`All ${usable.length} report${usable.length === 1 ? '' : 's'} are already in the list.`); return; }
  const msg = [
    `Found ${usable.length} report${usable.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}.`, '',
    `New: ${fresh.length}`,
    held ? `Already in the list: ${held}` : '',
    folded ? `Copies of the same report merged: ${folded}` : '',
    unreadable.length ? `\nCould not read: ${unreadable.join('; ')}` : '',
    `\nAdd the ${fresh.length} new one${fresh.length === 1 ? '' : 's'}?`,
  ].filter((x) => x !== '').join('\n');
  if (!confirm(msg)) return;
  const now = new Date().toISOString();
  for (const r of fresh) dispatch({ type: 'saveUnusual', unusual: { ...L.blankUnusual(r.day), ...r, type: 'loco', app: 'dpwcs', time: '' }, now });
  toast(`Added ${fresh.length} report${fresh.length === 1 ? '' : 's'}`);
}

/** Puts a report read from a file or a paste into the open form. */
function fillUnusual(draft, r) {
  const extra = [r.wagonNo && `Wagon no: ${r.wagonNo}`, r.bpcNo && `BPC no: ${r.bpcNo}`].filter(Boolean).join('\n');
  const reason = [r.reason, extra].filter(Boolean).join('\n');
  for (const [key, value] of Object.entries({ day: r.day, title: r.title, location: r.location, trainNo: r.trainNo, locoNo: r.locoNo, load: r.load, det: r.det, reason })) {
    if (value && (key === 'day' || !String(draft[key] || '').trim())) draft[key] = value;
  }
  if (r.official) { draft.official = r.official; draft.incident = r.incident || ''; }
  draft._paste = '';
}

/** Pasted text: one report fills the form, several are added together. */
function takeUnusualText(draft, text, redraw) {
  const reports = readReports(text, { fileName: '', lastModified: 0 });
  if (!reports.length) { toast('Could not find a report in that. Paste the whole report, or attach the file.'); return; }
  if (reports.length > 1) { draft._paste = ''; addManyUnusuals(reports); redraw(); return; }
  fillUnusual(draft, reports[0]);
  toast('Read the report. Check the boxes below, then save.');
  redraw();
}

/** Attached files (photos, Word, Excel, PDF), as many as chosen at a time. */
async function takeUnusualFiles(draft, list, redraw) {
  const files = [...list];
  if (!files.length) return;
  toast(files.length > 1 ? `Reading ${files.length} files...` : `Reading ${files[0].name}...`);
  const all = [];
  const bad = [];
  for (const file of files) {
    try {
      const text = await fileToText(file, (pct) => toast(`Reading the photo ${file.name}: ${pct}%`));
      const recs = readReports(text, { fileName: file.name, lastModified: file.lastModified });
      if (!recs.length) bad.push(`${file.name} (nothing found in it)`);
      all.push(...recs);
    } catch (e) {
      console.error(e);
      bad.push(`${file.name} (${e instanceof FileError ? e.message : 'could not be read'})`);
    }
  }
  if (files.length === 1 && all.length === 1) { fillUnusual(draft, all[0]); toast('Read the report. Check the boxes below, then save.'); redraw(); return; }
  if (!all.length) { toast(bad.length ? `Nothing could be read. ${bad.join('; ')}` : 'Nothing found in those files.'); return; }
  addManyUnusuals(all, { files: files.length, unreadable: bad });
  redraw();
}

/** The official Sr.DEE report, as tiles and a time line. */
function officialDetails(u) {
  const o = readOfficial(u);
  const summary = h('summary', null,
    h('span', { class: 'o-badge' }, 'Sr.DEE'),
    `Official report${u.incident ? `, incident ${u.incident}` : ''}`);
  if (!o) return h('details', { class: 'o-panel' }, summary, h('p', { class: 'o-raw' }, u.official));
  const tile = (label, value) => value && h('div', { class: 'o-tile' }, h('small', null, label), h('span', null, value));
  const locos = [o.loco, o.multi && `+ ${o.multi}`].filter(Boolean).join(' ');
  return h('details', { class: 'o-panel' }, summary,
    h('div', { class: 'o-grid' },
      tile('Incident type', o.type), tile('Cause', o.cause), tile('Nature of failure', o.nature),
      tile('Detention', o.detention), tile('Repercussions', o.repercussions),
      tile('Loco', locos), tile('Train and load', [o.train, o.load].filter(Boolean).join('   ')),
      tile('Failed section', o.section), tile('Major section', o.major),
      tile('Schedule', [o.schedDone && `done ${o.schedDone}`, o.schedDue && `due ${o.schedDue}`].filter(Boolean).join(', ')),
      tile('Loco pilot', o.lp), tile('Assistant', o.alp), tile('CLI', o.cli)),
    o.timeline && o.timeline.length > 0 && h('ol', { class: 'o-time' }, o.timeline.map((x) => h('li', null,
      x.t ? h('b', null, x.t) : h('b', { class: 'none' }, '•'), h('span', null, x.text)))),
    o.previous && h('p', { class: 'o-prev' }, h('b', null, 'Earlier incidents: '), o.previous));
}

// ---------- DPWCS loco failures: laid out like SCR UNUSALS ----------
// The tab opens with a new report ready to fill in (cells, Save, Clear). The reports already
// saved are not listed: choose From and To dates, or click a date, and they appear one row
// each, with Edit and Delete, to share all at once.

const U_LABEL = {
  title: 'Train details (heading)', location: 'Location', trainNo: 'Train no', locoNo: 'Loco no', load: 'Load',
  detFrom: 'DET from', detTo: 'DET to', det: 'DET (detention)', reason: 'Sequence of events',
};
const U_HINT = {
  title: 'LOCO TROUBLE-DPWCS', location: 'PRLI-GTU', trainNo: 'KSNK/BOXNL', locoNo: '27592+27767/KZJ/DUE-11/11',
  load: '59/59/4882T', det: '06:39 HRS', reason: 'Times, km, what was done, relief loco, crew...',
};
const U_WIDE = new Set(['title', 'locoNo']);
const U_BOXES = ['title', 'location', 'trainNo', 'locoNo', 'load', 'det', 'reason'];
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
/** "07-09-2026 (MONDAY)", the way a day is written on a report. */
const officialDay = (key) => { const [y, m, d] = key.split('-').map(Number); return `${L.fmtDay(key)} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`; };

/** Saves a loco failure of this app. The screen is redrawn by dispatch. */
const saveUnusual = (u) => dispatch({ type: 'saveUnusual', unusual: { ...u, type: 'loco', app: 'dpwcs', time: '' }, now: new Date().toISOString() });

const isBlankDraft = (d) => !['title', 'location', 'trainNo', 'locoNo', 'load', 'det', 'detFrom', 'detTo', 'reason'].some((k) => String(d[k] || '').trim());

function draftFor() {
  if (!ui.drafts.loco) ui.drafts.loco = L.blankUnusual(today());
  return ui.drafts.loco;
}

/** The report as it is typed: the cells, Save and Clear, and a way to read a file or a pasted report into them. */
function newUnusualCard() {
  const draft = draftFor();
  const titles = [...new Set([...UNUSUAL_TITLES, ...mine().map((u) => u.title).filter(Boolean)])].filter((t) => t.length <= 32).slice(0, 6);
  const locos = [...new Set(state.locos.map((l) => l.locoNo).filter(Boolean))];

  const cell = (key) => {
    if (key === 'reason') {
      return h('div', { class: 'ncell s4 events' }, h('span', null, 'Sequence of events'),
        eventsEditor(h, draft.reason, (v) => { draft.reason = v; }));
    }
    const isText = false;
    const el = isText
      ? h('textarea', { rows: 3, placeholder: U_HINT[key] ? `e.g. ${U_HINT[key]}` : '' })
      : h('input', {
        type: key === 'detFrom' || key === 'detTo' ? 'time' : 'text',
        placeholder: U_HINT[key] && key !== 'detFrom' && key !== 'detTo' ? `e.g. ${U_HINT[key]}` : '',
        autocapitalize: key === 'detFrom' || key === 'detTo' ? null : 'characters', autocomplete: 'off',
      });
    el.value = draft[key] || '';
    el.setAttribute('data-box', key);
    if (key === 'title') el.setAttribute('list', 'u-titles');
    if (key === 'locoNo') el.setAttribute('list', 'u-locos');
    el.addEventListener('input', (e) => {
      draft[key] = e.target.value;
      if (key === 'detFrom' || key === 'detTo') {
        const d = L.detentionBetween(draft.detFrom, draft.detTo);
        if (d) { draft.det = d; const box = card.querySelector('[data-box="det"]'); if (box) box.value = d; }
      }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); } });
    return h('label', { class: `ncell ${key === 'reason' ? 's4' : U_WIDE.has(key) ? 's2' : ''}` }, h('span', null, U_LABEL[key]), el);
  };

  const doSave = () => {
    if (!draft.day) { toast('Pick the date'); return; }
    if (isBlankDraft(draft)) { toast('Type the report first'); return; }
    if (!String(draft.title || '').trim()) { toast('Enter the train details (the heading)'); const t = card.querySelector('[data-box="title"]'); if (t) t.focus(); return; }
    const rec = { ...draft };
    ui.drafts.loco = L.blankUnusual(rec.day); // the next report is usually of the same day
    ui.span.unusuals = { from: rec.day, to: rec.day }; // and the saved one is shown below
    toast('Report saved');
    saveUnusual(rec);
  };
  const doClear = () => { const day = draft.day; ui.drafts.loco = L.blankUnusual(day); render(); };

  const chooser = h('input', {
    type: 'file', multiple: true, accept: 'image/*,.docx,.pdf,.xlsx,.csv,.txt,application/pdf', style: 'display:none',
    onchange: (e) => { const list = [...e.target.files]; e.target.value = ''; takeUnusualFiles(draft, list, render); },
  });

  const grid = h('div', { class: 'ngrid' }, U_BOXES.map((k) => (k === 'det'
    ? h('div', { class: 'ncell s4 det3' },
      h('label', { class: 'ncell' }, h('span', null, U_LABEL.detFrom), cell('detFrom').querySelector('input')),
      h('label', { class: 'ncell' }, h('span', null, U_LABEL.detTo), cell('detTo').querySelector('input')),
      cell('det'))
    : cell(k))));

  const card = h('section', { class: 'newcard dpwcs' },
    h('div', { class: 'newhead' },
      h('h2', null, 'New DPWCS loco failure report'),
      h('label', { class: 'ndate' }, h('span', null, 'Date'), h('input', {
        type: 'date', value: draft.day, 'aria-label': 'Date of the report',
        onchange: (e) => { draft.day = e.target.value; if (draft.day) ui.span.unusuals = { from: draft.day, to: draft.day }; render(); },
      }))),
    grid,
    titles.length > 0 && h('div', { class: 'quick' }, h('span', null, 'Quick heading:'), titles.map((t) => h('button', {
      type: 'button', class: 'qchip', onclick: () => { draft.title = t; const el = card.querySelector('[data-box="title"]'); if (el) { el.value = t; el.focus(); } },
    }, t))),
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
    if (!/DETENTION\s+PARTICULARS|ASSET\s+FAILURE|FIRST\s+INFORMATION\s+REPORT|BRIEF\s+HISTORY|Failure Report|Incident ID/i.test(text)) return;
    e.preventDefault();
    takeUnusualText(draft, text, render);
  });
  return card;
}

/** The dates: a slim bar with From, To and Today, and the reports of those days right under it (today's to begin with). */
function unusualDays(items, content) {
  const r = (ui.span.unusuals && (ui.span.unusuals.from || ui.span.unusuals.to)) ? ui.span.unusuals : { from: today(), to: today() };
  const set = (from, to) => {
    if (from && to && from > to) [from, to] = [to, from]; // typed the wrong way round
    ui.span.unusuals = { from, to };
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

/** The saved reports of the chosen days: one row each, a heading row for each day. Edit turns a row into cells with Save and Cancel. */
function unusualRows(items, label) {
  const grow = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };
  const span = U_BOXES.length + 2;
  const body = h('tbody');
  let n = 0;
  for (const [day, list] of L.unusualsByDay(items).reverse()) { // oldest day first, like the shared sheet
    body.append(h('tr', { class: 'dayrow' }, h('td', { colspan: span }, officialDay(day), h('span', { class: 'count' }, String(list.length)))));
    for (const u of list) {
      n++;
      if (ui.edit && ui.edit.id === u.id) {
        const buf = ui.edit.buf;
        const tr = h('tr', { class: 'editing' }, h('td', { class: 'sr' }, String(n)));
        for (const key of U_BOXES) {
          if (key === 'reason') { tr.append(h('td', { class: 'c-reason' }, eventsEditor(h, buf.reason || '', (v) => { buf.reason = v; }, { min: 2 }))); continue; }
          const el = h('textarea', { rows: 1, class: 'cell', 'aria-label': U_LABEL[key], autocapitalize: key === 'reason' ? null : 'characters' });
          el.value = buf[key] || '';
          el.addEventListener('input', () => { buf[key] = el.value; grow(el); });
          requestAnimationFrame(() => grow(el));
          tr.append(h('td', { class: key === 'title' ? 'c-title' : key === 'reason' ? 'c-reason' : '' }, el));
        }
        tr.append(h('td', { class: 'act' },
          h('button', { class: 'btn small primary', onclick: () => { const rec = { ...u, ...buf }; ui.edit = null; toast('Saved'); saveUnusual(rec); } }, 'Save'),
          h('button', { class: 'btn small', onclick: () => { ui.edit = null; render(); } }, 'Cancel')));
        body.append(tr);
        continue;
      }
      const tr = h('tr', null, h('td', { class: 'sr' }, String(n)));
      for (const key of U_BOXES) tr.append(h('td', { class: `ro ${key === 'title' ? 'c-title strong' : key === 'reason' ? 'c-reason' : ''}` }, String(u[key] || '')));
      tr.append(h('td', { class: 'act' },
        h('button', { class: 'link', onclick: () => { ui.edit = { id: u.id, buf: Object.fromEntries(U_BOXES.map((k) => [k, u[k] || ''])) }; render(); } }, 'Edit'),
        h('button', { class: 'link danger', onclick: () => {
          if (!confirm(`Delete the report of ${L.fmtDay(u.day)} (${u.title || 'no heading'})?`)) return;
          dispatch({ type: 'removeUnusual', id: u.id });
          toast('Deleted');
        } }, 'Delete')));
      body.append(tr);
      if (u.official || u.incident) body.append(h('tr', { class: 'subrow' }, h('td', { colspan: span }, officialDetails(u))));
    }
  }
  const head = h('thead', null, h('tr', null, h('th', { class: 'sr' }, '#'), U_BOXES.map((k) => h('th', null, U_LABEL[k])), h('th', { class: 'act' }, '')));
  const heading = `DPWCS LOCO FAILURES ${label}`;
  const text = () => `*${heading}*\n\n${L.unusualText(items)}`;
  const r = ui.span.unusuals || {};
  return h('div', null,
    items.length > 0 && exportBar(unusualSheet(items, 'Unusals'), `DPWCS-loco-failures-${label.replace(/[^0-9A-Za-z]+/g, '-')}`, heading, text),
    items.length > 0 && h('div', { class: 'actions' },
      h('button', { class: 'btn whatsapp', onclick: () => sendWhatsApp(text()) }, 'Send on WhatsApp'),
      r.from && r.from === r.to && h('button', { class: 'btn', onclick: () => sendWhatsApp(daySummaryText(r.from)) }, 'Daily summary on WhatsApp')),
    items.length
      ? h('div', { class: 'cells-wrap' }, h('table', { class: 'cells' }, head, body))
      : h('p', { class: 'empty-big' }, 'No report in these dates. Write one in the box above: it is saved on the date shown there.'));
}

function viewUnusuals() {
  return h('div', { class: 'failures' },
    SHARED && status.unusualsMissing && h('p', { class: 'notice' },
      'Unusual reports are being kept on this device only for now. To share them with everyone, the shared database needs one extra table: run supabase/setup-unusuals.sql once (steps are in the README). Nothing is lost meanwhile.'),
    newUnusualCard(),
    h('h2', { class: 'section-title saved-title' }, 'Saved reports', h('small', null, 'today to begin with')),
    unusualDays(mine(), (items, label) => unusualRows(items, label)));
}


// ---------- More ----------

/** Backup, shown at the foot of History. */
function backupPanel() {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.locos) || !Array.isArray(data.log)) throw new Error('bad file');
        if (!confirm(`Replace everything on this device with the backup (${data.locos.length} locos)?`)) return;
        state = { ...L.emptyState(), locos: data.locos, log: data.log, reports: data.reports || [], sync: NO_SYNC };
        await saveState(state);
        ui.reportId = null;
        toast('Backup restored');
        render();
      } catch {
        toast('That file is not a DPWCS LOCO backup');
      }
    },
  });
  return h('section', { class: 'panel backup' },
    h('h2', null, 'Backup'),
    h('p', null, SHARED
      ? `Download a copy of everything to keep as a file: ${state.locos.length} locos, ${state.log.length} history entries, ${state.reports.length} reports.`
      : 'Your data is stored on this device only. Download a backup to keep a safe copy, or restore one here.'),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn',
        onclick: () => shareOrDownload(
          new Blob([JSON.stringify({ version: 1, locos: state.locos, log: state.log, reports: state.reports })], { type: 'application/json' }),
          `dpwcs-loco-backup-${L.fmtDay(today())}.json`, 'DPWCS LOCO backup'),
      }, 'Download backup'),
      // Restoring replaces data, so it is only offered when nothing is shared.
      !SHARED && h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore backup'),
      fileInput));
}

// ---------- sign in ----------

function statusText() {
  const n = status.pending;
  const waiting = `${n} change${n === 1 ? '' : 's'} waiting to upload`;
  switch (status.phase) {
    case 'synced': return 'All changes saved to the database';
    case 'syncing': return n ? `Saving ${n} change${n === 1 ? '' : 's'}` : 'Checking for updates';
    case 'offline': return n ? `No internet, ${waiting}` : 'No internet, showing the last saved data';
    case 'error': return `Database problem${status.error ? `: ${status.error}` : ''}${n ? `, ${waiting}` : ''}`;
    default: return '';
  }
}

function viewName() {
  const name = h('input', { type: 'text', required: true, maxLength: 30, autocomplete: 'name', placeholder: 'For example: Mahesh' });
  return h('form', {
    class: 'panel signin',
    onsubmit: (e) => {
      e.preventDefault();
      if (name.value.trim()) sync.setName(name.value);
    },
  },
  h('h2', null, 'Your name'),
  h('p', null, 'Asked once on this device. It is shown next to the updates you make, so everyone can see who changed what.'),
  h('label', { class: 'field' }, h('span', null, 'Name'), name),
  h('button', { type: 'submit', class: 'btn primary' }, 'Continue'));
}

function viewSignIn() {
  let busy = false;
  const email = h('input', { type: 'email', autocomplete: 'username', required: true, placeholder: 'you@example.com' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const message = h('p', { class: 'form-error', role: 'alert' });
  const button = h('button', { type: 'submit', class: 'btn primary' }, 'Sign in');
  return h('form', {
    class: 'panel signin',
    onsubmit: async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      button.textContent = 'Signing in...';
      message.textContent = '';
      try {
        await sync.signIn(email.value.trim(), password.value);
      } catch (err) {
        message.textContent = err.status
          ? 'Email or password is not correct.'
          : 'Could not reach the database. Check the internet connection and try again.';
        busy = false;
        button.textContent = 'Sign in';
      }
    },
  },
  h('h2', null, 'Sign in'),
  h('p', null, 'Use the email and password given to you for the loco tracker.'),
  h('label', { class: 'field' }, h('span', null, 'Email'), email),
  h('label', { class: 'field' }, h('span', null, 'Password'), password),
  message, button);
}

// ---------- shell ----------

const TABS = [['locos', 'Locos'], ['report', 'Report'], ['unusuals', 'Unusuals'], ['history', 'History']];
const VIEWS = { locos: viewLocos, report: viewReport, unusuals: viewUnusuals, history: viewHistory };

// ---------- install as an app ----------
// Chrome and Edge (Windows and Android) can install this page as an app with
// its own window and icon. They hand us the install prompt when it is
// available; other browsers get short instructions instead.

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Installed. Open it from your apps or home screen.');
  render();
});

const BANNER_KEY = 'loco-tracker-install-banner-closed';
function installBannerClosed() {
  try { return localStorage.getItem(BANNER_KEY) === '1'; } catch { return false; }
}
function closeInstallBanner() {
  try { localStorage.setItem(BANNER_KEY, '1'); } catch { /* private mode */ }
}

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function installApp() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    return;
  }
  const dlg = document.getElementById('editor');
  const step = (title, ...lines) => h('section', null, h('h3', null, title), h('ol', null, lines.map((l) => h('li', null, l))));
  dlg.replaceChildren(h('div', { class: 'editor help' },
    h('h2', null, 'Install the app'),
    h('p', null, 'It installs straight from this page. There is nothing to download from a store.'),
    step('Windows computer (Chrome or Edge)',
      'Open this page in Chrome or Edge.',
      'Click the install icon at the right end of the address bar (a small screen with a down arrow), or open the three-dot menu and choose "Install DPWCS LOCO" (in Chrome: Cast, save and share, then Install page as app; in Edge: Apps, then Install this site as an app).',
      'Click Install. The app opens in its own window and appears in the Start menu. Right-click its taskbar icon and choose "Pin to taskbar" to keep it handy.'),
    step('Android phone (Chrome)',
      'Open this page in Chrome.',
      'Tap the three-dot menu at the top right.',
      'Tap "Add to Home screen", then "Install".'),
    step('iPhone (Safari)',
      'Open this page in Safari.',
      'Tap the Share button.',
      'Tap "Add to Home Screen", then "Add".'),
    h('div', { class: 'editor-actions' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, 'Close'))));
  dlg.showModal();
}

let shownGate = null;
let redrawing = false;

function render() {
  // Shown before the app itself: sign-in, or in open mode a one-time name.
  const gate = !SHARED ? null : REQUIRE_LOGIN
    ? (status.phase === 'signed-out' ? viewSignIn : null)
    : (sync && !sync.email ? viewName : null);
  const signedOut = !!gate;
  const other = state.locos.filter((l) => l.division === 'OTHER').length;
  // On a phone, a full-width strip at the very top offers the install in
  // one tap. Closing it leaves the small Install app button in its place.
  const banner = !isInstalled() && !installBannerClosed();
  const header = h('header', { class: `top ${banner ? 'has-banner' : ''}` },
    banner && h('div', { class: 'install-banner' },
      h('button', { class: 'install-go', onclick: installApp },
        h('strong', null, 'Tap here to install the app'),
        h('span', null, 'Opens from your home screen like any other app')),
      h('button', {
        class: 'install-close', 'aria-label': 'Hide the install message',
        onclick: () => { closeInstallBanner(); render(); },
      }, '\u00d7')),
    h('div', { class: 'top-inner' },
      h('div', { class: 'top-row' },
        h('h1', null, h('img', { class: 'logo', src: '../icons/logo.png', alt: 'Indian Railways', width: 34, height: 34 }), 'DPWCS LOCO'),
        h('span', { class: 'top-links' },
          h('img', { class: 'ti-badge', src: '../icons/tigoods.png', alt: 'TI GOODS', width: 48, height: 48 }),
          !isInstalled() && h('button', { class: 'install', onclick: installApp }, 'Install app'))),
      h('p', null, signedOut
        ? L.fmtDay(today())
        : `${L.fmtDay(today())}  |  ${state.locos.length} locos  |  ${other} in other divisions`),
      SHARED && !signedOut && h('p', { class: 'top-meta' },
        // Tap the status to check with the database straight away.
        h('button', {
          class: `sync ${status.phase}`, id: 'sync-status', title: 'Tap to sync now',
          onclick: () => sync.syncNow(),
        }, statusText()),
        REQUIRE_LOGIN
          ? h('button', {
            class: 'who',
            onclick: () => {
              if (status.pending && !confirm(`${status.pending} changes have not been uploaded yet. Sign out anyway? They will upload after the next sign-in on this device.`)) return;
              sync.signOut();
            },
          }, `${status.email}  (sign out)`)
          : h('button', {
            class: 'who', title: 'Tap to change your name',
            onclick: () => {
              const name = prompt('Your name, shown next to the updates you make:', status.email);
              if (name && name.trim()) sync.setName(name);
            },
          }, `${status.email}  (change name)`))));
  if (signedOut) {
    // Data arriving in the background must not wipe a form being typed in.
    if (shownGate === gate && document.querySelector('.signin')) return;
    shownGate = gate;
    document.getElementById('app').replaceChildren(header, h('main', null, gate()));
    return;
  }
  shownGate = null;
  // Redrawing must not interrupt someone typing in a table box.
  const typing = document.activeElement && document.activeElement.classList.contains('cell-input')
    ? document.activeElement : null;
  const keep = typing && {
    id: typing.dataset.id, field: typing.dataset.field, value: typing.value,
    from: typing.selectionStart, to: typing.selectionEnd,
  };
  const writing = document.activeElement && document.getElementById('app').contains(document.activeElement) &&
    document.activeElement.dataset.ukey ? document.activeElement : null;
  const keepWriting = writing && { key: writing.dataset.ukey, from: writing.selectionStart, to: writing.selectionEnd };
  redrawing = true;
  document.getElementById('app').replaceChildren(
    header,
    h('nav', { class: 'tabs' }, TABS.map(([id, text]) => h('button', {
      class: ui.view === id ? 'on' : '',
      onclick: () => { sel = null; ui.view = id; render(); window.scrollTo(0, 0); },
    }, text))),
    h('main', null, VIEWS[ui.view]()));
  redrawing = false;
  paintSel();
  if (keepWriting) {
    const box = document.querySelector(`#app .u-input[data-ukey="${keepWriting.key}"]`);
    if (box) {
      box.focus();
      try { box.setSelectionRange(keepWriting.from, keepWriting.to); } catch { /* date boxes have no cursor */ }
    }
  }
  if (keep) {
    const box = document.querySelector(`.cell-input[data-id="${keep.id}"][data-field="${keep.field}"]`);
    if (box) {
      box.value = keep.value;
      box.focus();
      box.setSelectionRange(keep.from, keep.to);
    }
  }
}

// A redraw from the shared database waits while a box is being typed in, then happens.
let pendingRender = false;
function renderSafe() {
  const a = document.activeElement;
  if (a && a.matches && a.matches('.newcard input, .newcard textarea, table.cells textarea')) { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => { if (pendingRender) { pendingRender = false; setTimeout(render, 0); } });

function onSyncStatus(next) {
  const screenChanged = (next.phase === 'signed-out') !== (status.phase === 'signed-out') || next.email !== status.email;
  status = next;
  if (status.phase === 'synced') { importOldRecords(); importOldUnusuals(); }
  if (screenChanged) { renderSafe(); return; }
  // Routine status changes only touch the status line, so a form being
  // filled in or a table being scrolled is not disturbed.
  const line = document.getElementById('sync-status');
  if (line) { line.textContent = statusText(); line.className = `sync ${status.phase}`; }
}

async function start() {
  const stored = await loadState();
  if (stored && Array.isArray(stored.locos)) {
    state = { ...L.emptyState(), ...stored };
  } else {
    state = seedState();
  }
  state.sync = { ...NO_SYNC, ...state.sync };
  await saveState(state);
  if (SHARED) {
    sync = createSync({
      url: SUPABASE_URL,
      key: SUPABASE_KEY,
      login: REQUIRE_LOGIN,
      getState: () => state,
      setState: (next, redraw) => { state = next; persist(); if (redraw) renderSafe(); },
      onStatus: onSyncStatus,
    });
    status = { ...status, phase: sync.signedIn ? 'syncing' : 'signed-out', email: sync.email };
  }
  render();
  if (sync) sync.start();
  else { importOldRecords(); importOldUnusuals(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
