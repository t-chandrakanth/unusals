import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, baseName, routeOf, standing, entryText, cafPosition, cafText, count, originOf, ocrToRows } from '../js/caf.js';

const HEAD = 'S.NO\tTRAIN NO\tEX\t"DEST\nZONE"\t"TO / RL time\nDate"\tHOR\t"KM Left"\tStock\tLOCO\t"COA\nName"\t"LOCAT\nION"\tS.NO\t"H/O\n-TIME"\tREMARKS';
const SHEET = [
  HEAD,
  '1\tMFSG\tGGPP\tCR\t20:10 19/10\t10:15\t9.51\tN/L\t33425+43187\tMFSG/X\tMAGH\tArr\t05:17 20-10\t',
  '9\tSOP-42 CAF JBP\tBZA\tNR\t05:20 19/10\t25:05\t97.7\tJ/L\t65173\tSOP/REDARR\tRECH\tArr\t23:25 19-10\t',
  '11\tRBL-42 CAF JBP STB\tBZA\tNR\t17:42 15/10\t108:43\t18.12\tJ/L\t23677+23754\tRBL/PR/BTTR\tVHGN\tArr\t22:17 16-10\tSTB RTM',
  '12\tGAR/BZU-42 CAF NP NGP\tUTCG\tWCR\t11:20 18/10\t43:05\t\tJ/L\t31874+41929\t\t\t\t\tW/FOR CREW',
  '13\tJSLK CAF\tMNSM\tSECR\t17:50 18/10\t41:03\t\tJ/L\t43845\t\tMAGH\t\t\t',
  '14\tFN-1 JHS NEXT TO BV\tBZA\tNR\t12:28 19/10\t17:57\t97.7\tNMG\t44135\t\tRECH\tDep\t05:54 20-10\t',
  '15\tHSPG/BFNV CAF JSGR\tHYB\tSER\t07:05 19/10\t23:20\t127.84\tS/E\t44342\t\tMCI\tDep\t05:43 20-10\t',
  'BLOCK BPQ-CAF INCLUDING UP YARD FROM 03:15 TO 06:45/ 06:50',
  'CAF = 07',
].join('\n');

test('the trains of a pasted sheet are read by their headings, the second S.NO being Arr / Dep; notes below the table are not trains', () => {
  const t = parseSheet(SHEET);
  assert.equal(t.length, 7);
  assert.deepEqual(t[2], { train: 'RBL-42 CAF JBP STB', ex: 'BZA', zone: 'NR', loco: '23677+23754', location: 'VHGN', status: 'Arr', hoTime: '22:17 16-10', remarks: 'STB RTM' });
});

const LOOKUP = {
  stations: { HSPG: ['Hospet', 'Karnataka', 'SWR'], SIC: ['Sonik', '', ''], ZZZ: ['Zed', 'Goa', ''] },
  own: { HACG: ['DHN', 'Uttar Pradesh'] },
};

test('only CAF bound trains, in the column of their route, each with the bracket and state its name has always had', () => {
  const p = cafPosition(SHEET, LOOKUP);
  assert.deepEqual(p.jbp, ['SOP (LKO) Uttar Pradesh RECH Arr 23:25 19-10', 'RBL (LOK) Uttar Pradesh VHGN Arr 22:17 16-10']);
  assert.deepEqual(p.caf, ['GAR/BZU (NAG) Madhya Pradesh AT UTCG', 'JSLK (BSP) Chattisgarh AT MAGH']);
  assert.deepEqual(p.jsg, ['HSPG/BFNV (SWR) Karnataka MCI Dep 05:43 20-10']);
  assert.equal(count(p), 5);
  assert.deepEqual(p.unknown, []);
});

test('the bracket and state of a name: own lines, then the known ones, then the station list; any part of the name may be it', () => {
  assert.deepEqual(originOf('RBL', LOOKUP), { code: 'RBL', bracket: 'LOK', state: 'Uttar Pradesh' });
  assert.deepEqual(originOf('HACG', LOOKUP), { code: 'HACG', bracket: 'DHN', state: 'Uttar Pradesh' });
  assert.deepEqual(originOf('NTV NMG', LOOKUP), { code: 'NTV', bracket: 'LJN', state: 'Uttar Pradesh' });
  assert.equal(originOf('QQQ/GAR', LOOKUP).bracket, 'NAG');
  assert.equal(originOf('BIA 20RP', LOOKUP).state, 'Chattisgarh');
  // not known by the message: the station list gives the state, and the zone for the bracket
  assert.deepEqual(originOf('HSPG', LOOKUP), { code: 'HSPG', station: 'Hospet', state: 'Karnataka', bracket: 'SWR' });
  assert.equal(originOf('ZZZ', LOOKUP).bracket, 'KR');
  assert.equal(originOf('QQQ', LOOKUP), null);
});

