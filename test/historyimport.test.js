// Report times are Indian Standard Time; pin it so the test is the same everywhere.
process.env.TZ = 'Asia/Kolkata';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { seedState } from '../js/seed.js';
import { SNAPSHOTS } from '../js/history-data.js';
import { importHistory, alreadyImported, locoKey } from '../js/historyimport.js';
import { diffOps } from '../js/syncdata.js';

test('loco identity ignores order, the (D) note and the known typo', () => {
  assert.equal(locoKey('27608+27336'), locoKey('27336+27608'));
  assert.equal(locoKey('27609(D)+28411'), locoKey('27609+28411'));
  assert.equal(locoKey('27764+27592'), locoKey('27592+27767'));
  assert.notEqual(locoKey('27337'), locoKey('27360'));
});

const SHEET = SNAPSHOTS.filter((s) => s.source === 'sheet');
const SHED = SNAPSHOTS.filter((s) => s.source === 'shed');

test('the records: 16 position reports and 31 shed statements, in time order', () => {
  assert.equal(SHEET.length, 16);
  assert.equal(SHEET[0].day, '2026-08-17');
  assert.equal(SHEET.at(-1).day, '2026-10-10');
  assert.equal(SHED.length, 31);
  assert.equal(SHED[0].day, '2026-07-13');
  assert.equal(SHED.at(-1).day, '2026-10-10');
  assert.ok(!SNAPSHOTS.some((s) => s.day > '2026-10-10'), 'the pre-made 11.10 sheet is left out');
  assert.deepEqual(SNAPSHOTS.map((s) => s.at), [...SNAPSHOTS.map((s) => s.at)].sort());
  for (const s of SHEET) assert.ok(s.rows.length === 17 || s.rows.length === 18, s.day);
});

test('import keeps the same 18 locos and moves them to the 10-10-2026 position report', () => {
  const before = seedState();
  const after = importHistory(before, SNAPSHOTS);
  assert.equal(after.locos.length, 18);
  assert.deepEqual(new Set(after.locos.map((l) => l.id)), new Set(before.locos.map((l) => l.id)));
  const rows = L.numbered(after.locos);
  assert.equal(rows.at(-1).serial, 17);
  assert.equal(rows.filter((r) => r.loco.division === 'OTHER').length, 9);
  const l = after.locos.find((x) => x.locoNo === '27294+28066');
  assert.equal(l.division, 'OTHER');
  assert.equal(l.location, 'ADB/NED/SCR');
  assert.equal(l.foisDate, '2026-10-09');
  assert.equal(l.updatedBy, 'sheet');
  assert.equal(after.locos.find((x) => x.locoNo === '27360').sameSerial, true);
});

test('a loco updated in the app after the last position report is not overwritten', () => {
  let s = seedState();
  const loco = s.locos.find((x) => x.locoNo === '44323+42372');
  s = L.reduce(s, { type: 'save', loco: { ...loco, location: 'LATEST FROM APP' }, now: '2026-10-10T06:00:00.000Z', by: 'me' });
  const after = importHistory(s, SNAPSHOTS);
  assert.equal(after.locos.find((x) => x.id === loco.id).location, 'LATEST FROM APP');
});

test('position reports are saved as written; shed statements are history only', () => {
  const after = importHistory(seedState(), SNAPSHOTS);
  assert.equal(after.reports.length, 16);
  assert.ok(after.reports.every((r) => r.by === 'sheet'));
  assert.equal(after.reports[0].locos.length, 18);
  assert.equal(after.reports[0].locos[0].locoNo, '27300+27402');
  assert.equal(after.reports[0].locos[0].location, 'JL/BSL/CR');
});

test('any past day can be rebuilt, from whichever record was latest that day', () => {
  const after = importHistory(seedState(), SNAPSHOTS);
  const on = (day, no) => L.locosOnDay(after, day).find((l) => locoKey(l.locoNo) === locoKey(no));
  // 16-07: only the shed statement exists.
  assert.equal(on('2026-07-16', '27300+27402').location, 'LE/MQR');
  assert.equal(on('2026-07-16', '27300+27402').trainNo, 'UTCP/PRLI');
  // 17-08: the position report.
  assert.equal(on('2026-08-17', '27300+27402').location, 'JL/BSL/CR');
  // 15-09: between position reports, the shed statement fills the gap.
  assert.equal(on('2026-09-15', '42372+44323').division, 'OTHER');
  assert.equal(on('2026-09-15', '42372+44323').hoPoint, 'H/O TO SUR DIV');
  // 10-10: both exist; the position report (later in the day) stands.
  assert.equal(on('2026-10-10', '44323+42372').location, 'BRSQ/DLI/NR');
  // Locos that left the records do not linger.
  assert.equal(on('2026-08-17', '42840+42514'), undefined);
  assert.ok(on('2026-08-24', '28012+27768'));
  assert.equal(on('2026-10-01', '28012+27768'), undefined);
});

test('day-wise history of one loco shows both records with their source', () => {
  const after = importHistory(seedState(), SNAPSHOTS);
  const loco = after.locos.find((x) => x.locoNo === '44323+42372');
  const rows = L.daySummary(after.log, loco.id, '2026-08-17', '2026-08-23').filter((r) => !r.carried);
  assert.deepEqual(rows.map((r) => [r.day, r.time, r.by, r.data.location]), [
    ['2026-08-17', '12:00', 'sheet', 'PMRN/ASN/ER'],
    ['2026-08-18', '12:00', 'sheet', 'PMRN ARRI/KGP/SER'],
    ['2026-08-20', '07:00', 'shed', 'RKI/ADRA DIV (AS PER FOIS)'],
    ['2026-08-21', '10:00', 'sheet', 'ASN/ASN/ERLY'],
    ['2026-08-22', '12:00', 'sheet', 'GHZ/SEE/ERLY'],
    ['2026-08-23', '12:00', 'sheet', 'GARA/SPJ/ ECR'],
  ]);
  const gone = L.locoChoices(after).find((c) => c.label.includes('28012'));
  assert.ok(gone.label.endsWith('(removed)'));
});

test('import runs once and produces the rows to upload', () => {
  const before = seedState();
  const after = importHistory(before, SNAPSHOTS);
  assert.ok(alreadyImported(after));
  assert.equal(importHistory(after, SNAPSHOTS), after);
  const again = importHistory(JSON.parse(JSON.stringify(before)), SNAPSHOTS);
  assert.deepEqual(again.log.map((e) => e.id), after.log.map((e) => e.id));
  const added = after.log.filter((e) => e.id.startsWith('imp1-'));
  assert.equal(new Set(added.map((e) => e.id)).size, added.length);
  const ops = diffOps(before, after, 'x');
  assert.equal(ops.filter((o) => o.table === 'reports').length, 16);
  assert.equal(ops.filter((o) => o.table === 'locos').length, 18);
  assert.equal(ops.filter((o) => o.table === 'log').length, added.length);
});
