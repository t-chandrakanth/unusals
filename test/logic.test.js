import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as L from '../js/logic.js';
import { seedState } from '../js/seed.js';
import { reportSheet, historySheet } from '../js/sheet.js';
import { sheetToXlsx } from '../js/xlsx.js';

const at = (d, hh, mm = 0) => new Date(2026, 9, d, hh, mm).toISOString();

test('seed matches the 08-10-2026 sheet: 18 rows under 17 serial numbers', () => {
  const s = seedState();
  assert.equal(s.locos.length, 18);
  assert.equal(s.locos.filter((l) => l.division === 'OTHER').length, 8);
  const rows = L.numbered(s.locos);
  assert.equal(rows.at(-1).serial, 17);
  const split = rows.filter((r) => r.serial === 6);
  assert.deepEqual(split.map((r) => r.loco.locoNo), ['27337', '27360']);
  assert.deepEqual(split.map((r) => r.span), [2, 0]);
  assert.equal(rows.find((r) => r.loco.locoNo === '27609+28411').serial, 8);
});

test('saving a change logs it; saving with no change does nothing', () => {
  let s = seedState();
  const loco = s.locos.find((l) => l.locoNo === '27609+28411');
  const same = L.reduce(s, { type: 'save', loco: { ...loco }, now: at(9, 8) });
  assert.equal(same, s);
  s = L.reduce(s, { type: 'save', loco: { ...loco, location: ' KZJ ' }, now: at(9, 8) });
  assert.equal(s.log.length, 19);
  assert.equal(s.locos.find((l) => l.id === loco.id).location, 'KZJ');
  assert.equal(s.log.at(-1).kind, 'updated');
});

test('a loco handed over to another division moves sections and renumbers', () => {
  let s = seedState();
  const loco = s.locos.find((l) => l.locoNo === '27609+28411');
  s = L.reduce(s, { type: 'save', loco: { ...loco, division: 'OTHER', hoPoint: 'WADI' }, now: at(9, 8) });
  const rows = L.numbered(s.locos);
  assert.equal(rows.find((r) => r.loco.id === loco.id).serial, 8);
  assert.equal(rows.filter((r) => r.loco.division === 'OTHER').length, 9);
  assert.equal(rows.find((r) => r.loco.locoNo === '28073+28526').serial, 9);
  assert.equal(rows.at(-1).serial, 17);
});

test('move swaps only within the same division', () => {
  let s = seedState();
  const first = s.locos[0];
  assert.equal(L.reduce(s, { type: 'move', id: first.id, dir: -1 }), s);
  s = L.reduce(s, { type: 'move', id: first.id, dir: 1 });
  assert.equal(s.locos[1].id, first.id);
  const lastOther = s.locos.filter((l) => l.division === 'OTHER').at(-1);
  assert.equal(L.reduce(s, { type: 'move', id: lastOther.id, dir: 1 }), s);
});

test('day-wise summary: one row per update, carried forward on quiet days', () => {
  let s = seedState();
  const loco = s.locos.find((l) => l.locoNo === '27337');
  s = L.reduce(s, { type: 'save', loco: { ...loco, location: 'DDU' }, now: at(10, 7, 30) });
  s = L.reduce(s, { type: 'save', loco: { ...loco, location: 'PRYJ' }, now: at(10, 15) });
  const rows = L.daySummary(s.log, loco.id, '2026-10-07', '2026-10-11');
  assert.deepEqual(rows.map((r) => [r.day, r.time, r.data.location, r.carried]), [
    ['2026-10-08', '18:00', 'GAYA/DDU/EC', false],
    ['2026-10-09', '', 'GAYA/DDU/EC', true],
    ['2026-10-10', '07:30', 'DDU', false],
    ['2026-10-10', '15:00', 'PRYJ', false],
    ['2026-10-11', '', 'PRYJ', true],
  ]);
  // A range that starts after the first record still knows the position.
  const later = L.daySummary(s.log, loco.id, '2026-10-11', '2026-10-12');
  assert.deepEqual(later.map((r) => r.data.location), ['PRYJ', 'PRYJ']);
});

