// A small "sheet" model shared by the on-screen table, the PNG image and the
// Excel file, so all three always show the same thing.
//
// sheet = { name, cols: [width in characters], rows: [[cell | null, ...]] }
// cell  = { v: text, s: style name, colSpan?, rowSpan? }
// null  = a position covered by a merged cell above or to the left.

import { numbered, reportTitles, historyTitle, fmtDay, unusualsInOrder } from './logic.js';

export const STYLES = {
  title:    { bg: '#FFFF00', color: '#000000', align: 'center' },
  titleRed: { bg: '#FFFF00', color: '#FF0000', align: 'center' },
  head:     { bg: '#E6A19C', color: '#3A3A3A', align: 'center' },
  serial:   { bg: '#FFFF00', color: '#000000', align: 'center' },
  cell:     { bg: '#FFFFFF', color: '#000000', align: 'center' },
  text:     { bg: '#FFFFFF', color: '#000000', align: 'left' },
  muted:    { bg: '#F3F3F3', color: '#555555', align: 'center' },
  gap:      { bg: null, color: '#000000', align: 'center', noBorder: true },
  // Unusual reports: red date above, yellow bands for the heading and DET.
  dateTitle: { bg: '#FFFFFF', color: '#FF0000', align: 'center' },
  band:      { bg: '#FFFF00', color: '#FF0000', align: 'center' },
  label:     { bg: '#FFFFFF', color: '#000000', align: 'left' },
};

const c = (v, s = 'cell', extra = {}) => ({ v: v == null ? '' : String(v), s, ...extra });
const spanRow = (cell, n) => [cell, ...Array(n - 1).fill(null)];

export function reportSheet(locos, day) {
  const t = reportTitles(day);
  const rows = [];
  const all = numbered(locos);
  const serialCell = (r) => (r.span ? c(r.serial, 'serial', r.span > 1 ? { rowSpan: r.span } : {}) : null);

  rows.push(spanRow(c(t.other, 'title', { colSpan: 9 }), 9));
  rows.push(['S NO', 'DPWCS LOCO NO', 'DUE DATE', 'TR.NO', 'CURRENT LOCATION',
    'H/O TRAIN TO OTHER DIV', 'H/O POINT', 'H/O- TIME', 'REMARKS'].map((v) => c(v, 'head')));
  const other = all.filter((r) => r.loco.division === 'OTHER');
  for (const r of other) {
    const l = r.loco;
    rows.push([serialCell(r), c(l.locoNo), c(l.dueDate), c(l.trainNo), c(l.location),
      c(l.hoTrain), c(l.hoPoint), c(l.hoTime), c(l.remarks, 'text')]);
  }
  if (!other.length) rows.push(spanRow(c('NIL', 'cell', { colSpan: 9 }), 9));

  rows.push(spanRow(c('', 'gap', { colSpan: 9 }), 9));

  rows.push(spanRow(c(t.sc, 'titleRed', { colSpan: 9 }), 9));
  rows.push([...['S NO', 'DPWCS LOCO NO', 'DUE DATE', 'TR.NO', 'CURRENT LOCATION', 'WORKING']
    .map((v) => c(v, 'head')), c('REMARKS', 'head', { colSpan: 3 }), null, null]);
  const sc = all.filter((r) => r.loco.division === 'SC');
  for (const r of sc) {
    const l = r.loco;
    rows.push([serialCell(r), c(l.locoNo), c(l.dueDate), c(l.trainNo), c(l.location),
      c(l.working), c(l.remarks, 'cell', { colSpan: 3 }), null, null]);
  }
  if (!sc.length) rows.push(spanRow(c('NIL', 'cell', { colSpan: 9 }), 9));

  return { name: `Locos ${fmtDay(day)}`, cols: [6, 20, 12, 16, 20, 16, 12, 16, 40], rows };
}

export function historySheet(label, summary, fromKey, toKey) {
  // The "updated by" column only appears when the data is shared between people.
  const withBy = summary.some((r) => r.by);
  const head = ['DATE', 'TIME', 'TR.NO', 'CURRENT LOCATION', 'DIVISION',
    'H/O TRAIN', 'H/O POINT', 'H/O- TIME', 'WORKING', 'REMARKS'];
  const cols = [13, 11, 16, 20, 12, 14, 12, 16, 12, 40];
  if (withBy) { head.push('UPDATED BY'); cols.push(16); }
  const rows = [
    spanRow(c(historyTitle(label, fromKey, toKey), 'title', { colSpan: head.length }), head.length),
    head.map((v) => c(v, 'head')),
  ];
  for (const r of summary) {
    const d = r.data;
    const s = r.carried ? 'muted' : 'cell';
    const row = [
      c(fmtDay(r.day), 'serial'),
      c(r.carried ? 'no change' : r.time, s),
      c(d.trainNo, s), c(d.location, s),
      c(d.division === 'OTHER' ? 'OTHER DIV' : 'SC DIV', s),
      c(d.hoTrain, s), c(d.hoPoint, s), c(d.hoTime, s), c(d.working, s),
      c(r.kind === 'removed' ? 'REMOVED FROM LIST' : d.remarks, r.carried ? 'muted' : 'text'),
    ];
    if (withBy) row.push(c(r.by, s));
    rows.push(row);
  }
  if (!summary.length) {
    rows.push(spanRow(c('No records in this period', 'cell', { colSpan: head.length }), head.length));
  }
  return { name: 'Summary', cols, rows };
}

/**
 * Unusual reports in the daily-sheet layout: one block per report with a red
 * "UNUSALS-DATE-..." line above it and a running serial number, oldest first.
 */
export function unusualSheet(list, name = 'Unusuals') {
  const rows = [];
  unusualsInOrder(list).forEach((u, i) => {
    if (i) rows.push(spanRow(c('', 'gap', { colSpan: 3 }), 3));
    const fields = [
      ['TRAIN DETAILS', u.title, 'band', 'band'],
      ['LOCATION', u.location, 'label', 'cell'],
      ['TRAIN NO', u.trainNo, 'label', 'cell'],
      ['LOCO NO', u.locoNo, 'label', 'cell'],
      u.load && ['LOAD', u.load, 'label', 'cell'],
      ['REASON', u.reason, 'label', 'text'],
      ['DET', u.det, 'band', 'band'],
      u.rep && ['REP', u.rep, 'label', 'cell'],
    ].filter(Boolean);
    rows.push(spanRow(c(`UNUSALS-DATE-${fmtDay(u.day)}${u.time ? ` ${u.time}` : ''}`, 'dateTitle', { colSpan: 3 }), 3));
    fields.forEach(([label, value, ls, vs], j) => {
      rows.push([j === 0 ? c(i + 1, 'serial', { rowSpan: fields.length }) : null, c(label, ls), c(value, vs)]);
    });
  });
  if (!rows.length) rows.push(spanRow(c('No unusual reports', 'cell', { colSpan: 3 }), 3));
  return { name, cols: [6, 18, 72], rows };
}
