import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceStart } from '../js/uppercase.js';

test('a capital at the start of each sentence and line; every other letter stays as typed', () => {
  assert.equal(sentenceStart('brake binding at kzj'), 'Brake binding at kzj');
  assert.equal(sentenceStart('brake binding at KZJ. relief loco asked! ok? yes'), 'Brake binding at KZJ. Relief loco asked! Ok? Yes');
  assert.equal(sentenceStart('KPCC stalled at GDQ'), 'KPCC stalled at GDQ');
  assert.equal(sentenceStart('line one\nline two'), 'Line one\nLine two');
  assert.equal(sentenceStart('crew on duty@mlyg at 12.30 hrs'), 'Crew on duty@mlyg at 12.30 hrs');
  assert.equal(sentenceStart('already Fine'), 'Already Fine');
  assert.equal(sentenceStart(''), '');
});
