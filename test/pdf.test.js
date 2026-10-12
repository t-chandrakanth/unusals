import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../js/pdf.js';

test('a one-page PDF with the picture, whose table of offsets is right', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const pdf = buildPdf(jpeg, 800, 1000);
  const s = new TextDecoder('latin1').decode(pdf);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  // every object starts exactly where the xref table says
  const xrefAt = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(xrefAt).startsWith('xref'));
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entries.length, 5);
  entries.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  // the picture bytes are inside, whole
  const at = s.indexOf('stream\n', s.indexOf('/DCTDecode')) + 7;
  assert.deepEqual([...pdf.slice(at, at + jpeg.length)], [...jpeg]);
  assert.match(s, /\/Length 11 >>/);
  // it fits the page: a tall picture is scaled down to the page height
  const cm = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(s);
  assert.ok(Number(cm[2]) <= 842 - 56 + 0.01);
});
