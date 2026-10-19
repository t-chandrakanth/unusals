import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents, formatEvents } from '../js/events.js';

test('a line that starts with a time becomes a time and what happened', () => {
  assert.deepEqual(parseEvents('19:06 Loco stalled at km 478/01'), [{ t: '19:06', text: 'Loco stalled at km 478/01' }]);
  assert.deepEqual(parseEvents('19:06–19:27 Backed up, but did not start'), [{ t: '19:06–19:27', text: 'Backed up, but did not start' }]);
  assert.deepEqual(parseEvents('20.46 Relief loco arrived'), [{ t: '20.46', text: 'Relief loco arrived' }]);
  assert.deepEqual(parseEvents('08:30 HRS Train left'), [{ t: '08:30 HRS', text: 'Train left' }]);
  assert.deepEqual(parseEvents('15:43 - LE arrived spot'), [{ t: '15:43', text: 'LE arrived spot' }]);
});

test('a line without a time, a time alone, and blank lines', () => {
  assert.deepEqual(parseEvents('Relief loco asked\n\n   \n20:46'), [{ t: '', text: 'Relief loco asked' }, { t: '20:46', text: '' }]);
  assert.deepEqual(parseEvents(''), []);
  assert.deepEqual(parseEvents(null), []);
});

test('an older reason written as a paragraph stays one row', () => {
  const old = 'PRLI ARR:07:00 IN MU  MODE..AFTER PRLI ARR TRIED TO MAKE DPWCS MODE';
  assert.deepEqual(parseEvents(old), [{ t: '', text: old }]);
});

test('rows go back to text, one event to a line, empty rows dropped', () => {
  const rows = [{ t: '19:06', text: 'Loco stalled' }, { t: '', text: '' }, { t: '', text: 'Relief loco asked' }, { t: '20:46', text: '' }];
  assert.equal(formatEvents(rows), '19:06 Loco stalled\nRelief loco asked\n20:46');
});

test('text survives a round trip', () => {
  const text = '19:06 Loco stalled at km 478/01\n19:06–19:27 Backed up\nRelief loco asked\n20:46 Relief loco arrived';
  assert.equal(formatEvents(parseEvents(text)), text);
});
