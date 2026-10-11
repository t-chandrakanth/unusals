import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { seedState } from '../js/seed.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importDpwcs, dpwcsSeeded } from '../js/unusualimport.js';
import { diffOps, applyRemote } from '../js/syncdata.js';

test('the DPWCS loco failures are loaded as a list of their own, once', () => {
  const a = importDpwcs(seedState(), UNUSUAL_RECORDS);
  assert.equal(a.unusuals.length, 12);
  assert.ok(a.unusuals.every((u) => u.app === 'dpwcs' && u.type === 'loco' && u.id.startsWith('dpw-')));
  assert.ok(dpwcsSeeded(a));
  assert.equal(importDpwcs(a, UNUSUAL_RECORDS), a);
  assert.equal(new Set(a.unusuals.map((u) => u.id)).size, 12);
});

test('a report written in the DPWCS tab keeps its tag through saving and syncing', () => {
  const s0 = seedState();
  const u = { ...L.blankUnusual('2026-10-12'), title: 'LOCO TROUBLE-DPWCS', trainNo: 'KSNK', app: 'dpwcs' };
  const s1 = L.reduce(s0, { type: 'saveUnusual', unusual: u, now: new Date().toISOString(), by: 'x' });
  assert.equal(s1.unusuals[0].app, 'dpwcs');
  const ops = diffOps(s0, s1, 'x');
  assert.equal(ops[0].row.data.app, 'dpwcs');
  const other = applyRemote(L.emptyState(), 'unusuals', ops.map((o) => ({ ...o.row, synced_at: 'x' })));
  assert.equal(other.unusuals[0].app, 'dpwcs');
});

test('the two lists are told apart by the tag', () => {
  const mix = [{ id: 'a', app: 'dpwcs' }, { id: 'b', app: '' }, { id: 'c' }];
  assert.deepEqual(mix.filter((u) => u.app === 'dpwcs').map((u) => u.id), ['a']);
  assert.deepEqual(mix.filter((u) => u.app !== 'dpwcs').map((u) => u.id), ['b', 'c']);
});