test('removed locos keep their history and stop carrying forward', () => {
  let s = seedState();
  const loco = s.locos.find((l) => l.locoNo === '27360');
  s = L.reduce(s, { type: 'remove', id: loco.id, now: at(10, 9) });
  assert.equal(s.locos.length, 17);
  assert.ok(L.locoChoices(s).some((c) => c.label === '27360 (removed)'));
  const rows = L.daySummary(s.log, loco.id, '2026-10-08', '2026-10-12');
  assert.deepEqual(rows.map((r) => r.kind), ['created', 'created', 'removed']);
});

test('position on a past day is rebuilt from the log', () => {
  let s = seedState();
  const loco = s.locos.find((l) => l.locoNo === '27609+28411');
  s = L.reduce(s, { type: 'save', loco: { ...loco, location: 'KZJ' }, now: at(10, 8) });
  s = L.reduce(s, { type: 'save', loco: { ...L.blankLoco('SC'), locoNo: '99999' }, now: at(11, 8) });
  assert.equal(L.locosOnDay(s, '2026-10-07').length, 0);
  const d9 = L.locosOnDay(s, '2026-10-09');
  assert.equal(d9.length, 18);
  assert.equal(d9.find((l) => l.id === loco.id).location, 'SUH');
  assert.equal(L.locosOnDay(s, '2026-10-10').find((l) => l.id === loco.id).location, 'KZJ');
  assert.equal(L.locosOnDay(s, '2026-10-11').length, 19);
});

test('report text and sheet carry both tables in the sheet format', () => {
  const s = seedState();
  const text = L.reportText(s.locos, '2026-10-08');
  assert.match(text, /\*DPWS LOCOS IN OTHER DIV DATA DT-08-10-2026\*/);
  assert.match(text, /\*SC DIV DPWS LOCOS DATA DT-08-10-2026\*/);
  assert.match(text, /H\/O: CDG at WADI, 31-07-26 13:05/);
  const sheet = reportSheet(s.locos, '2026-10-08');
  assert.equal(sheet.rows.length, 2 + 8 + 1 + 2 + 10);
  for (const row of sheet.rows) assert.equal(row.length, 9);
  assert.equal(sheet.rows[7][0].rowSpan, 2);
  assert.equal(sheet.rows[8][0], null);
});

test('xlsx output is a well-formed zip (checked further with openpyxl)', () => {
  const s = seedState();
  const bytes = sheetToXlsx(reportSheet(s.locos, '2026-10-08'));
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 3, 4]);
  if (process.env.XLSX_OUT) {
    writeFileSync(`${process.env.XLSX_OUT}/report.xlsx`, bytes);
    const rows = L.daySummary(s.log, s.locos[0].id, '2026-10-06', '2026-10-09');
    writeFileSync(`${process.env.XLSX_OUT}/history.xlsx`,
      sheetToXlsx(historySheet(s.locos[0].locoNo, rows, '2026-10-06', '2026-10-09')));
  }
});

test('FOIS message date drives the remark and can be read back from old remarks', () => {
  assert.equal(L.foisRemark('2026-10-09'),
    'FOIS message given to the division on 09-10-2026. Following it up with the Division regularly. FOIS MESSAGE GIVEN TODAY IT SELF.');
  assert.equal(L.foisDateFromRemarks(L.foisRemark('2026-10-09')), '2026-10-09');
  assert.equal(L.foisDateFromRemarks('MCI SECTOR'), '');
  const s = seedState();
  assert.equal(s.locos[0].foisDate, '2026-08-30');
  assert.equal(s.locos[10].foisDate, '');
  // An older loco without the field is unchanged by merely opening and saving it.
  const { foisDate, ...old } = s.locos[0];
  const before = { ...s, locos: [old, ...s.locos.slice(1)] };
  assert.equal(L.reduce(before, { type: 'save', loco: { ...old }, now: 'x' }), before);
});