test('names, routes and positions', () => {
  assert.equal(baseName('CPC/SIC-42 CAF, JBP'), 'CPC/SIC');
  assert.equal(baseName('RBL-42-1 CAF JBP STB'), 'RBL');
  assert.equal(routeOf({ train: 'X CAF JBP' }), 'jbp');
  assert.equal(routeOf({ train: 'X CAF JSGR' }), 'jsg');
  assert.equal(routeOf({ train: 'X CAF' }), 'caf');
  assert.equal(standing({ location: 'wirr', status: 'arr', hoTime: '02:47 19-10', ex: 'BZA' }), 'WIRR Arr 02:47 19-10');
  assert.equal(standing({ location: '', status: '', hoTime: '03:40', ex: 'BZA' }), 'H/O 03:40');
  assert.equal(standing({ location: '', status: '', hoTime: '', ex: 'utcg' }), 'AT UTCG');
  assert.match(entryText({ train: 'ABC CAF', location: '', status: '', hoTime: '', ex: 'BZA' }), /^ABC \(\?\) AT BZA$/);
});

test('rows pasted without headings are read in the usual column order; the text for WhatsApp', () => {
  const t = parseSheet('9\tSOP-42 CAF JBP\tBZA\tNR\t05:20 19/10\t25:05\t97.7\tJ/L\t65173\tSOP/REDARR\tRECH\tArr\t23:25 19-10\t');
  assert.equal(t[0].location, 'RECH');
  assert.equal(t[0].hoTime, '23:25 19-10');
  const text = cafText('TODAY', '19-10-2026', cafPosition(SHEET, LOOKUP));
  assert.match(text, /^\*TODAY -05- CAF BOUND TRAINS 19-10-2026\*/);
  assert.match(text, /\*VIA CAF, JBP\*\n1\. SOP \(LKO\) Uttar Pradesh RECH Arr 23:25 19-10/);
});

test('a picture of the sheet, read as lines of text, gives the CAF trains in the sheet columns', () => {
  const ocr = [
    'S.NO TRAIN NO EX DEST ZONE',
    '9 SOP-42 CAF JBP BZA NR 05:20 19/10 25:05 97.7 J/L 65173 SOP/REDARR RECH Arr 23:25 19-10',
    '11 RBL-42 CAF JBP STB BZA NR 17:42 15/10 108:43 18.12 J/L 23677 VHGN Arr 22:17 16-10 STB RTM',
    '12 GAR/BZU-42 CAF NP NGP UTCG WCR 11:20 18/10 43:05 J/L 31874',
    'BLOCK BPQ-CAF INCLUDING UP YARD FROM 03:15 TO 06:45',
    '1 MFSG GGPP CR 20:10 19/10',
  ].join('\n');
  const rows = parseSheet(ocrToRows(ocr));
  assert.deepEqual(rows.map((r) => r.train), ['SOP-42 CAF JBP', 'RBL-42 CAF JBP STB', 'GAR/BZU-42 CAF NP NGP']);
  assert.deepEqual([rows[0].location, rows[0].status, rows[0].hoTime], ['RECH', 'Arr', '23:25 19-10']);
  assert.deepEqual([rows[1].location, rows[1].status, rows[1].hoTime], ['VHGN', 'Arr', '22:17 16-10']);
  assert.equal(rows[2].location, '');
  assert.equal(ocrToRows('nothing here'), '');
});

test("a picture's rows under a heading of their own are read with that heading, after a pasted table with another", () => {
  const both = SHEET + '\n' + ocrToRows('3 DEOS CAF BZA NR 1 MCI Dep 05:43 20-10');
  const rows = parseSheet(both);
  const deos = rows.find((r) => r.train.startsWith('DEOS'));
  assert.deepEqual([deos.location, deos.status, deos.hoTime], ['MCI', 'Dep', '05:43 20-10']);
  assert.equal(rows.find((r) => r.train.startsWith('SOP')).location, 'RECH');
});
