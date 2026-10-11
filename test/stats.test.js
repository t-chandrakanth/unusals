import test from 'node:test';
import assert from 'node:assert/strict';
import { detMinutes, fmtMinutes, locoNumbers, topCounts, repeatLocos, lastDays, longestDetentions, addDays } from '../unusual/stats.js';

test('detention is read in the ways it is written', () => {
  assert.equal(detMinutes('06:39 HRS'), 399);
  assert.equal(detMinutes('4 HRS'), 240);
  assert.equal(detMinutes('04 HRS:19 MINTS'), 259);
  assert.equal(detMinutes('55 MINTS'), 55);
  assert.equal(detMinutes('AT GNN 03:20 HRS'), 200);
  assert.equal(detMinutes(''), 0);
  assert.equal(detMinutes('TICD REGULATED FOR WEIGHMENT'), 0);
  assert.equal(fmtMinutes(399), '6 h 39 m');
  assert.equal(fmtMinutes(45), '45 m');
});

test('loco numbers are picked out of a loco no', () => {
  assert.deepEqual(locoNumbers('27592+27767/KZJ/DUE-11/11'), ['27592', '27767']);
  assert.deepEqual(locoNumbers('32190 MLY/30/04+ 42464 (DEAD)'), ['32190', '42464']);
  assert.deepEqual(locoNumbers(''), []);
});

test('repeat locos and top counts', () => {
  const list = [
    { day: '2026-10-01', locoNo: '27592+27767', location: 'KZJ' },
    { day: '2026-10-05', locoNo: '27592+11111', location: 'KZJ' },
    { day: '2026-09-01', locoNo: '27767', location: 'PRLI' },
    { day: '2026-06-01', locoNo: '27592', location: 'KZJ' },
  ];
  const rep = repeatLocos(list, '2026-09-01');
  assert.deepEqual(rep.map((r) => [r.loco, r.count, r.last]), [['27592', 2, '2026-10-05'], ['27767', 2, '2026-10-01']]);
  assert.deepEqual(topCounts(list, (u) => [u.location], 2), [['KZJ', 3], ['PRLI', 1]]);
});

test('the last days chart and the longest detentions', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  const list = [{ day: '2026-10-12', type: 'cw', det: '1 HRS' }, { day: '2026-10-12', det: '02:00 HRS' }, { day: '2026-10-10' }];
  const kind = (u) => u.type || 'loco';
  const days = lastDays(list, 3, '2026-10-12', kind);
  assert.deepEqual(days.map((d) => [d.day, d.loco, d.cw]), [['2026-10-10', 1, 0], ['2026-10-11', 0, 0], ['2026-10-12', 1, 1]]);
  assert.deepEqual(longestDetentions(list).map((x) => x.min), [120, 60]);
});
