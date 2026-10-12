import test from 'node:test';
import assert from 'node:assert/strict';
import { toMin, gap, burstMinutes, longMins, blankBlock, blockName, blockTitle, blockStations, computeBlock, blockMessage, stn } from '../js/block.js';

// the example report
const example = () => ({
  ...blankBlock('2026-10-12'), name: 'BCM BLOCK', dir: 'UP', station: 'CT - SUH',
  from: '12:00', to: '14:30', cleared: '15:25', asOn: '17:10',
  rows: [
    { tr: 'KSNK', at: 'CT', from: '11:30', to: '15:57' },
    { tr: 'PSNH', at: 'CT', from: '12:34', to: '' },
    { tr: 'BTPK', at: 'MQR', from: '13:30', to: '15:32' },
    { tr: 'WDSG', at: 'NAW', from: '13:03', to: '15:07' },
    { tr: 'CCCT', at: 'NAW', from: '15:26', to: '' },
    { tr: 'KPCC', at: 'TDU', from: '14:37', to: '' },
    { tr: 'PSNH', at: 'RMY', from: '16:25', to: '' },
  ],
});

test('clock times and gaps, past midnight too', () => {
  assert.equal(toMin('12:30'), 750);
  assert.equal(toMin('25:00'), 1500);
  assert.equal(toMin(''), null);
  assert.equal(gap('12:00', '14:30'), 150);
  assert.equal(gap('23:30', '01:15'), 105);
  assert.equal(gap('', '01:15'), null);
  assert.equal(longMins(150), '150 MINS (02:30 HRS)');
  assert.equal(longMins(55), '55 MINS');
});

test('the burst is the minutes past the permitted time, nothing when cleared in time', () => {
  assert.equal(burstMinutes('14:30', '15:25'), 55);
  assert.equal(burstMinutes('23:30', '00:10'), 40);
  assert.equal(burstMinutes('14:30', '14:00'), 0);
  assert.equal(burstMinutes('14:30', ''), null);
});

test('the numbers of the example report come out as in the message', () => {
  const c = computeBlock(example());
  assert.equal(c.title, 'BCM BLOCK PERMITTED IN UP DIRECTION B/W CT-SUH STATION');
  assert.equal(c.duration, 150);
  assert.equal(c.burst, 55);
  assert.deepEqual(c.rows.map((r) => r.det.mins), [267, 276, 122, 124, 104, 153, 45]);
  assert.deepEqual(c.rows.map((r) => r.det.still), [false, true, false, false, true, true, true]);
});

test('the WhatsApp message is worded like the example', () => {
  const m = blockMessage(example());
  const lines = m.split('\n');
  assert.equal(lines[0], '*SIR,*');
  assert.equal(lines[2], '*BCM BLOCK PERMITTED IN UP DIRECTION B/W CT-SUH STATION*');
  assert.ok(lines.includes('*BLOCK TIME: 12:00 TO 14:30 HRS*'));
  assert.ok(lines.includes('*BLOCK CLEAR: 15:25 HRS*'));
  assert.ok(lines.includes('*BLOCK BURST: 55 MINS*'));
  assert.ok(lines.includes('*REPERCUSSIONS:*'));
  assert.ok(!m.includes('PARTICULARS'));
  assert.ok(lines.includes('1. *KSNK* -CT STN- ARR: 11:30 HRS, DEP: 15:57 HRS, *DET: 267 MINS*'));
  assert.ok(lines.includes('2. *PSNH* -CT STN- ARR: 12:34 HRS, STILL NOT DEPARTED, *DET: 276 MINS (UP TO 17:10 HRS)*'));
  assert.ok(lines.includes('7. *PSNH* -RMY STN- ARR: 16:25 HRS, STILL NOT DEPARTED, *DET: 45 MINS (UP TO 17:10 HRS)*'));
  assert.ok(lines.includes('3. *BTPK* -MQR STN- ARR: 13:30 HRS, DEP: 15:32 HRS, *DET: 122 MINS*'));
});

test('empty rows are left out and the numbering follows; a report with none says NIL', () => {
  const b = { ...example(), rows: [{ tr: '', at: '', from: '', to: '' }, { tr: 'abc', at: 'x', from: '10:00', to: '11:00' }, { tr: '', at: '', from: '', to: '' }] };
  const c = computeBlock(b);
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0].n, 1);
  assert.match(blockMessage(b), /1\. \*ABC\* -X STN- ARR: 10:00 HRS, DEP: 11:00 HRS, \*DET: 60 MINS\*/);
  // STN is not added twice, and a row with no station has no station part
  const two = { ...example(), rows: [{ tr: 'K1', at: 'CT STN', from: '10:00', to: '10:30' }, { tr: 'K2', at: '', from: '10:00', to: '10:40' }] };
  const text = blockMessage(two);
  assert.match(text, /1\. \*K1\* -CT STN- ARR: 10:00 HRS/);
  assert.match(text, /2\. \*K2\* ARR: 10:00 HRS, DEP: 10:40 HRS, \*DET: 40 MINS\*/);
  assert.match(blockMessage({ ...example(), rows: [] }), /\*NIL\*/);
});

