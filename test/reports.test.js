import test from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../js/xlsx.js';
import { docxToText } from '../js/filetext.js';
import { parseDetention, parseFIR, parseHotAxleForm, classifyReport } from '../js/official.js';
import { readReports, tidyBatch, reportKey, dayFromName } from '../js/reports.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const cell = (...ts) => `<w:tc>${ts.map(p).join('')}</w:tc>`;
const row = (...cells) => `<w:tr>${cells.join('')}</w:tr>`;
const docx = (body) => zip([
  { name: '[Content_Types].xml', text: '<Types/>' },
  { name: 'word/document.xml', text: `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` },
]);
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

test('a Word file is read as paragraphs and table rows', async () => {
  const body = p('Sir,') + p('*DETENTION PARTICULARS OF GOODS TRAIN NO. BOXNE AT RRPM DUE TO BRAKE BINDING*')
    + `<w:tbl>${row(cell('Division'), cell('SC'), cell('Train No'), cell('BOXNE'))}${row(cell('Notes'), cell('line one', 'line two'))}</w:tbl>`
    + `<w:p><w:r><w:t>A &amp; B</w:t></w:r><w:r><w:tab/><w:t>tabbed</w:t></w:r></w:p>`;
  const text = await docxToText(buf(docx(body)));
  assert.equal(text, 'Sir,\n*DETENTION PARTICULARS OF GOODS TRAIN NO. BOXNE AT RRPM DUE TO BRAKE BINDING*\nDivision\tSC\tTrain No\tBOXNE\nNotes\tline one\nline two\nA & B tabbed');
});

test('a file that is not Word is refused', async () => {
  await assert.rejects(() => docxToText(buf(zip([{ name: 'x.txt', text: 'hi' }]))), /Word/);
});

const NOTE = `Sir,
*DETENTION PARTICULARS OF GOODS TRAIN NO. BT SPL BETWEEN MIDP AND NZB DUE TO BRAKE BINDING*
Date : 10.10.2026
Train No: BT SPL
Loco No: 24637/G-7
BPC No: 50000949796/RDM/09.10.26/30 DAYS VALIDITY
Load : 15 BRN + 0
Station: MIDP-NZB
Section: PDPL-NZB
Ex: RDM
Commodity: EMPTY
Driver: RAJESH KUMAR/RDM
Guard: UDAY GUPTA/RDM/9063329051
*BRIEF DETAILS:*
11.41hrs: Train through MIDP station.
12.20hrs: Train departure from spot.
*WAGON DETAILS:*
ECR 67101265998 BRNEHS
RYPW: 01.08.2023, RDM: 09.10.2026, R/D: 3/28`;

test('the "AT ... DUE TO" note, with NO. and BETWEEN, is read', () => {
  const r = parseDetention(NOTE);
  assert.equal(r.title, 'BRAKE BINDING');
  assert.equal(r.day, '2026-10-10');
  assert.equal(r.location, 'MIDP-NZB');
  assert.equal(r.trainNo, 'BT SPL');
  assert.equal(r.locoNo, '24637/G-7');
  assert.equal(r.load, '15 BRN + 0');
  assert.equal(r.wagonNo, 'ECR 67101265998 BRNEHS');
  assert.match(r.reason, /^11:41 Train through MIDP station\.\n12:20 Train departure from spot\./);
  assert.match(r.reason, /Wagon details: RYPW: 01\.08\.2023/);
});

const ASSET = `ASSET FAILURE TRNO MLSW/BOXNL DUE TO HOT AXLE

Division\tSC\t\tTrain No\tMLSW/BOXNL
Date\t07.10.26\t\tENO &Load\t27161+27187/WAG7/KGP
Station\tDKJ\t\tSection\tMTMI-KZJ
Detention\t170”\t\tDRIVER\tRAVI SHANKAR/GALA
Commodity\tCOAL\t\tGUARD\tPRADEEP RAM/GALA (9063328962)
EX\tKSLK\t\tBPC No\t50000946064/UDL-ASN-ER/28.09.26/CC

Detention Particulars:
Detention\tStation\tDescription
170”\tDKJ\t*BRIEF HISTORY:*
Train while passing through KMT, hot axle reported.
15.30hrs: Train arrived DKJ.
*WAGON DETAILS:*
ECR 22100985063 BOXNHLL (18th from TE)`;

test('the "ASSET FAILURE" table is read, with detention in minutes', () => {
  const r = parseDetention(ASSET);
  assert.equal(r.title, 'HOT AXLE');
  assert.equal(r.day, '2026-10-07');
  assert.equal(r.trainNo, 'MLSW/BOXNL');
  assert.equal(r.locoNo, '27161+27187/WAG7/KGP');
  assert.equal(r.location, 'DKJ');
  assert.equal(r.det, '02:50 HRS');
  assert.equal(r.bpcNo, '50000946064/UDL-ASN-ER/28.09.26/CC');
  assert.equal(r.wagonNo, 'ECR 22100985063 BOXNHLL (18th from TE)');
  assert.match(r.reason, /15:30 Train arrived DKJ\./);
});

