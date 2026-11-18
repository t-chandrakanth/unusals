import test from 'node:test';
import assert from 'node:assert/strict';
import { firstLetters } from '../js/uppercase.js';

test('each word starts with a capital; the other letters are left as typed', () => {
  assert.equal(firstLetters('brake binding at kzj'), 'Brake Binding At Kzj');
  assert.equal(firstLetters('KPCC stalled at GDQ'), 'KPCC Stalled At GDQ');
  assert.equal(firstLetters('crew on duty@mlyg'), 'Crew On Duty@Mlyg');
  assert.equal(firstLetters('km no-01/07(bv)'), 'Km No-01/07(Bv)');
  assert.equal(firstLetters('line one\nline two'), 'Line One\nLine Two');
  assert.equal(firstLetters('already Fine'), 'Already Fine');
  assert.equal(firstLetters(''), '');
});
