// Repercussions of an unusual: the trains held up, as rows of S.NO, TR.NO, ARR, DEP and DET (in min).
// A train that has not departed is held "as on" a time, and its detention is counted up to it.
// They are kept as plain text, a line for each train ("KSNK ARR: 15:30, DEP: 16:00, DET: 30 MINS"),
// so the shared sheet, the WhatsApp text and older reports keep working. Pure functions apart from
// repEditor, which builds the boxes with the app's element builder.

import { gap } from './block.js';

const CLOCK = '(\\d{1,2}[:.]\\d{2})';
const ARR = new RegExp(`\\bARR(?:IVED|IVAL)?\\b[\\s:.\\-]*${CLOCK}`, 'i');
const DEP = new RegExp(`\\bDEP(?:ARTED|ARTURE)?\\b[\\s:.\\-]*${CLOCK}`, 'i');
const DET = /\bDET(?:ENTION)?\b[\s:.\-]*(\d+)/i;
const HEAD = /\b(ARR|DEP|DET|NOT DEPARTED|STILL)/i;

const clock = (t) => String(t || '').trim().replace('.', ':');

/** The text split into one line for each train; numbering ("1." or "1)") is dropped. */
export function repLines(text) {
  const src = String(text || '').replace(/\r/g, '').trim();
  if (!src) return [];
  let parts = src.split('\n').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = src.split(/\s*(?:^|\s)\d{1,2}[.)]\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => p.replace(/^\d{1,2}[.)]\s*/, '').trim()).filter(Boolean);
}

/**
 * "KSNK ARR: 15:30, DEP: 16:00, DET: 30 MINS" -> { tr: 'KSNK', arr: '15:30', dep: '16:00', det: '30' }.
 * A line that says no more is just a train. A detention counted up to the "as on" time is not
 * kept as typed, so it follows the time when that is changed.
 */
export function parseRepLine(line) {
  const arr = ARR.exec(line);
  const dep = DEP.exec(line);
  const det = DET.exec(line);
  const at = line.search(HEAD);
  const tr = (at > 0 ? line.slice(0, at) : at === 0 ? '' : line).replace(/[\s\-–:,]+$/, '').trim();
  return { tr, arr: arr ? clock(arr[1]) : '', dep: dep ? clock(dep[1]) : '', det: det && !/UP TO/i.test(line) ? det[1] : '' };
}

export const parseRep = (text) => repLines(text).map(parseRepLine);

/** The detention of a row: as typed, else arrival to departure, else (not departed) arrival to the "as on" time. */
export function detOf(r, asOn = '') {
  if (String(r.det || '').trim()) return String(r.det).trim();
  const g = String(r.dep || '').trim() ? gap(clock(r.arr), clock(r.dep)) : gap(clock(r.arr), clock(asOn));
  return g === null ? '' : String(g);
}

/** Whether a row is counted up to the "as on" time: arrived, not departed, nothing typed for the detention. */
export const stillOn = (r, asOn) => !!(String(r.arr || '').trim() && !String(r.dep || '').trim() && !String(r.det || '').trim() && clock(asOn));

/** The rows back to text, a line for each; rows with nothing in them are dropped. */
export function formatRep(rows, asOn = '') {
  return rows.map((r) => {
    const tr = String(r.tr || '').trim().toUpperCase();
    const d = detOf(r, asOn);
    const still = stillOn(r, asOn);
    const parts = [
      clock(r.arr) && `ARR: ${clock(r.arr)}`,
      clock(r.dep) && `DEP: ${clock(r.dep)}`,
      still && 'NOT DEPARTED',
      d && `DET: ${d} MINS${still ? ` (UP TO ${clock(asOn)} HRS)` : ''}`,
    ].filter(Boolean);
    return [tr, parts.join(', ')].filter(Boolean).join(' ');
  }).filter(Boolean).join('\n');
}

/**
 * The table: S.NO, TR.NO, ARR, DEP, DET (IN MIN), a row for each train, a button to add a row and the
 * "as on" time for the trains not departed. asOn / onAsOn: that time as saved, and a call for a change.
 */
export function repEditor(h, text, onChange, { min = 3, asOn = '', onAsOn = () => {} } = {}) {
  const rows = parseRep(text);
  while (rows.length < min) rows.push({ tr: '', arr: '', dep: '', det: '' });
  let as = asOn || '';
  const box = h('div', { class: 'repbox' });
  const emit = () => onChange(formatRep(rows, as));
  const gapHint = (r) => {
    const g = gap(clock(r.arr), clock(String(r.dep || '').trim() ? r.dep : as));
    return g === null ? 'minutes' : `${g} (auto)`;
  };
  const hints = [];
  const draw = (focusRow) => {
    hints.length = 0;
    const input = (cls, ph, label, value, onInput) => {
      const el = h('input', { type: 'text', class: cls, placeholder: ph, 'aria-label': label, autocomplete: 'off', autocapitalize: 'characters', value });
      el.addEventListener('input', () => onInput(el.value));
      return el;
    };
    const asOnBox = h('input', { type: 'time', class: 'rpas', 'aria-label': 'As on time for the trains not departed', value: as });
    asOnBox.addEventListener('input', () => { as = asOnBox.value; onAsOn(as); hints.forEach((f) => f()); emit(); });
    box.replaceChildren(
      h('div', { class: 'reprow rephead' }, h('span', null, 'S.NO'), h('span', null, 'TR.NO'), h('span', null, 'ARR'), h('span', null, 'DEP'), h('span', null, 'DET (IN MIN)'), h('span', null)),
      ...rows.map((r, i) => {
        const det = input('rpd', gapHint(r), `Detention in minutes of train ${i + 1}`, r.det, (v) => { r.det = v; emit(); });
        const refreshHint = () => { det.placeholder = gapHint(r); };
        hints.push(refreshHint);
        const tr = input('rpt', 'TRAIN', `Train ${i + 1}`, r.tr, (v) => { r.tr = v; emit(); });
        tr.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          rows.splice(i + 1, 0, { tr: '', arr: '', dep: '', det: '' });
          draw(i + 1);
        });
        return h('div', { class: 'reprow' }, h('b', { class: 'rpn' }, String(i + 1)), tr,
          input('rpa', '15:30', `Arrival of train ${i + 1}`, r.arr, (v) => { r.arr = v; refreshHint(); emit(); }),
          input('rpe', '16:00', `Departure of train ${i + 1}`, r.dep, (v) => { r.dep = v; refreshHint(); emit(); }),
          det,
          h('button', {
            type: 'button', class: 'x', title: 'Remove this row', 'aria-label': `Remove train ${i + 1}`,
            onclick: () => { rows.splice(i, 1); if (!rows.length) rows.push({ tr: '', arr: '', dep: '', det: '' }); emit(); draw(); },
          }, '×'));
      }),
      h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push({ tr: '', arr: '', dep: '', det: '' }); draw(rows.length - 1); } }, '+ Add a train'),
      h('label', { class: 'repas' }, h('span', null, 'As on (trains not departed)'), asOnBox));
    if (focusRow !== undefined) { const el = box.querySelectorAll('.rpt')[focusRow]; if (el) el.focus(); }
  };
  draw();
  return box;
}
