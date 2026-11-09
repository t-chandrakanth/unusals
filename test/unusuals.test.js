import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { seedState } from '../js/seed.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importUnusuals, unusualsImported } from '../js/unusualimport.js';
import { unusualSheet } from '../js/sheet.js';
import { diffOps, allOps, applyRemote } from '../js/syncdata.js';
import { createSync } from '../js/sync.js';

const now = (h = 9) => new Date(2026, 9, 10, h, 0).toISOString();

test('the older records are all there', () => {
  assert.equal(UNUSUAL_RECORDS.length, 12);
  assert.equal(UNUSUAL_RECORDS.find((r) => r.day === '2026-09-11').load, '60/60/5360');
});

test('importing loads them once, with fixed ids, and never twice', () => {
  const a = importUnusuals(seedState(), UNUSUAL_RECORDS);
  assert.equal(a.unusuals.length, 12);
  assert.ok(unusualsImported(a));
  assert.equal(importUnusuals(a, UNUSUAL_RECORDS), a);
  const b = importUnusuals(seedState(), UNUSUAL_RECORDS);
  assert.deepEqual(a.unusuals.map((u) => u.id), b.unusuals.map((u) => u.id));
  assert.equal(new Set(a.unusuals.map((u) => u.id)).size, 12);
});

test('writing, editing and deleting an unusual report', () => {
  let s = seedState();
  const u = { ...L.blankUnusual('2026-10-09'), title: 'LOCO FAILED', trainNo: 'KSNK', reason: 'stalled' };
  s = L.reduce(s, { type: 'saveUnusual', unusual: u, now: now(), by: 'ravi' });
  assert.equal(s.unusuals.length, 1);
  assert.equal(s.unusuals[0].updatedBy, 'ravi');
  assert.equal(L.reduce(s, { type: 'saveUnusual', unusual: u, now: now(10) }), s, 'no change, no new version');
  s = L.reduce(s, { type: 'saveUnusual', unusual: { ...u, det: '01:10 HRS' }, now: now(10) });
  assert.equal(s.unusuals.length, 1);
  assert.equal(s.unusuals[0].det, '01:10 HRS');
  s = L.reduce(s, { type: 'removeUnusual', id: u.id });
  assert.equal(s.unusuals.length, 0);
});

test('day-wise order: newest day first, oldest first for the statement', () => {
  const s = importUnusuals(seedState(), UNUSUAL_RECORDS);
  assert.equal(L.unusualsByDay(s.unusuals)[0][0], '2026-10-06');
  assert.equal(L.unusualsInOrder(s.unusuals)[0].day, '2026-08-01');
  assert.match(L.unusualText(s.unusuals.slice(0, 1)), /UNUSALS-DATE-/);
});

test('the sheet has a numbered block per report, in the daily-sheet layout', () => {
  const s = importUnusuals(seedState(), UNUSUAL_RECORDS);
  const sheet = unusualSheet(s.unusuals);
  const first = sheet.rows[0][0];
  assert.equal(first.v, 'UNUSALS-DATE-01-08-2026');
  assert.equal(sheet.rows[1][0].v, '1');
  assert.equal(sheet.rows[1][1].v, 'TRAIN DETAILS');
  assert.ok(sheet.rows.some((r) => r[1] && r[1].v === 'LOAD'));
  assert.equal(sheet.rows[1][0].rowSpan, 7, 'serial covers the whole block');
});

