import * as L from './logic.js';
import { loadState, saveState } from './db.js';
import { seedState } from './seed.js';
import { STYLES, reportSheet, historySheet } from './sheet.js';
import { sheetToXlsx } from './xlsx.js';
import { sheetToCanvas, canvasToBlob } from './canvas.js';
import { createSync } from './sync.js';
import { diffOps } from './syncdata.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const today = () => L.dayKey(new Date());

// With a database configured the data is shared and everyone signs in.
// Without one the app keeps its data on this device only.
const SHARED = !!(SUPABASE_URL && SUPABASE_KEY);
const NO_SYNC = { outbox: [], cursor: {}, linked: false };
let sync = null;
let status = { phase: SHARED ? 'signed-out' : 'local', pending: 0, email: '', error: '' };

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

function dispatch(action) {
  const next = L.reduce(state, { ...action, by: who() });
  if (next !== state) {
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

function locoCard(row) {
  const l = row.loco;
  return h('button', { class: 'card', onclick: () => openEditor(l) },
    h('span', { class: 'serial' }, row.span === 0 ? '' : String(row.serial)),
    h('strong', { class: 'loco-no' }, l.locoNo || '(no number)'));
}

function viewLocos() {
  const buildLists = () => {
    const q = ui.search.trim().toLowerCase();
    const rows = L.numbered(state.locos).filter((r) => !q ||
      [r.loco.locoNo, r.loco.trainNo, r.loco.location, r.loco.hoPoint, r.loco.remarks]
        .some((v) => v.toLowerCase().includes(q)));
    const section = (division, title) => {
      const list = rows.filter((r) => r.loco.division === division);
      return h('section', null,
        h('h2', { class: `section-title ${division.toLowerCase()}` }, title, h('span', { class: 'count' }, list.length)),
        list.length ? list.map(locoCard) : h('p', { class: 'empty' }, q ? 'No match.' : 'No locos here.'));
    };
    return [section('OTHER', 'In other divisions'), section('SC', 'In SC division')];
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
    h('p', { class: 'hint' }, 'Tap a loco number to see and update its details.'),
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

  const build = () => {
    const other = draft.division === 'OTHER';
    const seg = (value, text) => h('button', {
      type: 'button', class: `seg ${draft.division === value ? 'on' : ''}`,
      onclick: () => { draft.division = value; build(); },
    }, text);
    const canShare = !isNew || state.locos.some((l) => l.division === draft.division);
    dlg.replaceChildren(h('form', {
      method: 'dialog', class: 'editor',
      onsubmit: (e) => {
        e.preventDefault();
        if (!draft.locoNo.trim()) { toast('Enter the loco number'); return; }
        dlg.close();
        dispatch({ type: 'save', loco: draft, now: new Date().toISOString() });
        toast(isNew ? 'Loco added' : 'Saved');
      },
    },
    h('h2', null, isNew ? 'Add loco' : `Update ${loco.locoNo}`),
    h('div', { class: 'segs' }, seg('SC', 'SC division'), seg('OTHER', 'Other division')),
    h('div', { class: 'grid' },
      field('Loco no', 'locoNo', { placeholder: '27609+28411' }),
      field('Due date', 'dueDate', { placeholder: '15-Oct or FRESH' }),
      field('Train no', 'trainNo'),
      field('Current location', 'location'),
      other && field('H/O train to other div', 'hoTrain'),
      other && field('H/O point', 'hoPoint'),
      other && field('H/O time', 'hoTime', {
        placeholder: 'DD-MM-YY HH:MM',
        extra: h('button', { type: 'button', class: 'link', onclick: () => { draft.hoTime = L.fmtDateTime(new Date()); build(); } }, 'Use current time'),
      }),
      !other && field('Working', 'working', { placeholder: 'YES, Shed in, ...' }),
      field('Remarks', 'remarks', {
        area: true, wide: true,
        extra: other && h('button', { type: 'button', class: 'link', onclick: () => { draft.remarks = L.foisRemark(today()); build(); } }, 'Fill FOIS message remark for today'),
      })),
    canShare && h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !!draft.sameSerial, onchange: (e) => { draft.sameSerial = e.target.checked; } }),
      'Same S.No as the loco above (split consist)'),
    h('div', { class: 'editor-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, 'Save'),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel')),
    !isNew && h('div', { class: 'editor-more' },
      h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); dispatch({ type: 'move', id: loco.id, dir: -1 }); } }, 'Move up'),
      h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); dispatch({ type: 'move', id: loco.id, dir: 1 }); } }, 'Move down'),
      h('button', { type: 'button', class: 'link', onclick: () => { dlg.close(); ui.view = 'history'; ui.histLoco = loco.id; render(); } }, 'History'),
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

