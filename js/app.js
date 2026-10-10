import * as L from './logic.js';
import { loadState, saveState } from './db.js';
import { seedState } from './seed.js';
import { STYLES, reportSheet, historySheet } from './sheet.js';
import { sheetToXlsx } from './xlsx.js';
import { sheetToCanvas, canvasToBlob } from './canvas.js';
import { createSync } from './sync.js';
import { diffOps } from './syncdata.js';
import { importHistory, alreadyImported } from './historyimport.js';
import { SUPABASE_URL, SUPABASE_KEY, REQUIRE_LOGIN } from './config.js';

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
    const { SNAPSHOTS } = await import('./history-data.js');
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

function locoCard(row, since) {
  const l = row.loco;
  // On a wide screen, train number and location can be changed right in the
  // table. A phone hides these two boxes and opens the full form instead.
  const cell = (key, label) => h('input', {
    type: 'text', class: 'col cell-input', value: l[key], placeholder: '-',
    'aria-label': `${label} of ${l.locoNo}`, 'data-id': l.id, 'data-field': key,
    autocapitalize: 'characters', autocomplete: 'off',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => { if (e.key === 'Escape') { e.target.value = l[key]; e.target.blur(); } },
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
    dot);
}

function viewLocos() {
  const buildLists = () => {
    const since = L.roundStart(state.reports);
    const sentToday = state.reports.some((r) => r.at === since);
    const q = ui.search.trim().toLowerCase();
    const rows = L.numbered(state.locos).filter((r) => !q ||
      [r.loco.locoNo, r.loco.trainNo, r.loco.location, r.loco.hoPoint, r.loco.remarks]
        .some((v) => v.toLowerCase().includes(q)));
    const section = (division, title) => {
      const list = rows.filter((r) => r.loco.division === division);
      return h('section', null,
        h('h2', { class: `section-title ${division.toLowerCase()}` }, title, h('span', { class: 'count' }, list.length)),
        list.length > 0 && h('div', { class: 'list-head', 'aria-hidden': 'true' },
          h('span', null, 'Sr. No'), h('span', null, 'Loco No'), h('span', null, 'Train No'), h('span', null, 'Current location'), h('span', null, 'Updated')),
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
    h('p', { class: 'hint wide-only' }, 'Type in the Train No or Current location box to change it. Click a loco number for all its details.'),
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
      showAll && field('Due date', 'dueDate', { placeholder: '15-Oct or FRESH' }),
      showAll && other && field('H/O train to other div', 'hoTrain'),
      showAll && other && field('H/O point', 'hoPoint'),
      showAll && other && field('H/O time', 'hoTime', {
        placeholder: 'DD-MM-YY HH:MM',
        extra: h('button', { type: 'button', class: 'link', onclick: () => { draft.hoTime = L.fmtDateTime(new Date()); build(); } }, 'Use current time'),
      }),
      showAll && !other && field('Working', 'working', { placeholder: 'YES, Shed in, ...' }),
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
        toast('That file is not a Loco Tracker backup');
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
          `loco-tracker-backup-${L.fmtDay(today())}.json`, 'Loco Tracker backup'),
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

const TABS = [['locos', 'Locos'], ['report', 'Report'], ['history', 'History']];
const VIEWS = { locos: viewLocos, report: viewReport, history: viewHistory };

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
      'Click the install icon at the right end of the address bar (a small screen with a down arrow), or open the three-dot menu and choose "Install DPWS Loco Tracker" (in Chrome: Cast, save and share, then Install page as app; in Edge: Apps, then Install this site as an app).',
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
  const header = h('header', { class: 'top' },
    h('div', { class: 'top-inner' },
      h('div', { class: 'top-row' },
        h('h1', null, 'DPWS Loco Tracker'),
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
  redrawing = true;
  document.getElementById('app').replaceChildren(
    header,
    h('nav', { class: 'tabs' }, TABS.map(([id, text]) => h('button', {
      class: ui.view === id ? 'on' : '',
      onclick: () => { ui.view = id; render(); window.scrollTo(0, 0); },
    }, text))),
    h('main', null, VIEWS[ui.view]()));
  redrawing = false;
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
  if (status.phase === 'synced') importOldRecords();
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
  else importOldRecords();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