test('STN goes only on a plain station; home, outer, section and yard are left as typed', () => {
  assert.equal(stn('ct'), 'CT STN');
  assert.equal(stn('CT STN'), 'CT STN');
  assert.equal(stn('CT STATION'), 'CT STATION');
  assert.equal(stn('CT HOME'), 'CT HOME');
  assert.equal(stn('ct outer'), 'CT OUTER');
  assert.equal(stn('CT-SUH SEC'), 'CT-SUH SEC');
  assert.equal(stn('CT-SUH'), 'CT-SUH');
  assert.equal(stn('CT/SUH SECTION'), 'CT/SUH SECTION');
  assert.equal(stn('KM 123/4'), 'KM 123/4');
  assert.equal(stn('KMT'), 'KMT STN'); // a station whose code starts with KM
  assert.equal(stn('SECUNDERABAD'), 'SECUNDERABAD STN');
  assert.equal(stn(''), '');
  const m = blockMessage({ ...example(), rows: [{ tr: 'KSNK', at: 'CT HOME', from: '12:34', to: '15:10' }, { tr: 'PSNH', at: 'CT-SUH SEC', from: '13:00', to: '' }] });
  assert.match(m, /1\. \*KSNK\* -CT HOME- ARR: 12:34 HRS, DEP: 15:10 HRS, \*DET: 156 MINS\*/);
  assert.match(m, /2\. \*PSNH\* -CT-SUH SEC- ARR: 13:00 HRS, STILL NOT DEPARTED, \*DET: 250 MINS \(UP TO 17:10 HRS\)\*/);
});

test('the heading: two stations with a dash are B/W, one station is AT; STN is not doubled', () => {
  const t = (name, dir, station) => blockTitle({ name, dir, station });
  assert.equal(t('PQRS', 'UP', 'WP-BG'), 'PQRS BLOCK PERMITTED IN UP DIRECTION B/W WP-BG STATION');
  assert.equal(t('PQRS', 'UP', 'wp - bg'), 'PQRS BLOCK PERMITTED IN UP DIRECTION B/W WP-BG STATION');
  assert.equal(t('PQRS', 'DN', 'WP'), 'PQRS BLOCK PERMITTED IN DN DIRECTION AT WP STATION');
  assert.equal(t('PQRS', 'UP', 'WP STN'), 'PQRS BLOCK PERMITTED IN UP DIRECTION AT WP STATION');
  assert.deepEqual(blockStations('WP – BG STN'), ['WP', 'BG']);
});

test('no blank line between the repercussion rows', () => {
  const lines = blockMessage(example()).split('\n');
  const first = lines.findIndex((l) => l.startsWith('1. *KSNK*'));
  assert.ok(lines[first + 1].startsWith('2. *PSNH*'));
  assert.ok(lines[first + 6].startsWith('7. *PSNH*'));
  assert.equal(lines[first - 1], '');
  assert.equal(lines[first - 2], '*REPERCUSSIONS:*');
});

test('BLOCK is added to the name by itself, and never twice', () => {
  assert.equal(blockName('BCM'), 'BCM BLOCK');
  assert.equal(blockName('bcm'), 'bcm BLOCK');
  assert.equal(blockName('BCM BLOCK'), 'BCM BLOCK');
  assert.equal(blockName('bcm block '), 'bcm block');
  assert.equal(blockName('  '), '');
  assert.equal(blockTitle({ name: 'BCM', dir: 'UP', station: 'CT - SUH' }), 'BCM BLOCK PERMITTED IN UP DIRECTION B/W CT-SUH STATION');
  assert.equal(blockTitle({ name: 'BCM BLOCK', dir: 'UP', station: 'CT - SUH' }), 'BCM BLOCK PERMITTED IN UP DIRECTION B/W CT-SUH STATION');
  assert.match(blockMessage({ ...blankBlock('2026-10-12'), name: 'BCM', dir: 'DN', station: 'MQR' }), /^\*SIR,\*\n\n\*BCM BLOCK PERMITTED IN DN DIRECTION AT MQR STATION\*/);
});

test('a block cleared in time says burst NIL; the title copes with missing parts', () => {
  assert.match(blockMessage({ ...example(), cleared: '14:00' }), /BLOCK BURST: NIL/);
  assert.equal(blockTitle({ name: 'bcm', dir: 'DN', station: '' }), 'BCM BLOCK PERMITTED IN DN DIRECTION');
  assert.equal(blockTitle({ name: '', dir: 'UP', station: 'CT' }), 'BLOCK PERMITTED IN UP DIRECTION AT CT STATION');
});

import { blockSheet } from '../js/sheet.js';

test('the table of a block report has the title, the block lines and a row for each train', () => {
  const b = { ...blankBlock('2026-10-12'), name: 'BCM BLOCK', dir: 'UP', station: 'CT - SUH', from: '12:00', to: '14:30', cleared: '15:25', asOn: '17:10',
    rows: [{ tr: 'ksnk', at: 'ct', from: '11:30', to: '15:57' }, { tr: 'PSNH', at: 'CT', from: '12:34', to: '' }] };
  const s = blockSheet(b);
  const text = s.rows.map((r) => r.filter(Boolean).map((c) => c.v).join(' | '));
  assert.equal(text[1], 'BCM BLOCK PERMITTED IN UP DIRECTION B/W CT-SUH STATION');
  assert.match(text[2], /BLOCK PERMITTED \| 12:00 TO 14:30 HRS {3}\(DURATION 150 MINS \(02:30 HRS\)\)/);
  assert.ok(text.includes('BLOCK BURST | 55 MINS'));
  assert.ok(text.some((t) => t === '1 | KSNK | CT | 11:30 HRS | 15:57 HRS | 267 MINS'));
  assert.ok(text.some((t) => t === '2 | PSNH | CT | 12:34 HRS | STILL NOT DEPARTED | 276 MINS (UP TO 17:10 HRS)'));
});