function viewHistory() {
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

function viewMore() {
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
  const backupButton = h('button', {
    class: 'btn primary',
    onclick: () => shareOrDownload(
      new Blob([JSON.stringify({ version: 1, locos: state.locos, log: state.log, reports: state.reports })], { type: 'application/json' }),
      `loco-tracker-backup-${L.fmtDay(today())}.json`, 'Loco Tracker backup'),
  }, 'Download backup');
  const counts = `${state.locos.length} locos, ${state.log.length} saved updates, ${state.reports.length} saved reports.`;

  if (SHARED) {
    return h('div', { class: 'more' },
      h('section', { class: 'panel' },
        h('h2', null, 'Shared database'),
        h('p', null, `Signed in as ${status.email}. ${statusText()}.`),
        h('p', null, `Everyone who signs in sees and updates the same data. ${counts}`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', onclick: () => sync.syncNow().then(() => toast(statusText())) }, 'Sync now'),
          h('button', {
            class: 'btn',
            onclick: () => {
              if (status.pending && !confirm(`${status.pending} changes have not been uploaded yet. Sign out anyway? They will upload after the next sign-in on this device.`)) return;
              sync.signOut();
            },
          }, 'Sign out'))),
      h('section', { class: 'panel' },
        h('h2', null, 'Backup'),
        h('p', null, 'The database is the main copy. You can still download a copy of everything to keep as a file.'),
        h('div', { class: 'actions' }, backupButton)),
      h('section', { class: 'panel' },
        h('h2', null, 'Install on your phone'),
        h('p', null, 'Open this page in Chrome, tap the three-dot menu, then "Add to Home screen". It then opens like an app. Without internet you can still view and update; changes upload when the connection is back.')));
  }

  return h('div', { class: 'more' },
    h('section', { class: 'panel' },
      h('h2', null, 'Backup and move between devices'),
      h('p', null, 'Your data is stored on this device only. To carry it from the phone to a computer (or keep a safe copy), download a backup here and restore it on the other device.'),
      h('div', { class: 'actions' }, backupButton,
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore backup'),
        fileInput)),
    h('section', { class: 'panel' },
      h('h2', null, 'Install on your phone'),
      h('p', null, 'Open this page in Chrome, tap the three-dot menu, then "Add to Home screen". It then opens like an app and works without internet.')),
    h('section', { class: 'panel' },
      h('h2', null, 'Start over'),
      h('p', null, `${counts.slice(0, -1)} on this device.`),
      h('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!confirm('Erase everything on this device and load the 08-10-2026 sheet again?')) return;
          state = { ...seedState(), sync: NO_SYNC };
          await saveState(state);
          ui.reportId = null;
          toast('Reset to the 08-10-2026 sheet');
          render();
        },
      }, 'Reset to the 08-10-2026 sheet')));
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

const TABS = [['locos', 'Locos'], ['report', 'Report'], ['history', 'History'], ['more', 'More']];
const VIEWS = { locos: viewLocos, report: viewReport, history: viewHistory, more: viewMore };

function render() {
  const signedOut = SHARED && status.phase === 'signed-out';
  const other = state.locos.filter((l) => l.division === 'OTHER').length;
  const header = h('header', { class: 'top' },
    h('div', { class: 'top-inner' },
      h('h1', null, 'DPWS Loco Tracker'),
      h('p', null, signedOut
        ? L.fmtDay(today())
        : `${L.fmtDay(today())}  |  ${state.locos.length} locos  |  ${other} in other divisions`),
      SHARED && !signedOut && h('p', { class: `sync ${status.phase}`, id: 'sync-status' }, statusText())));
  if (signedOut) {
    document.getElementById('app').replaceChildren(header, h('main', null, viewSignIn()));
    return;
  }
  document.getElementById('app').replaceChildren(
    header,
    h('nav', { class: 'tabs' }, TABS.map(([id, text]) => h('button', {
      class: ui.view === id ? 'on' : '',
      onclick: () => { ui.view = id; render(); window.scrollTo(0, 0); },
    }, text))),
    h('main', null, VIEWS[ui.view]()));
}

function onSyncStatus(next) {
  const screenChanged = (next.phase === 'signed-out') !== (status.phase === 'signed-out');
  status = next;
  if (screenChanged || ui.view === 'more') { render(); return; }
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
      getState: () => state,
      setState: (next, redraw) => { state = next; persist(); if (redraw) render(); },
      onStatus: onSyncStatus,
    });
    status = { ...status, phase: sync.signedIn ? 'syncing' : 'signed-out', email: sync.email };
  }
  render();
  if (sync) sync.start();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start();
