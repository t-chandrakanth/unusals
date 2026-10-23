import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POINTS, parsePoints, parsePaste, grouped, deviationsMessage, deviationsWhatsApp, deviationsSheet } from '../js/deviations.js';

const ROWS = [
  { point: 'BPQ', train: 'BCN', remark: 'FOR ACCEPTANCE MAGH ARR 14:29 22-10' },
  { point: 'BPQ', train: 'BJ51', remark: 'FOR ACCEPTANCE MAGH ARR 19:27 22-10' },
  { point: 'GTL', train: 'MYA', remark: 'FOR ACCEPTANCE RC Arr 22:03 22-10' },
];

test('the message: FROM, TO, the heading with the date, each point numbered, NIL where there is none, the closing line', () => {
  const m = deviationsMessage({ date: '2026-10-22', rows: ROWS });
  assert.match(m, /^FROM\nSR\.DOM\/SC,\n\nTO\nCFTM\/SCR\n\nINTERCHANGE DEVIATIONS \(DT : 22-10-2026\)\n\*{42}\n/);
  assert.match(m, /\nBPQ  1  BCN  FOR ACCEPTANCE MAGH ARR 14:29 22-10\n     2  BJ51  FOR ACCEPTANCE MAGH ARR 19:27 22-10\n\nWADI  NIL\n/);
  assert.match(m, /\nGTL  1  MYA  FOR ACCEPTANCE RC Arr 22:03 22-10\n/);
  assert.match(m, /\nPRLI\/NED  NIL\n\nTHIS IS FOR YOUR KIND INFORMATION$/);
  assert.equal((m.match(/NIL/g) || []).length, DEFAULT_POINTS.length - 2);
});

test('for WhatsApp the heading and the points are bold', () => {
  const w = deviationsWhatsApp({ date: '2026-10-22', rows: ROWS });
  assert.match(w, /\n\*INTERCHANGE DEVIATIONS \(DT : 22-10-2026\)\*\n/);
  assert.match(w, /\n\*BPQ\*  1  BCN/);
  assert.match(w, /\n\*HYB\/NZB\*  NIL\n/);
  assert.doesNotMatch(w, /\*FROM\*|\*\s+2  BJ51/);
});

test('rows pasted from Excel: with or without S.NO, a heading row skipped, a blank point taken from the row above, NIL rows left out', () => {
  const rows = parsePaste('IC POINT\tS.NO\tTRAIN NO\tREMARKS\nBPQ\t1\tBCN\tfor acceptance magh arr 14:29 22-10\n\t2\tBJ51\tFOR ACCEPTANCE\nLUR\tNIL\t\nGTL\tMYA\tFOR ACCEPTANCE RC Arr 22:03 22-10');
  assert.deepEqual(rows, [
    { point: 'BPQ', train: 'BCN', remark: 'FOR ACCEPTANCE MAGH ARR 14:29 22-10' },
    { point: 'BPQ', train: 'BJ51', remark: 'FOR ACCEPTANCE' },
    { point: 'GTL', train: 'MYA', remark: 'FOR ACCEPTANCE RC ARR 22:03 22-10' },
  ]);
});

test('the points: the default list, or the ones typed; a point only in the rows is added at the end', () => {
  assert.deepEqual(parsePoints(''), DEFAULT_POINTS);
  assert.deepEqual(parsePoints('bpq\nwadi, BZA\n\nbpq'), ['BPQ', 'WADI', 'BZA']);
  const rows = [{ point: 'KZJ', train: 'X', remark: '' }, { point: 'BPQ', train: ' ', remark: '' }];
  assert.deepEqual(grouped(['BPQ', 'WADI'], rows).map((x) => [x.point, x.rows.length]), [['BPQ', 1], ['WADI', 0], ['KZJ', 1]]);
  // a row still being typed (no train) is left out of the message
  assert.deepEqual(grouped(['BPQ', 'WADI'], rows, true).map((x) => [x.point, x.rows.length]), [['BPQ', 0], ['WADI', 0], ['KZJ', 1]]);
  assert.match(deviationsMessage({ points: ['BPQ'], rows: [{ point: 'BPQ', train: '', remark: '' }] }), /\nBPQ  NIL\n/);
});

test('the picture: a title row, the headings, the point spanning its trains, NIL for an empty point', () => {
  const s = deviationsSheet({ date: '2026-10-22', points: ['BPQ', 'LUR'], rows: ROWS.slice(0, 2) });
  assert.equal(s.rows[0][0].v, 'INTERCHANGE DEVIATIONS (DT : 22-10-2026)');
  assert.deepEqual(s.rows[1].map((c) => c.v), ['IC POINT', 'S.NO', 'TRAIN NO', 'REMARKS']);
  assert.equal(s.rows[2][0].rowSpan, 2);
  assert.equal(s.rows[3][0], null);
  assert.deepEqual(s.rows[4].map((c) => c && c.v), ['LUR', '', 'NIL', '']);
});
