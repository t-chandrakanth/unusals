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
  assert.match(text, /DET: 02:34 HRS/);
  assert.doesNotMatch(text, /02:40|05:14/);
  const cells = unusualSheet(s.unusuals).rows.flat().filter(Boolean).map((c) => c.v).join('|');
  assert.match(cells, /02:34 HRS/);
  assert.doesNotMatch(cells, /02:40|05:14/);
});
