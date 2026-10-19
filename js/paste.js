// Pasting a block of cells copied from Excel into the loco table. The block can be:
//   - with a heading row (S NO, LOCO NO, DUE DATE, TR.NO, CURRENT LOCATION, WORKING...): by those names
//   - rows that carry the loco number (as in the report sheet): matched to the loco by its number
//   - plain columns: laid down from the box that was clicked, one row per loco
// Pure functions, no DOM.

import { locoKey } from './historyimport.js';

/** Excel's copied text: tabs between cells, lines between rows, "quotes" around a cell that has a line break. */
export function parseTsv(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows.map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()));
}

const HEADINGS = new Map([
  ['loco no', 'locoNo'], ['dpwcs loco no', 'locoNo'], ['loco number', 'locoNo'], ['loco', 'locoNo'],
  ['tr no', 'trainNo'], ['train no', 'trainNo'], ['tr', 'trainNo'], ['train', 'trainNo'],
  ['current location', 'location'], ['location', 'location'], ['loc', 'location'],
  ['remarks', 'remarks'], ['remark', 'remarks'],
  ['h/o train to other div', 'hoTrain'], ['h/o train', 'hoTrain'], ['h/o point', 'hoPoint'], ['h/o time', 'hoTime'], ['h/o- time', 'hoTime'],
]);
const headingKey = (cell) => HEADINGS.get(String(cell || '').toLowerCase().replace(/[.:]/g, ' ').replace(/\s+/g, ' ').trim()) || '';

// After the loco number, the report sheet runs: train, location, then REMARKS for an SC loco,
// or H/O train, H/O point, H/O time and REMARKS for one in another division.
const AFTER_LOCO = {
  SC: ['trainNo', 'location', 'remarks'],
  OTHER: ['trainNo', 'location', 'hoTrain', 'hoPoint', 'hoTime', 'remarks'],
};

const KEYED = (locos) => {
  const m = new Map();
  for (const l of locos) { const k = locoKey(l.locoNo); if (k && !m.has(k)) m.set(k, l); }
  return m;
};

/**
 * Where each pasted cell goes.
 *  locos: all the locos ({ id, locoNo, division }); order: ids of the locos in the order shown;
 *  start: { id, field } of the box that was clicked, or null; text: the pasted text.
 * Returns { mode, edits: Map(id -> { field: value }), cells, unmatched, outside } or null for nothing to paste.
 */
export function planPaste({ locos, order, start, text, fields = ['trainNo', 'location'] }) {
  const rows = parseTsv(text);
  if (!rows.length) return null;
  const byKey = KEYED(locos);
  const edits = new Map();
  let cells = 0;
  let unmatched = 0;
  let outside = 0;
  const put = (id, field, value) => {
    if (!edits.has(id)) edits.set(id, {});
    edits.get(id)[field] = value;
    cells++;
  };
  const findLoco = (r, col) => {
    const cells2 = col === undefined ? r : [r[col]];
    for (const c of cells2) { const k = locoKey(c || ''); if (k && byKey.has(k)) return byKey.get(k); }
    return null;
  };

  // 1. heading rows name the columns. The whole report sheet can be pasted: title rows are
  // skipped and each section (other divisions, SC division) is read by its own headings.
  const isHead = (r) => { const hs = r.map(headingKey); return hs.filter(Boolean).length >= 2 && hs.includes('locoNo') ? hs : null; };
  if (rows.some(isHead)) {
    let heads = null;
    for (const r of rows) {
      const hs = isHead(r);
      if (hs) { heads = hs; continue; }
      if (!heads) continue;
      const loco = findLoco(r, heads.indexOf('locoNo'));
      if (!loco) { if (r.filter(Boolean).length >= 3) unmatched++; continue; }
      heads.forEach((f, j) => { if (f && f !== 'locoNo' && j < r.length) put(loco.id, f, r[j]); });
    }
    return { mode: 'headings', edits, cells, unmatched, outside };
  }

  // 2. the rows carry the loco number
  const width = Math.max(...rows.map((r) => r.length));
  let locoCol = -1;
  let best = 0;
  for (let c = 0; c < width; c++) {
    const hits = rows.filter((r) => findLoco(r, c)).length;
    if (hits > best) { best = hits; locoCol = c; }
  }
  const filled = rows.filter((r) => r.some(Boolean)).length;
  if (locoCol >= 0 && best >= Math.max(1, Math.ceil(filled / 2)) && (width > 1)) {
    for (const r of rows) {
      const loco = findLoco(r, locoCol);
      if (!loco) { if (r.some(Boolean)) unmatched++; continue; }
      const names = AFTER_LOCO[loco.division === 'OTHER' ? 'OTHER' : 'SC'];
      names.forEach((f, j) => { const at = locoCol + 1 + j; if (at < r.length) put(loco.id, f, r[at]); });
    }
    return { mode: 'loco', edits, cells, unmatched, outside };
  }

  // 3. plain columns, from the clicked box downward
  if (!start) return { mode: 'none', edits, cells: 0, unmatched: 0, outside: 0 };
  const row0 = order.indexOf(start.id);
  const col0 = fields.indexOf(start.field);
  rows.forEach((r, i) => {
    const id = order[row0 + i];
    if (!id) { outside++; return; }
    r.forEach((value, j) => { const f = fields[col0 + j]; if (f) put(id, f, value); });
  });
  return { mode: 'position', edits, cells, unmatched, outside };
}
