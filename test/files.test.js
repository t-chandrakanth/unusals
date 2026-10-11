import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks } from '../js/official.js';
import { xlsxToText, fixLigatures } from '../js/filetext.js';
import { sheetToXlsx } from '../js/xlsx.js';
import { unusualSheet } from '../js/sheet.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importUnusuals } from '../js/unusualimport.js';
import { seedState } from '../js/seed.js';

const all = importUnusuals(seedState(), UNUSUAL_RECORDS).unusuals;

test('an Excel file made by this app reads back as the same 12 reports', async () => {
  const bytes = sheetToXlsx(unusualSheet(all));
  const text = await xlsxToText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.match(text, /UNUSALS-DATE-01-08-2026/);
  const blocks = parseBlocks(text);
  assert.equal(blocks.length, 12);
  const sorted = [...all].sort((a, b) => a.day.localeCompare(b.day) || (a.time || '').localeCompare(b.time || ''));
  blocks.forEach((b, i) => {
    const u = sorted[i];
    assert.equal(b.day, u.day);
    assert.equal(b.title, u.title);
    assert.equal(b.location, u.location);
    assert.equal(b.trainNo, u.trainNo);
    assert.equal(b.locoNo, u.locoNo);
    assert.equal(b.load, u.load);
    assert.equal(b.det, u.det);
    assert.equal(b.rep, u.rep);
    assert.equal(b.reason.replace(/\s+/g, ' '), u.reason.replace(/\s+/g, ' '));
  });
});

test('a single block typed or pasted as text gives one report', () => {
  const text = `UNUSALS-DATE-06-10-2026
1\tTRAIN DETAILS\tLOCO TROUBLE-DPWCS
\tLOCATION\tPRLI
\tTRAIN NO\tKSNK
\tLOCO NO\t27592+27767/KZJ/11/11
\tREASON\tPRLI ARR:07:00 IN MU  MODE..MADE MU READY AT 11:30
\tDET\t`;
  const [b] = parseBlocks(text);
  assert.equal(b.day, '2026-10-06');
  assert.equal(b.title, 'LOCO TROUBLE-DPWCS');
  assert.equal(b.trainNo, 'KSNK');
  assert.equal(b.locoNo, '27592+27767/KZJ/11/11');
  assert.equal(b.det, '');
});

test('a PDF whose dates come after the blocks still pairs them in order', () => {
  const text = `1 TRAIN DETAILS STALLED DUE TO LOCO PROBLEM LOCATION PRLI-GTU TRAIN NO KSNK/BOXNL LOCO NO 28665+28747 REASON Train stalled at KM 3 DET 02:37 HRS
2 TRAIN DETAILS LOCO FAILED LOCATION GOSG TRAIN NO TTGR LOCO NO 28411+27609 REASON relief loco arrived DET 05:00 HRS
DATE-11-09-2026
DATE-30-09-2026`;
  const out = parseBlocks(text);
  assert.deepEqual(out.map((b) => b.day), ['2026-09-11', '2026-09-30']);
  assert.equal(out[0].det, '02:37 HRS');
  assert.equal(out[1].title, 'LOCO FAILED');
});

test('text with no reports in it gives nothing', () => {
  assert.deepEqual(parseBlocks('just some words'), []);
  assert.deepEqual(parseBlocks(''), []);
});

test('a PDF month sheet with split labels and a wrapped reason is read', () => {
  const text = `DATE-07-09-2026
TRAIN
1 STALLED DUE TO TRAILING LOCO PROBLEM
DETAILS
LOCATION DRR-GDQ
TRAIN NO UTCP/BOXNL
LOCO NO 28073+28526/KZJ/DUE-11/10
DRR THROUGH AT 08:04 HRS STOPPED B/W DRR-GDQ
REASON
AT 08:19 HRS AND DRR ARR AT 08:34 HRS
DET 06:39 HRS
DATE-11-09-2026
TRAIN
2 STALLED DUE TO LOCO PROBLEM
DETAILS
LOCATION PRLI-GTU
TRAIN NO KSNK/BOXNL
LOCO NO 28665+28747/KZJ/DUE-05/11
REASON Train PRLI DEP-02:38
DET 02:37 HRS`;
  const out = parseBlocks(text);
  assert.equal(out.length, 2);
  assert.equal(out[0].day, '2026-09-07');
  assert.equal(out[0].title, 'STALLED DUE TO TRAILING LOCO PROBLEM');
  assert.equal(out[0].locoNo, '28073+28526/KZJ/DUE-11/10');
  assert.equal(out[0].reason, 'DRR THROUGH AT 08:04 HRS STOPPED B/W DRR-GDQ\nAT 08:19 HRS AND DRR ARR AT 08:34 HRS');
  assert.equal(out[0].det, '06:39 HRS');
  assert.equal(out[1].day, '2026-09-11');
  assert.equal(out[1].reason, 'Train PRLI DEP-02:38');
});

test('letters the Sr.DEE PDF drops are put back', () => {
  const bad = 'Failed Sec � on/Div/Zone Mul � Loco Train le � LTRR crea � ng A � er 10 Deten � on (minutes)';
  assert.equal(fixLigatures(bad), 'Failed Section/Div/Zone Multi Loco Train left LTRR creating After 10 Detention (minutes)');
});