test('changes go to the unusuals table, and a second device rebuilds them', () => {
  const a = importUnusuals(seedState(), UNUSUAL_RECORDS);
  const ops = allOps(a, 'x').filter((o) => o.table === 'unusuals');
  assert.equal(ops.length, 12);
  const rows = ops.map((o, i) => ({ ...o.row, synced_at: `2026-10-10T04:00:0${i % 10}+00:00` }));
  const b = applyRemote({ ...L.emptyState() }, 'unusuals', rows);
  assert.equal(b.unusuals.length, 12);
  assert.equal(b.unusuals.find((u) => u.incident === '16596').trainNo, 'TTGR/BOBRL');

  const edited = L.reduce(a, { type: 'saveUnusual', unusual: { ...a.unusuals[0], det: '05:05' }, now: now() });
  assert.deepEqual(diffOps(a, edited, 'x').map((o) => o.table), ['unusuals']);
  const removed = L.reduce(a, { type: 'removeUnusual', id: a.unusuals[0].id });
  const del = diffOps(a, removed, 'x');
  assert.equal(del[0].row.deleted, true);
  assert.equal(applyRemote(a, 'unusuals', del.map((o) => ({ ...o.row, synced_at: 'x' }))).unusuals.length, 11);
});

// ---- sync when the unusuals table has not been created yet ----

function fakeServer({ withTable }) {
  const calls = [];
  const stored = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).split('/rest/v1/')[1];
    const table = path.split('?')[0];
    calls.push(`${init.method || 'GET'} ${table}`);
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (table === 'unusuals' && !withTable) return reply(404, { code: 'PGRST205', message: 'no table' });
    if ((init.method || 'GET') === 'POST') {
      if (table === 'unusuals') stored.push(...JSON.parse(init.body));
      return reply(201, null);
    }
    return reply(200, table === 'unusuals' ? stored : []);
  };
  return { calls, stored };
}

async function runSync(state, { withTable }) {
  const server = fakeServer({ withTable });
  let current = state;
  let last = null;
  const sync = createSync({
    url: 'https://example.test', key: 'k', login: false,
    getState: () => current, setState: (next) => { current = next; }, onStatus: (s) => { last = s; },
  });
  await sync.syncNow();
  return { server, state: () => current, status: () => last, sync };
}

test('without the unusuals table the rest still syncs and the reports wait on the device', async () => {
  const base = importUnusuals({ ...seedState(), sync: { outbox: [], cursor: {}, linked: true } }, UNUSUAL_RECORDS);
  const outbox = allOps(base, 'x').filter((o) => o.table === 'unusuals');
  const { state, status } = await runSync({ ...base, sync: { outbox, cursor: {}, linked: true } }, { withTable: false });
  assert.equal(status().phase, 'synced');
  assert.equal(status().unusualsMissing, true);
  assert.equal(status().pending, 0, 'waiting reports do not count as unsaved changes');
  assert.equal(state().sync.outbox.length, 12, 'kept to upload later');
  assert.equal(state().unusuals.length, 12);
});

test('once the table exists the waiting reports upload', async () => {
  const base = importUnusuals({ ...seedState(), sync: { outbox: [], cursor: {}, linked: true } }, UNUSUAL_RECORDS);
  const outbox = allOps(base, 'x').filter((o) => o.table === 'unusuals');
  const { server, state, status } = await runSync({ ...base, sync: { outbox, cursor: {}, linked: true } }, { withTable: true });
  assert.equal(status().unusualsMissing, false);
  assert.equal(server.stored.length, 12);
  assert.equal(state().sync.outbox.length, 0);
  assert.equal(state().unusuals.length, 12);
});

test('the time of the incident is no longer shown or shared; reports on a day stay in the order written', () => {
  let s = seedState();
  const mk = (time, trainNo) => ({ ...L.blankUnusual('2026-10-09'), time, trainNo, title: 'LOCO FAILED' });
  s = L.reduce(s, { type: 'saveUnusual', unusual: mk('14:30', 'FIRST'), now: now(9) });
  s = L.reduce(s, { type: 'saveUnusual', unusual: mk('06:15', 'SECOND'), now: now(10) });
  assert.deepEqual(L.unusualsByDay(s.unusuals)[0][1].map((u) => u.trainNo), ['FIRST', 'SECOND']);
  assert.equal(unusualSheet(s.unusuals).rows[0][0].v, 'UNUSALS-DATE-09-10-2026');
  assert.doesNotMatch(L.unusualText(s.unusuals), /14:30|06:15/);
});

