import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { seedState } from '../js/seed.js';
import { diffOps, allOps, collapse, applyRemote } from '../js/syncdata.js';

const now = () => new Date(2026, 9, 10, 9, 0).toISOString();
const serverRows = (ops, table) => ops.filter((o) => o.table === table).map((o, i) => ({ ...o.row, synced_at: `2026-10-10T04:00:0${i % 10}+00:00` }));

test('editing one loco sends that loco and its log entry, nothing else', () => {
  const a = seedState();
  const loco = a.locos[9];
  const b = L.reduce(a, { type: 'save', loco: { ...loco, location: 'KZJ' }, now: now(), by: 'ravi' });
  const ops = diffOps(a, b, 'ravi');
  assert.deepEqual(ops.map((o) => o.table), ['locos', 'log']);
  assert.equal(ops[0].row.id, loco.id);
  assert.equal(ops[0].row.pos, 9);
  assert.equal(ops[0].row.data.location, 'KZJ');
  assert.equal(ops[0].row.updated_by, 'ravi');
  assert.equal(ops[1].row.changed_by, 'ravi');
  assert.equal(ops[1].row.loco_id, loco.id);
});

test('removing a loco sends a deleted marker and shifts the ones below it', () => {
  const a = seedState();
  const b = L.reduce(a, { type: 'remove', id: a.locos[16].id, now: now(), by: 'ravi' });
  const ops = diffOps(a, b, 'ravi').filter((o) => o.table === 'locos');
  assert.deepEqual(ops.map((o) => [o.row.pos, o.row.deleted]), [[16, false], [16, true]]);
  assert.equal(ops[0].row.id, a.locos[17].id);
  assert.equal(ops[1].row.id, a.locos[16].id);
});

test('a second device rebuilds the same list from the uploaded rows', () => {
  const a = seedState();
  const ops = allOps(a, 'ravi');
  assert.equal(ops.length, 18 + 18);
  let b = { ...L.emptyState(), sync: {} };
  for (const table of ['locos', 'log', 'reports']) b = applyRemote(b, table, serverRows(ops, table));
  assert.deepEqual(b.locos.map((l) => l.locoNo), a.locos.map((l) => l.locoNo));
  assert.deepEqual(L.numbered(b.locos).map((r) => r.serial), L.numbered(a.locos).map((r) => r.serial));
  assert.equal(b.log.length, 18);
  assert.equal(b.log[0].at, a.log[0].at);
  assert.ok(L.sameFields(b.locos[6], a.locos[6]));
});

test('changes from another device are applied; a loco with an unsent local edit is left alone', () => {
  const a = seedState();
  const theirs = L.reduce(a, { type: 'save', loco: { ...a.locos[0], location: 'CDG' }, now: now(), by: 'sita' });
  const rows = serverRows(diffOps(a, theirs, 'sita'), 'locos');
  assert.equal(applyRemote(a, 'locos', rows).locos[0].location, 'CDG');
  assert.equal(applyRemote(a, 'locos', rows).locos[0].updatedBy, 'sita');
  assert.equal(applyRemote(a, 'locos', rows, new Set([a.locos[0].id])), a);
});

test('a move on one device reorders the list on another', () => {
  const a = seedState();
  const moved = L.reduce(a, { type: 'move', id: a.locos[10].id, dir: -1 });
  const b = applyRemote(a, 'locos', serverRows(diffOps(a, moved, 'x'), 'locos'));
  assert.deepEqual(b.locos.map((l) => l.id), moved.locos.map((l) => l.id));
});

test('saved reports sync, including deletion', () => {
  const a = seedState();
  const report = { id: 'r1', at: now(), day: '2026-10-10', by: 'ravi', locos: a.locos };
  const withReport = L.reduce(a, { type: 'addReport', report });
  const add = diffOps(a, withReport, 'ravi');
  assert.deepEqual(add.map((o) => [o.table, o.row.deleted]), [['reports', false]]);
  const b = applyRemote(a, 'reports', serverRows(add, 'reports'));
  assert.equal(b.reports[0].by, 'ravi');
  const del = diffOps(withReport, L.reduce(withReport, { type: 'removeReport', id: 'r1' }), 'ravi');
  assert.equal(applyRemote(b, 'reports', serverRows(del, 'reports')).reports.length, 0);
});

test('collapse keeps only the latest queued row per record', () => {
  const ops = [
    { table: 'locos', row: { id: 'a', v: 1 } },
    { table: 'log', row: { id: 'a', v: 1 } },
    { table: 'locos', row: { id: 'a', v: 2 } },
  ];
  assert.deepEqual(collapse(ops).map((o) => [o.table, o.row.v]), [['log', 1], ['locos', 2]]);
});
