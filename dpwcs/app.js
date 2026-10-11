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
  uSearch: '',
  uMonth: 'all',
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

// The three boxes of the table, left to right. A block copied from Excel
// lands starting at the box it is pasted into, one row per loco going down.
const PASTE_COLS = ['trainNo', 'location', 'working'];

function pasteCells(e, loco, key) {
  const raw = (e.clipboardData || window.clipboardData).getData('text').replace(/\r/g, '');
  const text = raw.replace(/\n+$/, '');
  if (!/[\t\n]/.test(text)) return; // a single cell: paste as usual
  e.preventDefault();
  const rows = text.split('\n').map((line) => line.split('\t').map((v) => v.trim().replace(/^"(.*)"$/s, '$1')));
  const ids = [...document.querySelectorAll('#lists .card')].map((c) => c.querySelector('.cell-input').dataset.id);
  const row0 = ids.indexOf(loco.id);
  const col0 = PASTE_COLS.indexOf(key);
  const edits = new Map();
  let cells = 0;
  let outside = 0;
  rows.forEach((cols, i) => {
    const id = ids[row0 + i];
    if (!id) { outside++; return; }
    cols.forEach((value, j) => {
      const field = PASTE_COLS[col0 + j];
      if (!field) return;
      if (!edits.has(id)) edits.set(id, {});
      edits.get(id)[field] = value;
      cells++;
    });
  });
  const now = new Date().toISOString();
  let next = state;
  for (const [id, fields] of edits) {
    const current = next.locos.find((l) => l.id === id);
    if (current) next = L.reduce(next, { type: 'save', loco: { ...current, ...fields }, now, by: who() });
  }
  hideSuggest();
  commit(next);
  render();
  toast(`Pasted ${cells} cell${cells === 1 ? '' : 's'} into ${edits.size} loco${edits.size === 1 ? '' : 's'}${outside ? `. ${outside} row${outside === 1 ? '' : 's'} went past the end of the list and were left out` : ''}`);
}

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
  // On a wide screen, train number and location can be changed right in the
  // table. A phone hides these two boxes and opens the full form instead.
  const cell = (key, label) => h('input', {
    type: 'text', class: `col cell-input${key === 'working' && workKind(l.working) ? ` w-${workKind(l.working)}` : ''}`, value: l[key], placeholder: '-',
    'aria-label': `${label} of ${l.locoNo}`, 'data-id': l.id, 'data-field': key,
    autocapitalize: 'characters', autocomplete: 'off',
    onclick: (e) => e.stopPropagation(),
    onpaste: (e) => pasteCells(e, l, key),
    onfocus: key === 'working' ? (e) => showSuggest(e.target) : null,
    oninput: key === 'working' ? (e) => showSuggest(e.target) : null,
    onblur: key === 'working' ? hideSuggest : null,
    onkeydown: (e) => { if (e.key === 'Escape') { hideSuggest(); e.target.value = l[key]; e.target.blur(); } },
    onchange: (e) => {
      // A box removed by a redraw reports a change too; that is not the
      // person finishing their edit, so it must not be saved.
      if (redrawing || !e.target.isConnected) return;
      const value = e.target.value.trim();
      if (value === l[key]) return;
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
  // Green: updated since the last report. Red: still to be updated. Pressing
  // a red dot confirms "no change" without typing anything.
  const ok = L.isUpdated(l, since);
  const dot = h('button', {
    class: `dot ${ok ? 'ok' : 'due'}`,
    title: ok ? 'Updated' : 'Not updated yet. Press to confirm there is no change.',
    'aria-label': ok ? `${l.locoNo} is updated` : `${l.locoNo} is not updated yet. Press to confirm there is no change.`,
    onclick: (e) => {
      e.stopPropagation();
      if (ok) return;
      dispatch({ type: 'check', id: l.id, now: new Date().toISOString() });
      toast(`${l.locoNo}: confirmed, no change`);
    },
  }, ok ? '\u2713' : '!');
  return h('div', { class: 'card', onclick: () => openEditor(l) },
    h('span', { class: 'serial' }, row.span === 0 ? '' : String(row.serial)),
    h('button', { class: 'loco-no', title: 'Open this loco' }, l.locoNo || '(no number)'),
    cell('trainNo', 'Train no'),
    cell('location', 'Current location'),
    cell('working', 'Working'),
    dot);
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
        list.length ? list.map((r) => locoCard(r, since)) : h('p', { class: 'empty' }, q ? 'No match.' : 'No locos here.'));
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
      document.getElementById('lists').replaceChildren(...buildLists());
    },
  });
  return h('div', null,
    h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn primary', onclick: () => openEditor(null) }, '+ Add loco')),
    h('p', { class: 'hint wide-only' }, 'Type in the Train No, Current location or Working box to change it, or paste a block copied from Excel. Click a loco number for all its details.'),
    h('p', { class: 'hint narrow-only' }, 'Tap a loco number to see and update its details.'),
    h('div', { id: 'lists' }, buildLists()));
}