test('detention is worked out from From and To, past midnight too', () => {
  assert.equal(L.detentionBetween('02:40', '05:14'), '02:34 HRS');
  assert.equal(L.detentionBetween('23:30', '01:15'), '01:45 HRS');
  assert.equal(L.detentionBetween('08:00', '08:00'), '00:00 HRS');
  assert.equal(L.detentionBetween('08:00', ''), '');
  assert.equal(L.detentionBetween('', ''), '');
});

test('From and To are kept with the report but never shared: only DET shows', () => {
  const u = { ...L.blankUnusual('2026-10-12'), title: 'LOCO FAILED', detFrom: '02:40', detTo: '05:14', det: '02:34 HRS' };
  const s = L.reduce(seedState(), { type: 'saveUnusual', unusual: u, now: now(), by: 'x' });
  assert.equal(s.unusuals[0].detFrom, '02:40');
  assert.equal(s.unusuals[0].detTo, '05:14');
  const text = L.unusualText(s.unusuals);
  assert.match(text, /DET : 02:34 HRS/);
  assert.doesNotMatch(text, /02:40|05:14/);
  const cells = unusualSheet(s.unusuals).rows.flat().filter(Boolean).map((c) => c.v).join('|');
  assert.match(cells, /02:34 HRS/);
  assert.doesNotMatch(cells, /02:40|05:14/);
});

test('the text message of one report: heading, details, events one to a line, wagon, BPC and repercussions', () => {
  const u = {
    ...L.blankUnusual('2026-10-19'), title: 'KPCC METAL ON TYRE', location: 'VKB-GDQ', trainNo: 'KPCC', locoNo: '60529/SBI/01/07', load: '60/60/3365T',
    reason: '21:04 VKB DEP FROM LOOP LINE\n21:08 TRAIN STOPPED', wagonNo: 'SECR-12140893411', bpcNo: '50000951763/JSG/CKP/SER',
    rep: 'KPCC -GDQ- ARR: 21:53, NOT DEPARTED, DET: 327 MINS (UP TO 03:20 HRS)\nYTPY -VKB- ARR: 21:37, DEP: 01:09, DET: 212 MINS',
  };
  // a report with a wagon is a C&W failure and takes the control-office format
  assert.equal(L.unusualMessage(u), [
    '*KPCC METAL ON TYRE*', '', 'Location : VKB-GDQ', 'Train no : KPCC', 'Loco no : 60529/SBI/01/07', 'Load : 60/60/3365T', '',
    'Wagon no : SECR-12140893411', 'BPC no : 50000951763/JSG/CKP/SER', '', '',
    '*Sequence of Events:*', '- VKB DEP FROM LOOP LINE AT 21:04', '- TRAIN STOPPED AT 21:08', '', '',
    '*Goods Repercussion:*', '1. KPCC -GDQ- ARR: 21:53, NOT DEPARTED, *DET: 327 MINS* (UP TO 03:20 HRS)', '2. YTPY -VKB- ARR: 21:37, DEP: 01:09, DET: 212 MINS',
  ].join('\n'));
  // boxes that were not written are left out
  assert.equal(L.unusualMessage({ ...L.blankUnusual('2026-10-19'), title: 'HOT AXLE', trainNo: 'ABC' }), '*HOT AXLE*\n\nTrain no : ABC');
});

