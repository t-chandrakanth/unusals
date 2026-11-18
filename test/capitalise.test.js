import test from 'node:test';
import assert from 'node:assert/strict';
import { capitaliseUnusual } from '../js/capitalise.js';

test('a saved report gets the sentence-style capitals in its boxes; the other letters are left as they were', () => {
  const u = { id: 'a', day: '2026-10-12', title: 'brake binding', location: 'tngm-yp/gnn', trainNo: 'KPCC', reason: '21:04 vkb dep\nrelief loco asked. ok', rep: 'ksnk arr 15:30', photos: '["data:image/jpeg;base64,AAAA"]' };
  const c = capitaliseUnusual(u);
  assert.equal(c.title, 'Brake binding');
  assert.equal(c.location, 'Tngm-yp/gnn');
  assert.equal(c.trainNo, 'KPCC');
  assert.equal(c.reason, '21:04 vkb dep\nRelief loco asked. Ok');
  assert.equal(c.rep, 'Ksnk arr 15:30');
  assert.equal(c.photos, u.photos);
  assert.equal(c.day, '2026-10-12');
});

test('a report that is already in the style gives nothing to save, so it is saved once and then left alone', () => {
  const u = { id: 'a', title: 'Brake binding', reason: 'KPCC STALLED AT GDQ' };
  assert.equal(capitaliseUnusual(u), null);
  const once = capitaliseUnusual({ id: 'b', title: 'hot axle' });
  assert.equal(capitaliseUnusual(once), null);
});

test('the stalling and block reports kept inside a record are done too, without touching pictures', () => {
  const stalling = JSON.stringify({ trainNo: 'msir', cause: 'loco unable to haul', events: [{ t: '14:26', text: 'le dep from vkb' }], loadImg: 'data:image/png;base64,abc. def' });
  const block = JSON.stringify({ name: 'bcm block', rows: [{ tr: 'psnh', at: 'ct' }] });
  const c = capitaliseUnusual({ id: 'c', type: 'stalling', stalling, block });
  const s = JSON.parse(c.stalling);
  assert.equal(s.trainNo, 'Msir');
  assert.equal(s.events[0].text, 'Le dep from vkb');
  assert.equal(s.events[0].t, '14:26');
  assert.equal(s.loadImg, 'data:image/png;base64,abc. def');
  assert.equal(JSON.parse(c.block).rows[0].tr, 'Psnh');
  assert.equal(capitaliseUnusual({ id: 'd', stalling: 'not json' }), null);
});
