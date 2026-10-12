import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTsv, planPaste } from '../js/paste.js';

const locos = [
  { id: 'a', locoNo: '44323+42372', division: 'OTHER' },
  { id: 'b', locoNo: '28347+27744', division: 'OTHER' },
  { id: 'c', locoNo: '27609(D)+28411', division: 'SC' },
  { id: 'd', locoNo: '27300+27402', division: 'SC' },
];
const order = ['a', 'b', 'c', 'd'];

test('Excel text is split into rows and cells, with quoted line breaks and quotes kept', () => {
  assert.deepEqual(parseTsv('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseTsv('"two\nlines"\tx\r\ny\tz'), [['two lines', 'x'], ['y', 'z']]);
  assert.deepEqual(parseTsv('"say ""hi"""\tq'), [['say "hi"', 'q']]);
  assert.deepEqual(parseTsv('a\t\t\n\t\t\n'), [['a', '', '']]);
  assert.deepEqual(parseTsv(''), []);
});

test('plain columns land from the clicked box, a row per loco', () => {
  const p = planPaste({ locos, order, start: { id: 'b', field: 'location' }, text: 'JSME/ASN/ER\tYES\nX/Y/Z\tSHED\n' });
  assert.equal(p.mode, 'position');
  assert.deepEqual([...p.edits], [['b', { location: 'JSME/ASN/ER', working: 'YES' }], ['c', { location: 'X/Y/Z', working: 'SHED' }]]);
  assert.equal(p.cells, 4);
  const over = planPaste({ locos, order, start: { id: 'd', field: 'trainNo' }, text: 'A\nB\nC' });
  assert.equal(over.outside, 2);
  assert.deepEqual(over.edits.get('d'), { trainNo: 'A' });
});

test('rows from the report sheet are matched by the loco number, whichever box was clicked', () => {
  const text = [
    '1\t44323+42372\t15-10\tCBKB C/S\tSMPN/WDFC/DFCR\tCDG\tWADI\t13:05 31-07\tFOIS note',
    '8\t27609(D)+28411\t09-09\tTMU\tSUH\tYES/MU\t',
    '9\t27300+27402\t15-08\tYTPV/BOBRL\tBKL\tYES/MU\tFOR RUSG-KTPG SECTOR',
    '99\t11111+22222\t01-01\tZZ\tNOWHERE\tYES',
  ].join('\n');
  const p = planPaste({ locos, order, start: { id: 'b', field: 'trainNo' }, text });
  assert.equal(p.mode, 'loco');
  assert.equal(p.unmatched, 1);
  assert.deepEqual(p.edits.get('a'), { dueDate: '15-10', trainNo: 'CBKB C/S', location: 'SMPN/WDFC/DFCR', hoTrain: 'CDG', hoPoint: 'WADI', hoTime: '13:05 31-07', remarks: 'FOIS note' });
  assert.deepEqual(p.edits.get('c'), { dueDate: '09-09', trainNo: 'TMU', location: 'SUH', working: 'YES/MU', remarks: '' });
  assert.deepEqual(p.edits.get('d'), { dueDate: '15-08', trainNo: 'YTPV/BOBRL', location: 'BKL', working: 'YES/MU', remarks: 'FOR RUSG-KTPG SECTOR' });
  assert.equal(p.edits.has('b'), false, 'a loco that was not in the block is left alone');
});

test('a heading row names the columns, in any order', () => {
  const text = 'DPWCS LOCO NO\tWORKING\tCURRENT LOCATION\tTR.NO\n28347+27744\tNOT WORKING\tJSME/ASN/ER\tTMU\n27300+27402\tYES\tBKL\t';
  const p = planPaste({ locos, order, start: null, text });
  assert.equal(p.mode, 'headings');
  assert.deepEqual(p.edits.get('b'), { working: 'NOT WORKING', location: 'JSME/ASN/ER', trainNo: 'TMU' });
  assert.deepEqual(p.edits.get('d'), { working: 'YES', location: 'BKL', trainNo: '' });
});

test('loco numbers are matched however they are written', () => {
  const p = planPaste({ locos, order, start: null, text: '28411 + 27609\tx\tY\tZ\tYES\n' });
  assert.equal(p.mode, 'loco');
  assert.equal(p.edits.get('c').working, 'YES');
});

test('with no box clicked and no loco numbers there is nothing to do', () => {
  const p = planPaste({ locos, order, start: null, text: 'a\tb\nc\td' });
  assert.equal(p.mode, 'none');
  assert.equal(p.cells, 0);
});