function openEditor(loco) {
  const isNew = !loco;
  const draft = loco ? { ...loco } : L.blankLoco('SC');
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
function positionStats(locos) {
  const sc = locos.filter((l) => l.division === 'SC');
  const kinds = sc.map((l) => workKind(l.working));
  const tile = (label, n, tone) => h('div', { class: `stat ${tone}` }, h('b', null, String(n)), h('span', null, label));
  return h('div', { class: 'stats' },
    tile('In other divisions', locos.length - sc.length, ''),
    tile('In SC division', sc.length, 'teal'),
    tile('Working', kinds.filter((k) => k === 'good').length, 'green'),
    tile('In shed / planned', kinds.filter((k) => k === 'warn').length, 'amber'),
    tile('Defective', kinds.filter((k) => k === 'bad').length, 'red'));
}

function viewReport() {
  const saved = ui.reportId && state.reports.find((r) => r.id === ui.reportId);
  const isToday = ui.reportDay === today();
  const day = saved ? saved.day : ui.reportDay;
  const locos = saved ? saved.locos : (isToday ? state.locos : L.locosOnDay(state, ui.reportDay));
  const sheet = reportSheet(locos, day);
  const fileBase = `DPWS-locos-${L.fmtDay(day)}${saved ? `-${L.fmtTime(saved.at).replace(':', '')}` : ''}`;

  // Sharing today's live report also files a copy, so there is a record of
  // exactly what was sent each time.
  const keepCopy = () => {
    if (saved || !isToday) return;
    const lastOne = state.reports[state.reports.length - 1];
    const same = lastOne && lastOne.day === day && lastOne.locos.length === locos.length &&
      lastOne.locos.every((l, i) => l.id === locos[i].id && L.sameFields(l, locos[i]));
    if (same) return;
    const report = { id: L.uid(), at: new Date().toISOString(), day, by: who(), locos: locos.map((l) => ({ ...l })) };
    setTimeout(() => dispatch({ type: 'addReport', report }), 0);
  };

  let note;
  if (saved) note = `Saved copy of the report sent on ${L.fmtDay(saved.day)} at ${L.fmtTime(saved.at)}.`;
  else if (isToday) note = 'Current position of all locos. Update locos first, then share.';
  else if (ui.reportDay > today()) note = 'This date is in the future, showing the current position.';
  else note = `Position as it stood at the end of ${L.fmtDay(ui.reportDay)}, rebuilt from the saved updates.`;

  const recent = [...state.reports].reverse().slice(0, 30);
  return h('div', null,
    h('div', { class: 'toolbar' },
      h('label', { class: 'inline' }, 'Date',
        h('input', {
          type: 'date', value: day,
          onchange: (e) => { ui.reportDay = e.target.value || today(); ui.reportId = null; render(); },
        })),
      (saved || !isToday) && h('button', {
        class: 'btn', onclick: () => { ui.reportId = null; ui.reportDay = today(); render(); },
      }, 'Back to today')),
    h('p', { class: 'hint' }, note),
    positionStats(locos),
    exportBar(sheet, fileBase, sheet.rows[0][0].v, () => L.reportText(locos, day), keepCopy),
    h('div', { class: 'sheet-wrap', id: 'printable' }, sheetTable(sheet)),
    h('h2', { class: 'section-title' }, 'Reports sent', h('span', { class: 'count' }, state.reports.length)),
    recent.length
      ? h('ul', { class: 'rows' }, recent.map((r) => h('li', { class: r.id === ui.reportId ? 'on' : '' },
        h('button', { class: 'row-main', onclick: () => { ui.reportId = r.id; render(); window.scrollTo(0, 0); } },
          `${L.fmtDay(r.day)}  ${L.fmtTime(r.at)}${r.by ? `  ${r.by}` : ''}`),
        h('button', {
          class: 'link danger',
          onclick: () => {
            if (!confirm('Delete this saved report?')) return;
            if (ui.reportId === r.id) ui.reportId = null;
            dispatch({ type: 'removeReport', id: r.id });
          },
        }, 'Delete'))))
      : h('p', { class: 'empty' }, 'Nothing yet. Each time you share the report, a copy is kept here.'));
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

function viewHistoryDay() {
  const days = recordDays();
  const day = ui.histDay;
  const locos = day === today() ? state.locos : L.locosOnDay(state, day);
  const sheet = reportSheet(locos, day);
  const sent = state.reports.filter((r) => r.day === day);
  const pick = (d) => { ui.histDay = d; render(); };
  return h('div', null,
    h('p', { class: 'hint' }, 'Pick a date to see the position of every loco on that day.'),
    h('div', { class: 'toolbar wrap' },
      h('label', { class: 'inline' }, 'Date',
        h('input', { type: 'date', value: day, max: today(), onchange: (e) => pick(e.target.value || today()) })),
      h('button', { class: 'btn small', onclick: () => pick(L.addDays(day, -1)) }, 'Previous day'),
      h('button', { class: 'btn small', disabled: day >= today(), onclick: () => pick(L.addDays(day, 1)) }, 'Next day')),
    h('div', { class: 'days', 'aria-label': 'Dates with records' }, days.map((d) => h('button', {
      class: `day ${d === day ? 'on' : ''}`, onclick: () => pick(d),
    }, L.fmtDay(d).slice(0, 5)))),
    locos.length
      ? [
        h('p', { class: 'hint' }, days.includes(day)
          ? `Position of all locos at the end of ${L.fmtDay(day)}.`
          : `No report was recorded on ${L.fmtDay(day)}. Showing the last known position before it.`),
        exportBar(sheet, `DPWS-locos-${L.fmtDay(day)}`, sheet.rows[0][0].v, () => L.reportText(locos, day)),
        h('div', { class: 'sheet-wrap', id: 'printable' }, sheetTable(sheet)),
      ]
      : h('p', { class: 'empty' }, `There are no records on or before ${L.fmtDay(day)}.`),
    sent.length > 0 && [
      h('h2', { class: 'section-title' }, `Reports sent on ${L.fmtDay(day)}`, h('span', { class: 'count' }, sent.length)),
      h('ul', { class: 'rows' }, sent.map((r) => h('li', null,
        h('button', {
          class: 'row-main',
          onclick: () => { ui.view = 'report'; ui.reportId = r.id; render(); window.scrollTo(0, 0); },
        }, `${L.fmtTime(r.at)}${r.by ? `  ${r.by}` : ''}  (open as sent)`)))),
    ]);
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

/** The colour of a report: DPWCS troubles blue, failures and stalls red, the rest amber. */
function unusualKind(u) {
  if (/DPWCS|DPWS/i.test(u.title)) return 'dpwcs';
  if (/FAIL|STALL/i.test(u.title)) return 'fail';
  return 'other';
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
  for (const r of fresh) dispatch({ type: 'saveUnusual', unusual: { ...L.blankUnusual(r.day), ...r, type: 'loco', app: 'dpwcs' }, now });
  toast(`Added ${fresh.length} report${fresh.length === 1 ? '' : 's'}`);
}

/** Puts a report read from a file or a paste into the open form. */
function fillUnusual(draft, r) {
  const extra = [r.wagonNo && `Wagon no: ${r.wagonNo}`, r.bpcNo && `BPC no: ${r.bpcNo}`].filter(Boolean).join('\n');
  const reason = [r.reason, extra].filter(Boolean).join('\n');
  for (const [key, value] of Object.entries({ day: r.day, time: r.time, title: r.title, location: r.location, trainNo: r.trainNo, locoNo: r.locoNo, load: r.load, det: r.det, reason })) {
    if (value && (key === 'day' || key === 'time' || !String(draft[key] || '').trim())) draft[key] = value;
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

/**
 * The attach / paste box at the top of the form. Attach (or drop) the Sr.DEE
 * PDF, or an Excel or PDF unusual sheet; or paste copied text. The data is
 * read from it and the empty boxes of the form are filled.
 */
function officialPaste(draft, redraw) {
  const o = readOfficial(draft);
  const box = h('textarea', {
    rows: 3, value: draft._paste || '',
    placeholder: 'Or paste the copied text here (open the PDF, Ctrl+A, Ctrl+C, then Ctrl+V)',
  });
  box.classList.add('u-input');
  box.setAttribute('data-ukey', '_paste');
  box.addEventListener('input', (e) => { draft._paste = e.target.value; });

  const chooser = h('input', {
    type: 'file', multiple: true, accept: 'image/*,.docx,.pdf,.xlsx,.csv,.txt,application/pdf', style: 'display:none',
    onchange: (e) => { const list = [...e.target.files]; e.target.value = ''; takeUnusualFiles(draft, list, redraw); },
  });
  const panel = h('div', { class: 'opaste' },
    h('div', { class: 'opaste-head' },
      h('strong', null, 'Attach the official Sr.DEE report'),
      o || draft.official
        ? h('span', { class: 'okchip' }, `✓ Attached${draft.incident ? `, incident ${draft.incident}` : ''}`)
        : h('span', { class: 'ohint' }, 'optional')),
    h('button', { type: 'button', class: 'drop', onclick: () => chooser.click() },
      h('b', null, 'Attach a photo, Word, PDF or Excel file'),
      h('span', null, 'tap here, or drop the files on this box (several at a time). The data is read and the form is filled.')),
    chooser, box,
    h('div', { class: 'opaste-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => takeUnusualText(draft, draft._paste || '', redraw) }, 'Read the pasted text'),
      draft.official && h('button', {
        type: 'button', class: 'link danger',
        onclick: () => { draft.official = ''; draft.incident = ''; redraw(); },
      }, 'Remove the attached report')));
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('over'); });
  panel.addEventListener('dragleave', () => panel.classList.remove('over'));
  panel.addEventListener('drop', (e) => {
    e.preventDefault();
    panel.classList.remove('over');
    takeUnusualFiles(draft, e.dataTransfer.files, redraw);
  });
  return panel;
}

/**
 * The form for one unusual report, used both for a fresh report (the draft
 * lives in ui, so a redraw while typing loses nothing) and for editing.
 */
function unusualForm(draft, { submit, onSubmit, onCancel, redraw }) {
  const field = (label, key, opts = {}) => {
    const el = opts.area
      ? h('textarea', { rows: opts.rows || 6, value: draft[key], placeholder: opts.placeholder || '' })
      : h('input', {
        type: opts.type || 'text', value: draft[key], placeholder: opts.placeholder || '',
        autocapitalize: opts.type ? null : 'characters', autocomplete: 'off',
      });
    el.classList.add('u-input');
    el.setAttribute('data-ukey', key);
    if (opts.list) el.setAttribute('list', opts.list);
    el.addEventListener('input', (e) => { draft[key] = e.target.value; if (opts.after) opts.after(); });
    return h('label', { class: `field ${opts.wide ? 'wide' : ''}` }, h('span', null, label), el);
  };
  // From and To are only for working out the detention: it is filled in as
  // they are typed, and only the detention is shown or shared.
  let formEl = null;
  const worked = () => {
    const d = L.detentionBetween(draft.detFrom, draft.detTo);
    if (!d) return;
    draft.det = d;
    const box = formEl && formEl.querySelector('.u-input[data-ukey="det"]');
    if (box) box.value = d;
  };
  const titles = [...new Set([...UNUSUAL_TITLES, ...mine().map((u) => u.title).filter(Boolean)])];
  const locos = [...new Set(state.locos.map((l) => l.locoNo).filter(Boolean))];
  formEl = h('form', {
    class: 'u-form',
    // Pasting a whole report anywhere in the form is picked up and fills the boxes.
    onpaste: (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/DETENTION\s+PARTICULARS|ASSET\s+FAILURE|FIRST\s+INFORMATION\s+REPORT|BRIEF\s+HISTORY|Failure Report|Incident ID/i.test(text)) return;
      e.preventDefault();
      takeUnusualText(draft, text, redraw);
    },
    onsubmit: (e) => {
      e.preventDefault();
      if (!draft.day) { toast('Pick the date'); return; }
      if (!draft.title.trim()) { toast('Enter the type of unusual (the heading)'); return; }
      onSubmit();
    },
  },
  officialPaste(draft, redraw),
  h('div', { class: 'grid' },
    field('Date', 'day', { type: 'date' }),
    field('Time', 'time', { type: 'time' }),
    field('Type of unusual (heading)', 'title', { wide: true, list: 'u-titles', placeholder: 'LOCO TROUBLE-DPWCS' }),
    field('Location', 'location', { placeholder: 'PRLI-GTU' }),
    field('Train no', 'trainNo', { placeholder: 'KSNK/BOXNL' }),
    field('Loco no', 'locoNo', { wide: true, list: 'u-locos', placeholder: '27592+27767/KZJ/DUE-11/11' }),
    field('Load (if any)', 'load', { wide: true, placeholder: '59/59/4882T' }),
    field('Detention from (not shown)', 'detFrom', { type: 'time', after: worked }),
    field('Detention to (not shown)', 'detTo', { type: 'time', after: worked }),
    field('DET (detention, worked out from From and To)', 'det', { wide: true, placeholder: '06:39 HRS' }),
    field('Reason (what happened)', 'reason', { area: true, wide: true, rows: 7, placeholder: 'Times, km, what was done, relief loco, crew...' })),
  h('datalist', { id: 'u-titles' }, titles.map((t) => h('option', { value: t }))),
  h('datalist', { id: 'u-locos' }, locos.map((t) => h('option', { value: t }))),
  h('div', { class: 'editor-actions' },
    h('button', { type: 'submit', class: 'btn primary' }, submit),
    onCancel && h('button', { type: 'button', class: 'btn', onclick: onCancel }, 'Cancel')));
  return formEl;
}

function openUnusualEditor(u) {
  const dlg = document.getElementById('editor');
  const draft = { ...u };
  const build = () => dlg.replaceChildren(h('div', { class: 'editor' },
    h('h2', null, `Edit unusual report, ${L.fmtDay(u.day)}`),
    unusualForm(draft, {
      submit: 'Save',
      redraw: build,
      onSubmit: () => {
        dlg.close();
        dispatch({ type: 'saveUnusual', unusual: { ...draft, app: 'dpwcs' }, now: new Date().toISOString() });
        toast('Saved');
      },
      onCancel: () => dlg.close(),
    })));
  build();
  dlg.showModal();
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

function unusualCard(u) {
  const run = (fn) => async () => {
    try { await fn(); } catch (e) { console.error(e); toast('Something went wrong. Please try again.'); }
  };
  const [y, m, d] = u.day.split('-');
  const chip = (label, value) => value && h('span', { class: 'chip' }, h('small', null, label), value);
  return h('article', { class: `ucard k-${unusualKind(u)}` },
    h('div', { class: 'ucard-top' },
      h('div', { class: 'udate' }, h('b', null, d), h('span', null, `${MONTHS[Number(m) - 1]} ${y}`), u.time && h('em', null, u.time)),
      h('div', { class: 'utitle' },
        h('strong', null, u.title || '(no heading)'),
        h('div', { class: 'chips' }, chip('LOCATION', u.location), chip('TRAIN', u.trainNo), chip('LOCO', u.locoNo), chip('LOAD', u.load))),
      u.det && h('span', { class: 'det' }, h('small', null, 'DET'), u.det)),
    u.reason && h('p', { class: 'ucard-reason' }, u.reason),
    u.rep && h('p', { class: 'ucard-rep' }, h('b', null, 'REP '), u.rep),
    (u.official || u.incident) && officialDetails(u),
    h('div', { class: 'ucard-actions' },
      h('button', { class: 'link', onclick: () => openUnusualEditor(u) }, u.official ? 'Edit' : 'Edit / paste official'),
      h('button', { class: 'link', onclick: run(async () => {
        const blob = await canvasToBlob(sheetToCanvas(unusualSheet([u])));
        await shareOrDownload(blob, `Unusal-${L.fmtDay(u.day)}-${(u.trainNo || 'report').replace(/[^0-9A-Za-z]+/g, '-')}.png`, `UNUSALS-DATE-${L.fmtDay(u.day)}`);
      }) }, 'Share image'),
      h('button', { class: 'link', onclick: run(() => copyText(L.unusualText([u]))) }, 'Copy as text'),
      h('button', {
        class: 'link danger',
        onclick: () => {
          if (!confirm(`Delete the unusual report of ${L.fmtDay(u.day)} (${u.title || 'no heading'})?`)) return;
          dispatch({ type: 'removeUnusual', id: u.id });
          toast('Deleted');
        },
      }, 'Delete')));
}

function viewUnusuals() {
  if (!ui.uDraft) ui.uDraft = { ...L.blankUnusual(today()), time: L.fmtTime(new Date()) };
  const months = [...new Set(mine().map((u) => u.day.slice(0, 7)))].sort().reverse();
  if (ui.uMonth !== 'all' && !months.includes(ui.uMonth)) ui.uMonth = 'all';

  const buildList = () => {
    const q = ui.uSearch.trim().toLowerCase();
    const visible = mine().filter((u) =>
      (ui.uMonth === 'all' || u.day.startsWith(ui.uMonth)) &&
      (!q || [u.title, u.location, u.trainNo, u.locoNo, u.reason, u.rep, u.load, u.incident, u.official, L.fmtDay(u.day)].some((v) => (v || '').toLowerCase().includes(q))));
    if (!visible.length) {
      return [h('p', { class: 'empty' }, mine().length ? 'No unusual report matches.' : 'No DPWCS loco failures yet. Write the first one above.')];
    }
    const sheet = unusualSheet(visible, 'Unusals');
    const base = `DPWCS-loco-failures-${ui.uMonth === 'all' ? 'all' : monthLabel(ui.uMonth).replace(' ', '-')}`;
    return [
      h('p', { class: 'hint u-screen' }, `${visible.length} report${visible.length === 1 ? '' : 's'}. Share them all as one sheet, oldest first, numbered 1, 2, 3...`),
      exportBar(sheet, base, `DPWCS LOCO FAILURES ${ui.uMonth === 'all' ? '' : monthLabel(ui.uMonth)}`.trim(), () => L.unusualText(visible)),
      h('div', { class: 'u-screen' }, L.unusualsByDay(visible).map(([day, items]) => h('section', null,
        h('h2', { class: 'section-title' }, L.fmtDay(day), h('span', { class: 'count' }, items.length)),
        h('div', { class: 'ucards' }, items.map(unusualCard))))),
      h('div', { class: 'sheet-wrap print-only', id: 'printable' }, sheetTable(sheet)),
    ];
  };

  const search = h('input', {
    type: 'search', class: 'search', placeholder: 'Search train, loco, location or reason', value: ui.uSearch,
    oninput: (e) => { ui.uSearch = e.target.value; document.getElementById('ulist').replaceChildren(...buildList()); },
  });
  const month = h('select', {
    'aria-label': 'Month',
    onchange: (e) => { ui.uMonth = e.target.value; document.getElementById('ulist').replaceChildren(...buildList()); },
  }, h('option', { value: 'all', selected: ui.uMonth === 'all' }, 'All months'),
  months.map((m) => h('option', { value: m, selected: m === ui.uMonth }, monthLabel(m))));

  return h('div', null,
    SHARED && status.unusualsMissing && h('p', { class: 'notice' },
      'Unusual reports are being kept on this device only for now. To share them with everyone, the shared database needs one extra table: run supabase/setup-unusuals.sql once (steps are in the README). Nothing is lost meanwhile.'),
    h('section', { class: 'panel u-new u-screen' },
      h('h2', null, h('span', { class: 'plus' }, '+'), 'Write a new DPWCS loco failure'),
      unusualForm(ui.uDraft, {
        submit: 'Save report',
        onSubmit: () => {
          const unusual = ui.uDraft;
          ui.uDraft = null;
          dispatch({ type: 'saveUnusual', unusual: { ...unusual, app: 'dpwcs' }, now: new Date().toISOString() });
          toast('Unusual report saved');
        },
        onCancel: null,
        redraw: render,
      }),
      h('button', { type: 'button', class: 'link', onclick: () => { ui.uDraft = null; render(); } }, 'Clear the form')),
    h('h2', { class: 'section-title u-screen' }, 'DPWCS loco failures', h('span', { class: 'count' }, mine().length)),
    h('div', { class: 'toolbar wrap u-screen' }, search, month),
    h('div', { id: 'ulist' }, buildList()));
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
        !isInstalled() && h('button', { class: 'install', onclick: installApp }, 'Install app')),
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
      onclick: () => { ui.view = id; render(); window.scrollTo(0, 0); },
    }, text))),
    h('main', null, VIEWS[ui.view]()));
  redrawing = false;
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

function onSyncStatus(next) {
  const screenChanged = (next.phase === 'signed-out') !== (status.phase === 'signed-out') || next.email !== status.email;
  status = next;
  if (status.phase === 'synced') { importOldRecords(); importOldUnusuals(); }
  if (screenChanged) { render(); return; }
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
      setState: (next, redraw) => { state = next; persist(); if (redraw) render(); },
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
