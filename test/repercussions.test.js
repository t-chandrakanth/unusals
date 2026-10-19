import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRep, formatRep, detOf, stillOn } from '../js/repercussions.js';

test('a line is read into train, arrival, departure and detention', () => {
  assert.deepEqual(parseRep('KSNK ARR: 15:30, DEP: 16:00, DET: 30 MINS'), [{ tr: 'KSNK', arr: '15:30', dep: '16:00', det: '30' }]);
  assert.deepEqual(parseRep('1. PSNH - ARR 12:34'), [{ tr: 'PSNH', arr: '12:34', dep: '', det: '' }]);
  assert.deepEqual(parseRep('TNO.12622'), [{ tr: 'TNO.12622', arr: '', dep: '', det: '' }]);
  assert.deepEqual(parseRep(''), []);
  assert.equal(parseRep('1. A ARR 10:00\n2. B ARR 11:00').length, 2);
});

test('the detention is worked out from arrival and departure when not typed, past midnight too', () => {
  assert.equal(detOf({ arr: '15:30', dep: '16:00', det: '' }), '30');
  assert.equal(detOf({ arr: '23:30', dep: '00:15', det: '' }), '45');
  assert.equal(detOf({ arr: '15:30', dep: '16:00', det: '50' }), '50');
  assert.equal(detOf({ arr: '15:30', dep: '', det: '' }), '');
});

test('rows are written back as lines, empty rows dropped', () => {
  const text = formatRep([{ tr: 'ksnk', arr: '15:30', dep: '16:00', det: '' }, { tr: '', arr: '', dep: '', det: '' }, { tr: 'PSNH', arr: '12:34', dep: '', det: '' }]);
  assert.equal(text, 'KSNK ARR: 15:30, DEP: 16:00, DET: 30 MINS\nPSNH ARR: 12:34');
  assert.deepEqual(parseRep(text).map((r) => r.tr), ['KSNK', 'PSNH']);
});

test('a train not departed is counted up to the as-on time, and follows it when it changes', () => {
  const rows = [{ tr: 'PSNH', arr: '12:34', dep: '', det: '' }, { tr: 'KSNK', arr: '11:30', dep: '15:57', det: '' }];
  assert.equal(detOf(rows[0], '17:10'), '276');
  assert.equal(stillOn(rows[0], '17:10'), true);
  assert.equal(stillOn(rows[1], '17:10'), false);
  assert.equal(stillOn(rows[0], ''), false);
  const text = formatRep(rows, '17:10');
  assert.equal(text.split(String.fromCharCode(10))[0], 'PSNH ARR: 12:34, NOT DEPARTED, DET: 276 MINS (UP TO 17:10 HRS)');
  // read back, the counted detention is not kept as typed, so a later as-on time recounts it
  const back = parseRep(text);
  assert.equal(back[0].tr, 'PSNH');
  assert.equal(back[0].det, '');
  assert.equal(detOf(back[0], '18:00'), '326');
  assert.equal(back[1].det, '267');
});
