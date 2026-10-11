import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficial, fillFromOfficial } from '../js/official.js';
import { UNUSUAL_RECORDS } from '../js/unusual-data.js';
import { importUnusuals, upgradeUnusuals } from '../js/unusualimport.js';
import { seedState } from '../js/seed.js';

// What copying a whole Sr.DEE PDF page gives: labels and values run together.
const PASTED = `दक्षिण मध्य रेलवे
SOUTH CENTRAL RAILWAY
Sr.DEE’s Office
Secunderabad Division
Incident ID: 16415 Loco Unusual Report Date: 09-10-2026
Schedule Details
conventional loco Details
Train Details
Crew Details
Incident Report
Previous Incidents
S.no Incident ID Incident Date Section/Div/Zone Cause of incident
1 16146 11-08-2026 VKB STATION / SC / SCR LOCO TROUBLE
Date of Incident 11-09-2026 Incident Type Failure
Loco No 28665/KZJD/SCR WAG7 Date of Commission ***
Multi Loco 28747 Nature of Failure Not Reported
Schedule Done NA :- 04-09-2026 Schedule Due NA :- 05-11-2026
Schedule Major NA :- *** Trip Done Date *** :- ***
Type of Converter NA
Train No KSNK Load 60/60/5360
Failed Section/Div/Zone PRLI-GTU/SC/SCR Major Section PRLI-VKB
Working on ***
LP Name/Depot/Grade JAYNANDAN KUMAR/PRLI/B ALP Name VIKRAM SAINI
CLI Name B.RATNA RAJU
Cause of Incident LOCO TROUBLE
Failure Report
02:40 Train departure from PRLI with TN NO 01/88 without banker loco
03:07 Train stopped at KM NO 254/09 between PRLI - GTU due to DPWCS locos RF
communication fail, VCB tripped
 After 10 sec RF communication comes to service
03:08 RE asked and planned 60574/SBT planned from PRLI
05:14 Train arrived to GTU
Detention (minutes) 120"
Repercussions 17613 @ GTU 31 min
Previous Incidents
S.no Incident ID Incident Date Section/Div/Zone Cause of incident
1 16146 11-08-2026 VKB STATION / SC / SCR LOCO TROUBLE`;

test('a pasted Sr.DEE page is read into its parts', () => {
  const o = parseOfficial(PASTED);
  assert.equal(o.id, '16415');
  assert.equal(o.day, '2026-09-11');
  assert.equal(o.type, 'Failure');
  assert.equal(o.loco, '28665/KZJD/SCR WAG7');
  assert.equal(o.multi, '28747');
  assert.equal(o.train, 'KSNK');
  assert.equal(o.load, '60/60/5360');
  assert.equal(o.section, 'PRLI-GTU/SC/SCR');
  assert.equal(o.major, 'PRLI-VKB');
  assert.equal(o.lp, 'JAYNANDAN KUMAR/PRLI/B');
  assert.equal(o.alp, 'VIKRAM SAINI');
  assert.equal(o.cli, 'B.RATNA RAJU');
  assert.equal(o.cause, 'LOCO TROUBLE');
  assert.equal(o.commission, undefined);
  assert.equal(o.detention, '120');
  assert.equal(o.repercussions, '17613 @ GTU 31 min');
  assert.deepEqual(o.timeline.map((x) => x.t), ['02:40', '03:07', '03:08', '05:14']);
  assert.match(o.timeline[1].text, /communication fail, VCB tripped After 10 sec/);
});

test('the form is filled from the official report', () => {
  const f = fillFromOfficial(parseOfficial(PASTED));
  assert.equal(f.day, '2026-09-11');
  assert.equal(f.title, 'LOCO TROUBLE');
  assert.equal(f.location, 'PRLI-GTU');
  assert.equal(f.trainNo, 'KSNK');
  assert.equal(f.locoNo, '28665+28747');
  assert.equal(f.load, '60/60/5360');
  assert.equal(f.det, '120 MIN');
  assert.equal(f.incident, '16415');
  assert.match(f.reason, /^02:40 Train departure/);
});

test('text that is not a Sr.DEE report is refused', () => {
  assert.equal(parseOfficial('hello there'), null);
  assert.equal(parseOfficial(''), null);
});

test('the September records carry structured official reports', () => {
  const sep = UNUSUAL_RECORDS.filter((r) => r.day.startsWith('2026-09'));
  assert.equal(sep.length, 7);
  assert.deepEqual(sep.map((r) => r.incident), ['16378', '16415', '16428', '16484', '16536', '16544', '16596']);
  for (const r of sep) {
    const o = JSON.parse(r.official);
    assert.equal(o.id, r.incident);
    assert.equal(o.day, r.day);
    assert.ok(o.timeline.length >= 2);
  }
  assert.equal(JSON.parse(sep[5].official).timeline.length, 12);
});

test('records loaded in the older text form are upgraded, once', () => {
  const old = importUnusuals(seedState(), UNUSUAL_RECORDS);
  const stale = { ...old, unusuals: old.unusuals.map((u) => (u.official ? { ...u, official: 'Incident type: x' } : u)) };
  const up = upgradeUnusuals(stale, UNUSUAL_RECORDS);
  assert.notEqual(up, stale);
  assert.ok(up.unusuals.filter((u) => u.official).every((u) => u.official.startsWith('{')));
  assert.equal(upgradeUnusuals(up, UNUSUAL_RECORDS), up);
});
