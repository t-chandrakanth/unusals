import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDetention, looksLikeDetention } from '../js/official.js';

const PASTED = `DETENTION PARTICULARS OF GOODS TRAIN: MLSW/BOXNL AT DKJ DUE TO HOT AXLE*
 Date	: 07.10.26
Train No: MLSW/BOXNL
Loco No: 27161+27187/WAG7/KGP
BPC No: 50000946064/UDL-ASN-ER/28.09.26/CC
Load	: 59+1
Station: DKJ
Section: MTMI-KZJ
Commodity: COAL
Ex.	: KSLK
Driver: RAVI SHANKAR/GALA
Guard: PRADEEP RAM/GALA (9063328962)

 BRIEF HISTORY:
Train while passing through KMT, DY.SS/KMT reported hot axle in formation. Train stopped at PPY. GDR checked the formation and found nothing.
GD informed to DY.SS/DKJ to check the formation at DKJ
DY.SS/DKJ informed to C&W staff/DKJ
15.30hrs: Train arrived DKJ. C&W staff conducted rolling examination and found hot axle of wagon no ECR 22100985063 BOXNHLL (18th from TE).
checked the wagon noticed Trailing trolley leading wheel left side (R2) bearing was damaged. Temp recorded as 526 degrees.
15.45hrs: Detach memo given
17.00hrs: Wagon detached
18.20hrs:Train ready


WAGON DETAILS:
ECR 22100985063 BOXNHLL (18th from TE)
`;

test('a pasted C&W detention report is recognised', () => {
  assert.ok(looksLikeDetention(PASTED));
  assert.ok(!looksLikeDetention('Incident ID: 16596 Failure Report'));
});

test('it fills the C&W failure format', () => {
  const r = parseDetention(PASTED);
  assert.equal(r.type, 'cw');
  assert.equal(r.day, '2026-10-07');
  assert.equal(r.title, 'HOT AXLE');
  assert.equal(r.location, 'DKJ');
  assert.equal(r.trainNo, 'MLSW/BOXNL');
  assert.equal(r.locoNo, '27161+27187/WAG7/KGP');
  assert.equal(r.bpcNo, '50000946064/UDL-ASN-ER/28.09.26/CC');
  assert.equal(r.load, '59+1');
  assert.equal(r.wagonNo, 'ECR 22100985063 BOXNHLL (18th from TE)');
  assert.match(r.reason, /^Train while passing through KMT/);
  assert.match(r.reason, /\n15:30 Train arrived DKJ\./);
  assert.match(r.reason, /\n15:45 Detach memo given/);
  assert.match(r.reason, /\n18:20 Train ready/);
  assert.match(r.reason, /Section: MTMI-KZJ \| Commodity: COAL \| Ex: KSLK \| Driver: RAVI SHANKAR\/GALA \| Guard: PRADEEP RAM\/GALA \(9063328962\)$/);
});

test('text from a PDF, with labels run together on one line, reads the same', () => {
  const flat = PASTED.replace(/\n(?=(Train No|Loco No|BPC No|Load|Station|Section|Commodity|Ex\.|Driver|Guard))/g, ' ');
  const r = parseDetention(flat);
  assert.equal(r.trainNo, 'MLSW/BOXNL');
  assert.equal(r.locoNo, '27161+27187/WAG7/KGP');
  assert.equal(r.guard, undefined);
  assert.match(r.reason, /Guard: PRADEEP RAM/);
});

test('other text is not a detention report', () => {
  assert.equal(parseDetention('hello'), null);
});