test('a C&W failure is written in the control-office format with sections', () => {
  const u = {
    ...L.blankUnusual('2026-11-09'), type: 'cw', title: 'MLSW GOODS COUPLING/DROPPER BROKEN', location: 'ASAF-SKZR Section',
    trainNo: 'MLSW X MTMI', locoNo: '31549+41307/KZJ/5-1', load: '60/60/5166 T',
    wagonNo: '13 TH FROM LOCO ER BOXN M1 10020261350', bpcNo: 'PM 50000956129/28-10/JTJ',
    reason: '10:00 TRAIN STOPPED B/W ASAF-SKZR IB UP MAIN LINE\nTRAIN PARTED B/W 12 & 13 WAGON',
    plan: 'Front portion (LOCO+12 Wagons) cleared to SKZR, dep 11:35 Hrs.\nRelief loco 33111+43123 to attach from rear.',
    rep: 'GZB -BPA- ARR: 09:14, DEP: 10:57, DET: 103 MINS\nFN NMG -MMZ- ARR: 09:44, DEP: 10:45, DET: 61 MINS',
  };
  assert.equal(L.unusualMessage(u), [
    '*MLSW GOODS COUPLING/DROPPER BROKEN*', '',
    'Location : ASAF-SKZR Section', 'Train no : MLSW X MTMI', 'Loco no : 31549+41307/KZJ/5-1', 'Load : 60/60/5166 T', '',
    'Wagon no : 13 TH FROM LOCO ER BOXN M1 10020261350', 'BPC no : PM 50000956129/28-10/JTJ', '', '',
    '*Sequence of Events:*', '- TRAIN STOPPED B/W ASAF-SKZR IB UP MAIN LINE AT 10:00', '- TRAIN PARTED B/W 12 & 13 WAGON', '',
    '*Plan of action:*', '1. Front portion (LOCO+12 Wagons) cleared to SKZR, dep 11:35 Hrs.', '2. Relief loco 33111+43123 to attach from rear.', '', '',
    '*Goods Repercussion:*', '1. GZB -BPA- ARR: 09:14, DEP: 10:57, *DET: 103 MINS*', '2. FN NMG -MMZ- ARR: 09:44, DEP: 10:45, DET: 61 MINS',
  ].join('\n'));
  // loco failures keep the old format
  assert.equal(L.unusualMessage({ ...L.blankUnusual('2026-10-19'), title: 'HOT AXLE', trainNo: 'ABC' }), '*HOT AXLE*\n\nTrain no : ABC');
});

test('a loco failure also carries the three sections', () => {
  const u = { ...L.blankUnusual('2026-11-09'), type: 'loco', title: 'LOCO FAILURE', trainNo: 'ABC', det: '45 MINS', reason: '10:00 STOPPED', plan: 'Relief loco ordered', rep: 'ABC -KZJ- DET: 45 MINS' };
  assert.equal(L.unusualMessage(u), ['*LOCO FAILURE*', '', 'Train no : ABC', 'DET : 45 MINS', '', '', '*Sequence of Events:*', '- STOPPED AT 10:00', '',
    '*Plan of action:*', '1. Relief loco ordered', '', '', '*Goods Repercussion:*', '1. ABC -KZJ- *DET: 45 MINS*'].join('\n'));
});

test('the DPWCS copy: train no, details and location as the heading, then the sections and the detention', () => {
  const u = { ...L.blankUnusual('2026-11-09'), title: 'LOCO FAILED-DPWCS', location: 'KZJ', trainNo: 'YTPY', locoNo: '28073+28526/KZJ 26-11',
    reason: '08:30 KZJ YTPY ARR\n10:30 LOCO FAILED', plan: 'RELIEF LOCO 28305+27732 ORDERED', det: '05:00 HRS' };
  assert.equal(L.dpwcsUnusualText([u]), ['*YTPY-LOCO FAILED-DPWCS@KZJ*', '', 'Loco no : 28073+28526/KZJ 26-11', '', '',
    '*Sequence of Events:*', '- KZJ YTPY ARR AT 08:30', '- LOCO FAILED AT 10:30', '', '*Plan of action:*', '1. RELIEF LOCO 28305+27732 ORDERED', '',
    '*Detention :* 05:00 HRS'].join('\n'));
  assert.doesNotMatch(L.dpwcsUnusualText([u]), /UNUSALS-DATE|DPWCS LOCO FAILURES/);
});