test('the First Information Report is read', () => {
  const fir = `*FORMAT – FIRST INFORMATION REPORT (UNUSUAL INCIDENT)*
1. INCIDENT AT A GLANCE (For Management View); YTPY BOXN COAL LOAD HOTAXLE AT MCI
Type of Unusual:
Accident / Derailment / Hot Axle / Train Parting  / Other: __HOTAXLE BOXN COAL LOAD_
Date & Time of Incident: 09/10.26/08.05 HRS
Train No. / Type:  (Single haul / Long haul); YTPY COAL LOAD
Loco No(s)/Type: _38733/38850/WAG9/BSP___
BPC No., Type, Date, Issuing Depot & Validity( indicate- Valid/Invalid)
500009400455/12.09.26/RMUY-VSPS/SCOR/12.09.26 VALID BPC
4. BRIEF DESCRIPTION OF INCIDENT (5–6 lines only)
(What happened, how detected, immediate impact)
Train coal loaded at MMZ siding.
09.04 hrs: Arrived MCI UD M/L, section cleared.
REP: TNO.12622
        TNO. 17036

*WAGON DETAILS:*
 WR 22082010319 BOXNHLL (08th from TE)
5. WAGON / VEHICLE DETAILS (If Applicable)
Total Load: _59+1__`;
  const r = parseFIR(fir);
  assert.equal(r.day, '2026-10-09');
  assert.equal(r.time, '08:05');
  assert.equal(r.title, 'HOT AXLE BOXN COAL LOAD');
  assert.equal(r.location, 'MCI');
  assert.equal(r.trainNo, 'YTPY COAL LOAD');
  assert.equal(r.locoNo, '38733/38850/WAG9/BSP');
  assert.equal(r.load, '59+1');
  assert.equal(r.wagonNo, 'WR 22082010319 BOXNHLL (08th from TE)');
  assert.equal(r.rep, 'TNO.12622, TNO. 17036');
  assert.match(r.reason, /^Train coal loaded at MMZ siding\.\n09:04 Arrived MCI/);
});

test('the Excel hot axle form is read before the generic asset layout', () => {
  const sheet = `Hot Axle(Wagon)
S.No\tDescription\tDetails
1\tDate\t26.04.25
4\tLocation  \tBG (BHONGIR)
6\tTrain No\tKPCC
7\tLoco No\t27593+28347/WAG5/KZJ
11\tWagon Details
\tWagon No.-\tSWR 22151180219 BOXNHL
12\tBPC Details
\tBPC No\t50000763323
14\tBrief details \tWP Gateman noticed smoke.
15\tFiding \tHot axle found at 78 degrees`;
  assert.ok(parseHotAxleForm(sheet));
  const [r] = readReports(sheet, { fileName: 'x.xlsx' });
  assert.equal(r.title, 'HOT AXLE');
  assert.equal(r.day, '2025-04-26');
  assert.equal(r.location, 'BG (BHONGIR)');
  assert.equal(r.wagonNo, 'SWR 22151180219 BOXNHL');
  assert.match(r.reason, /Finding: Hot axle found/);
});

test('a plain note is a report, dated from its file name or the day it was saved', () => {
  const note = 'RAIL SCABBING REPORTED BY ENGG CONTROL/SC\nSECTION: CHZ-GT\n30 KMPH SR imposed.';
  const [a] = readReports(note, { fileName: 'RAIL SCABBING 05.10.26.docx' });
  assert.equal(a.day, '2026-10-05');
  assert.equal(a.title, 'RAIL SCABBING REPORTED BY ENGG CONTROL/SC');
  assert.equal(a.reason, 'SECTION: CHZ-GT\n30 KMPH SR imposed.');
  const [b] = readReports(note, { fileName: 'scab.docx', lastModified: new Date(2026, 9, 12, 10).getTime() });
  assert.equal(b.day, '2026-10-12');
  assert.ok(b.datedFromFile);
  assert.equal(dayFromName('02.10.2026-JNPT-HARD PULLING.docx'), '2026-10-02');
});

test('copies of one report fold into one that keeps the most', () => {
  const generic = { ...readReports(ASSET.replace('DUE TO HOT AXLE', ''))[0], load: '59+1' };
  const full = readReports(ASSET)[0];
  assert.equal(generic.title, 'ASSET FAILURE');
  const batch = tidyBatch([generic, full, full], new Set());
  assert.equal(batch.fresh.length, 1);
  assert.equal(batch.folded, 2);
  assert.equal(batch.fresh[0].title, 'HOT AXLE');
  assert.equal(batch.fresh[0].load, '59+1', 'a box one copy left empty is filled from the other');
  const held = tidyBatch([full], new Set([reportKey(full)]));
  assert.equal(held.fresh.length, 0);
  assert.equal(held.held, 1);
});

test('groups: wagon numbers make C&W, loco words make loco', () => {
  assert.equal(classifyReport({ title: 'HOT AXLE', wagonNo: 'X 1234567' }), 'cw');
  assert.equal(classifyReport({ title: 'LOCO FAILED' }), 'loco');
  assert.equal(classifyReport({ title: 'BRAKE BINDING IN LOCO' }), 'loco');
  assert.equal(classifyReport({ title: 'WEIGHBRIDGE FAILED' }), 'loco');
  assert.equal(classifyReport({ title: 'SOMETHING', bpcNo: '1' }), 'cw');
  assert.equal(classifyReport({ title: 'SOMETHING' }), 'other');
});
