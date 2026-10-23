// The daily interchange deviations message: the trains not handed over as planned at each interchange
// point, with the reason, as the message to CFTM reads. Pure functions, no DOM.

import { parseTsv } from './paste.js';

/** The interchange points, in the order the message has always listed them. */
export const DEFAULT_POINTS = ['BPQ', 'WADI', 'LUR', 'TJSP', 'WADI/RC', 'BZA', 'GNT/VNUP', 'GTL', 'HYB/KSN', 'HYB/MLYG', 'HYB/RC', 'HYB/NZB', 'PRLI/NED'];

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const key = (s) => clean(s).toUpperCase();

/** The points typed one on a line (or with commas); empty -> the default list. */
export function parsePoints(text) {
  const out = [];
  for (const p of String(text || '').split(/[\n,]+/)) {
    const k = key(p);
    if (k && !out.includes(k)) out.push(k);
  }
  return out.length ? out : DEFAULT_POINTS.slice();
}

/**
 * Rows copied from Excel: IC POINT, S.NO, TRAIN NO, REMARKS (S.NO may be missing; a heading row is skipped;
 * a row with no point belongs to the point above it). -> [{ point, train, remark }].
 */
export function parsePaste(text) {
  const rows = [];
  let last = '';
  for (const r of parseTsv(text)) {
    if (!r.some(Boolean)) continue;
    const cells = r.map(clean);
    if (/^(ic\s*point|point|interchange)/i.test(cells[0]) && /train/i.test(cells.join(' '))) continue;
    let [point, a, b, ...rest] = cells;
    // with S.NO: POINT, 1, BCN, remark; without: POINT, BCN, remark
    let train, remark;
    if (/^\d+\.?$/.test(a || '')) { train = b; remark = rest.join(' '); } else { train = a; remark = [b, ...rest].filter(Boolean).join(' '); }
    point = key(point) || last;
    if (!point || !train) continue;
    last = point;
    if (/^nil$/i.test(train)) continue;
    rows.push({ point, train: key(train), remark: clean(remark).toUpperCase() });
  }
  return rows;
}

/**
 * The rows of each point, in the order of the points; a point not in the list is added at the end.
 * A row with no train yet is kept for the grid (it is being typed) and left out of the message with `filled`.
 */
export function grouped(points, rows, filled = false) {
  const all = points.slice();
  for (const r of rows) if (r.point && !all.includes(r.point)) all.push(r.point);
  return all.map((point) => ({ point, rows: rows.filter((r) => r.point === point && (!filled || clean(r.train))) }));
}

const dmy = (iso) => String(iso || '').split('-').reverse().join('-');

/**
 * The message as sent: FROM, TO, the heading with the date, each point with its numbered trains and
 * remarks (NIL where there is none), and the closing line.
 */
export function deviationsMessage({ from = 'SR.DOM/SC', to = 'CFTM/SCR', date = '', points = DEFAULT_POINTS, rows = [] } = {}) {
  const lines = ['FROM', `${clean(from)},`, '', 'TO', clean(to), '', `INTERCHANGE DEVIATIONS (DT : ${dmy(date)})`, '*'.repeat(42), ''];
  for (const g of grouped(points, rows, true)) {
    if (!g.rows.length) { lines.push(`${g.point}  NIL`, ''); continue; }
    g.rows.forEach((r, i) => lines.push(`${i ? ' '.repeat(g.point.length) : g.point}  ${i + 1}  ${clean(r.train)}  ${clean(r.remark)}`.trimEnd()));
    lines.push('');
  }
  lines.push('THIS IS FOR YOUR KIND INFORMATION');
  return lines.join('\n');
}

/** The same for WhatsApp: the points in bold, so they stand out on a phone. */
export function deviationsWhatsApp(opts) {
  return deviationsMessage(opts).replace(/^(INTERCHANGE DEVIATIONS .*)$/m, '*$1*').replace(/^([A-Z][A-Z0-9/ ]*?)  (NIL|\d+)/gm, '*$1*  $2');
}

/** The sheet model for the picture: IC POINT, S.NO, TRAIN NO, REMARKS, the point spanning its rows. */
export function deviationsSheet({ date = '', points = DEFAULT_POINTS, rows = [] } = {}) {
  const cell = (v, s, extra = {}) => ({ v: String(v == null ? '' : v), s, ...extra });
  const out = [
    [cell(`INTERCHANGE DEVIATIONS (DT : ${dmy(date)})`, 'title', { colSpan: 4 }), null, null, null],
    ['IC POINT', 'S.NO', 'TRAIN NO', 'REMARKS'].map((v) => cell(v, 'head')),
  ];
  let band = 0;
  for (const g of grouped(points, rows, true)) {
    const n = Math.max(g.rows.length, 1);
    const s = band++ % 2 ? 'alt' : 'cell';
    const t = s === 'alt' ? 'altText' : 'text';
    for (let i = 0; i < n; i++) {
      const r = g.rows[i];
      out.push([
        i === 0 ? cell(g.point, s, n > 1 ? { rowSpan: n } : {}) : null,
        cell(r ? i + 1 : '', s), cell(r ? r.train : 'NIL', r ? t : s), cell(r ? r.remark : '', t),
      ]);
    }
  }
  return { name: 'Interchange deviations', cols: [11, 5, 14, 52], rows: out };
}
