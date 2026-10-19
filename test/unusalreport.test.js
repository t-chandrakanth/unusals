import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, splitRepercussions, photosOf, reportFile } from '../js/unusalreport.js';
import { buildPdfPages } from '../js/pdf.js';

const u = {
  day: '2026-10-12', title: 'Metal on tyre', trainNo: 'kpcc', locoNo: '60529', load: '60/60', location: 'VKB-GDQ', wagonNo: 'SECR 12140893411', bpcNo: '5000', det: '17 MINS',
  reason: '21:04 Dep VKB\n21:08 Train stopped at KM 111/01\n21:15 Informed to Engg', rep: '1. 17030 - VKB ARR 22:47\n2. YTPY - VKB ARR 21:37',
};

test('a record becomes the page: heading, details, events, remarks, repercussions', () => {
  const m = reportModel(u);
  assert.equal(m.title, 'METAL ON TYRE REPORT – TRAIN KPCC');
  assert.deepEqual(m.details.find((r) => r[0] === 'Defective wagon'), ['Defective wagon', 'SECR 12140893411', true]);
  assert.equal(m.events.length, 3);
  assert.equal(m.events[1].hl, true);
  assert.match(m.remarks, /Train stopped at KM 111\/01 at 21:08\./);
  assert.deepEqual(m.repercussions, [{ tr: '17030 - VKB', arr: '22:47', dep: '', det: '', still: false }, { tr: 'YTPY - VKB', arr: '21:37', dep: '', det: '', still: false }]);
  assert.equal(reportFile(u), 'Unusal-12-10-2026-kpcc');
});

test('a plain reason with no times is the remarks, with no events table', () => {
  const m = reportModel({ ...u, reason: 'Loco failed due to traction motor flashover', rep: '' });
  assert.equal(m.events.length, 0);
  assert.equal(m.remarks, 'Loco failed due to traction motor flashover');
  assert.equal(m.repercussions.length, 0);
});

test('repercussions split by line, by number or by semicolon', () => {
  assert.deepEqual(splitRepercussions('1. A 2. B'), ['A', 'B']);
  assert.deepEqual(splitRepercussions('A; B'), ['A', 'B']);
  assert.deepEqual(splitRepercussions(''), []);
});

test('photos are read from the saved list, and bad data is ignored', () => {
  assert.deepEqual(photosOf({ photos: JSON.stringify(['data:image/jpeg;base64,AAAA', 'x']) }), ['data:image/jpeg;base64,AAAA']);
  assert.deepEqual(photosOf({ photos: 'junk' }), []);
});

test('a PDF of several pages has one page object and a right table of offsets for each', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const pdf = buildPdfPages([{ jpeg, w: 100, h: 200 }, { jpeg, w: 100, h: 200 }, { jpeg, w: 100, h: 200 }]);
  const s = new TextDecoder('latin1').decode(pdf);
  assert.match(s, /\/Count 3/);
  const xrefAt = Number(/startxref\n(\d+)/.exec(s)[1]);
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((x) => Number(x[1]));
  assert.equal(entries.length, 11);
  entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});
