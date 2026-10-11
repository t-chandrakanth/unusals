import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLabelled, parseColumns, keyOfLabel } from '../js/official.js';
import { readReports } from '../js/reports.js';

test('label names are understood in their usual variants', () => {
  assert.equal(keyOfLabel('Train No.'), 'trainNo');
  assert.equal(keyOfLabel('TR. NO'), 'trainNo');
  assert.equal(keyOfLabel('LOCO NUMBER'), 'locoNo');
  assert.equal(keyOfLabel('Date of Incident'), 'day');
  assert.equal(keyOfLabel('Brief details'), 'reason');
  assert.equal(keyOfLabel('3. BPC No'), 'bpcNo');
  assert.equal(keyOfLabel('Detention'), 'det');
  assert.equal(keyOfLabel('Weather'), '');
});

test('a two-column Word table (label, value) fills the boxes', () => {
  const text = `Unusual incident report
Date\t05.10.2026
Station\tKZJ
Train No\tBOXN 12
Loco No\t27592+27767
Load\t59+1
Wagon No\tSCR 22100985063 BOXNHL
BPC No\t50000946064/UDL/28.09.26/CC
Detention\t1 HRS 20 MINS
Reason\tHot axle found at KZJ.
Wagon detached at 15:45.`;
  const r = parseLabelled(text);
  assert.equal(r.day, '2026-10-05');
  assert.equal(r.location, 'KZJ');
  assert.equal(r.trainNo, 'BOXN 12');
  assert.equal(r.locoNo, '27592+27767');
  assert.equal(r.load, '59+1');
  assert.equal(r.wagonNo, 'SCR 22100985063 BOXNHL');
  assert.equal(r.bpcNo, '50000946064/UDL/28.09.26/CC');
  assert.equal(r.det, '1 HRS 20 MINS');
  assert.equal(r.reason, 'Hot axle found at KZJ.\nWagon detached at 15:45.');
  assert.equal(r.title, 'UNUSUAL INCIDENT REPORT');
});

test('colon lines, dashes and words run together (photo text) are read', () => {
  const photo = `HOT AXLE AT KZJ
DATE - 06/10/2026
LOCATION KZJ YARD
TRAIN NO KPCC
LOCO NO 38756+37410
REASON Train stopped 10:15, wagon detached 11:30.
DET 2 HRS`;
  const r = parseLabelled(photo);
  assert.equal(r.day, '2026-10-06');
  assert.equal(r.location, 'KZJ YARD');
  assert.equal(r.trainNo, 'KPCC');
  assert.equal(r.locoNo, '38756+37410');
  assert.equal(r.det, '2 HRS');
  assert.match(r.reason, /^Train stopped 10:15/);
  assert.equal(r.title, 'HOT AXLE AT KZJ');
});

test('text with too few labels is not taken for a report', () => {
  assert.equal(parseLabelled('Hello\nSome words: here'), null);
  assert.equal(parseLabelled(''), null);
});

test('a register with headings across the top gives a report per row, Excel dates included', () => {
  const sheet = `DATE\tTR.NO\tLOCO NO\tBASE AND DUE DATE\tLOAD\tLOCATION\tSECTION\tRELIEF LOCO NO\tBANKER LOCO NO\tREMARKS
46297\tKSNK\t27592+27767\t11/11\t59/59/4882T\tPRLI\tPRLI-GTU\t60574\t\tstalled at km 3
06.10.2026\tUTCP\t28012+27768\t\t\tLTRR\t\t\t\tdpwcs problem
\t\t\t\t\t\t\t\t\t`;
  const rows = parseColumns(sheet);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day, '2026-10-02');
  assert.equal(rows[0].trainNo, 'KSNK');
  assert.equal(rows[0].load, '59/59/4882T');
  assert.equal(rows[0].location, 'PRLI');
  assert.match(rows[0].reason, /stalled at km 3/);
  assert.match(rows[0].reason, /BASE AND DUE DATE: 11\/11/);
  assert.match(rows[0].reason, /RELIEF LOCO NO: 60574/);
  assert.equal(rows[1].day, '2026-10-06');
});

test('readReports tries the layouts in order and sorts each report', () => {
  const [a] = readReports('Date: 05.10.2026\nTrain No: X1\nLoco No: 27592\nLocation: KZJ\nReason: loco failed, relief loco sent.\nWagon No: -');
  assert.equal(a.trainNo, 'X1');
  assert.ok(['loco', 'cw', 'other'].includes(a.type));
  const reg = readReports('DATE\tTR.NO\tLOCO NO\tLOCATION\n06.10.2026\tA\t27592\tKZJ\n07.10.2026\tB\t27767\tPRLI');
  assert.equal(reg.length, 2);
  assert.deepEqual(reg.map((r) => r.day), ['2026-10-06', '2026-10-07']);
});
