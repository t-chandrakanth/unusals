import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySummary, shortReason, officialDay } from '../js/summary.js';

const list = [
  { day: '2026-10-12', type: 'loco', title: 'LOCO FAILED', location: 'KZJ', trainNo: 'KPCC', locoNo: '38756+37410', det: '02:45 HRS', reason: 'Loco failed at 10:15.\nRelief loco arrived 12:00, train started 12:40 and ran on without further trouble to the next station.', updatedAt: '2026-10-12T05:00:00Z' },
  { day: '2026-10-12', type: 'cw', title: 'HOT AXLE', location: 'DKJ', trainNo: 'MLSW/BOXNL', reason: 'Wagon detached.', updatedAt: '2026-10-12T06:00:00Z' },
  { day: '2026-10-12', title: 'LOCO TROUBLE-DPWCS', location: 'PRLI', updatedAt: '2026-10-12T04:00:00Z' },
  { day: '2026-10-11', type: 'loco', title: 'OTHER DAY' },
];

test('the officially written day', () => {
  assert.equal(officialDay('2026-10-12'), '12-10-2026 (MONDAY)');
});

test('a long reason is cut at a word, on one line', () => {
  const s = shortReason('word '.repeat(60));
  assert.ok(s.endsWith('...'));
  assert.ok(s.length <= 114);
  assert.ok(!s.includes('\n'));
  assert.equal(shortReason('short one'), 'short one');
});

test('the summary of a day has counts, groups and short lines', () => {
  const text = dailySummary(list, '2026-10-12', { title: 'SCR UNUSALS' });
  const lines = text.split('\n');
  assert.equal(lines[0], '*SCR UNUSALS: DAILY REPORT*');
  assert.equal(lines[1], '12-10-2026 (MONDAY)');
  assert.match(text, /\*Total: 3\*  \(loco failures 2, c&w failures 1\)/);
  assert.match(text, /\*LOCO FAILURES \(2\)\*\n1\. \*LOCO TROUBLE-DPWCS\*: PRLI\n2\. \*LOCO FAILED\*: KZJ \| Train KPCC \| Loco 38756\+37410 \| DET 02:45 HRS\n   Loco failed at 10:15\. Relief loco arrived 12:00/);
  assert.match(text, /\*C&W FAILURES \(1\)\*\n1\. \*HOT AXLE\*: DKJ \| Train MLSW\/BOXNL\n   Wagon detached\./);
  assert.doesNotMatch(text, /OTHER DAY/);
  assert.doesNotMatch(text, /OTHERS/);
});

test('a day with nothing says NIL', () => {
  assert.match(dailySummary(list, '2026-10-13'), /NIL: no unusual reports\./);
});

test('one group only: no breakdown in the total line', () => {
  const t = dailySummary([list[0]], '2026-10-12', { title: 'DPWCS LOCO FAILURES', groups: [['loco', 'LOCO FAILURES']] });
  assert.match(t, /\*Total: 1\*$/m);
});
