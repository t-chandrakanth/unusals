import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, baseName, routeOf, standing, entryText, cafPosition, cafText, count, originOf } from '../js/caf.js';

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
].join('\n');

test('the trains of a pasted sheet are read by their headings, the second S.NO being Arr / Dep', () => {
  const t = parseSheet(SHEET);
  assert.equal(t.length, 7);
  assert.deepEqual(t[2], { train: 'RBL-42 CAF JBP STB', ex: 'BZA', zone: 'NR', loco: '23677+23754', location: 'VHGN', status: 'Arr', hoTime: '22:17 16-10', remarks: 'STB RTM' });
});

const LOOKUP = {
  stations: {
    SOP: ['Shiupur', '', ''], RBL: ['Rae Bareli Junction', 'Uttar Pradesh', ''], GAR: ['Gadarwara', 'Madhya Pradesh', 'WCR'], BZU: ['Betul', 'Madhya Pradesh', ''],
    HSPG: ['Hspg', 'Karnataka', 'SWR'],
  },
  own: { SOP: ['NR', 'Uttar Pradesh'] },
};

test('only CAF bound trains, in the column of their route, each with the zone and state of the station in its name', () => {
  const p = cafPosition(SHEET, LOOKUP);
  assert.deepEqual(p.jbp, ['SOP (NR) Uttar Pradesh RECH Arr 23:25 19-10', 'RBL (NR) Uttar Pradesh VHGN Arr 22:17 16-10']);
  assert.deepEqual(p.caf, ['GAR/BZU (WCR) Madhya Pradesh AT UTCG', 'JSLK (?) AT MAGH']);
  assert.deepEqual(p.jsg, ['HSPG/BFNV (SWR) Karnataka MCI Dep 05:43 20-10']);
  assert.equal(count(p), 5);
  assert.deepEqual(p.unknown, ['JSLK']);
});

test('the zone and state of a name: own lines first, a station with no zone gets the usual zone of its state, any part of the name may be the station', () => {
  assert.deepEqual(originOf('RBL', LOOKUP), { code: 'RBL', station: 'Rae Bareli Junction', state: 'Uttar Pradesh', zone: 'NR' });
  assert.deepEqual(originOf('SOP', LOOKUP), { code: 'SOP', zone: 'NR', state: 'Uttar Pradesh' });
  assert.equal(originOf('ZZZ/GAR', LOOKUP).zone, 'WCR');
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
  assert.match(text, /\*VIA CAF, JBP\*\n1\. SOP \(NR\) Uttar Pradesh RECH Arr 23:25 19-10/);
});

test('a name of two words is read word by word as well as by its slashes', () => {
  const lk = { stations: { NTV: ['Nautanwa', 'Uttar Pradesh', ''] } };
  assert.equal(originOf('NTV NMG', lk).state, 'Uttar Pradesh');
  assert.equal(originOf('NMG NTV', lk).zone, 'NR');
});
