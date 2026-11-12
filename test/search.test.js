import test from 'node:test';
import assert from 'node:assert/strict';
import { searchReports, reportHaystack, queryWords } from '../js/search.js';

const list = [
  { id: 1, day: '2026-10-12', title: 'METAL ON TYRE', trainNo: 'KPCC', locoNo: '60529', location: 'VKB-GDQ', reason: '21:04 Dep VKB', rep: 'KSNK -CT STN- ARR: 15:30' },
  { id: 2, day: '2026-11-12', title: 'LOCO FAILED', trainNo: 'MSIR', locoNo: '43578', location: 'GDQ-VKB', reason: '', stalling: JSON.stringify({ trainNo: 'MSIR', cause: 'Loco unable to haul the load', loadImg: 'data:image/jpeg;base64,AAAAGDQAAAA', events: [{ t: '14:26', text: '16594 VKB arrival' }] }), type: 'stalling' },
  { id: 3, day: '2026-09-01', title: 'HOT AXLE', trainNo: 'ABC', locoNo: '1', location: 'TDU', reason: 'fire in formation', block: JSON.stringify({ name: 'BCM BLOCK', rows: [{ tr: 'PSNH', at: 'CT' }] }), type: 'block' },
];

test('a search finds a train, loco, location or word, in any case, newest day first', () => {
  assert.deepEqual(searchReports(list, 'kpcc').map((u) => u.id), [1]);
  assert.deepEqual(searchReports(list, '43578').map((u) => u.id), [2]);
  assert.deepEqual(searchReports(list, 'gdq').map((u) => u.id), [2, 1]);
  assert.deepEqual(searchReports(list, 'FIRE').map((u) => u.id), [3]);
  assert.deepEqual(searchReports(list, '').map((u) => u.id), []);
  assert.deepEqual(searchReports(list, '   ').map((u) => u.id), []);
});

test('every word has to be there; the date can be searched as written on the report', () => {
  assert.deepEqual(searchReports(list, 'vkb tyre').map((u) => u.id), [1]);
  assert.deepEqual(searchReports(list, 'vkb zzz').map((u) => u.id), []);
  assert.deepEqual(searchReports(list, '12-11-2026').map((u) => u.id), [2]);
  assert.deepEqual(queryWords('  Loco  FAILED '), ['loco', 'failed']);
});

test('the stalling, block and repercussion words are searched; picture data is not', () => {
  assert.deepEqual(searchReports(list, 'unable to haul').map((u) => u.id), [2]);
  assert.deepEqual(searchReports(list, '16594').map((u) => u.id), [2]);
  assert.deepEqual(searchReports(list, 'psnh').map((u) => u.id), [3]);
  assert.deepEqual(searchReports(list, 'ksnk').map((u) => u.id), [1]);
  assert.ok(!reportHaystack(list[1]).includes('aaaa'));
});
