import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankStalling, readStalling, keyTimes, fmtDuration, detention, detentionText, detShort, reportTitle, reportSubtitle,
  detailRows, eventsHead, remarksText, whatsappText, writtenEvents, isStallEvent, eventsOf, kmValue, markPosition,
} from '../js/stalling.js';

// the DRTA report
const drta = () => ({
  ...blankStalling('2026-10-14'),
  trainNo: 'DRTA', locoNo: '44022 / G-9 / BRC / 28/10', load: '47 / 47 / 4104 T (BLC wagons)', section: 'KMT – MLMG',
  km: '478/01', gradient: '1 in 106 (rising for UP train)', speed: 'Normal', signals: 'Through', cause: 'Drizzling weather',
  station: 'KMT main line', arr: '16:47', dep: '18:45',
  events: [
    { t: '19:06', text: 'Loco stalled at km 478/01' },
    { t: '19:06–19:27', text: 'Backed up to km 479/01, but did not start' },
    { t: '', text: 'Relief loco asked; relief loco 60484 planned from KMT by cancelling MLSW (KMT arr 19:33)' },
    { t: '20:46', text: 'Relief loco arrived' },
    { t: '20:48', text: 'EOT' },
    { t: '20:57', text: 'Spot departure' },
    { t: '21:24', text: 'MLMG departure' },
    { t: '21:33', text: 'PPY departure' },
    { t: '', text: '' },
  ],
  repercussions: ['MLSW – KMT ARR 19:33', 'TJSP – at PNDP', 'VSPG – CKN ARR 19:41', ''],
});

test('durations are written in hours and minutes', () => {
  assert.equal(fmtDuration(111), '1 hr 51 min');
  assert.equal(fmtDuration(100), '1 hr 40 min');
  assert.equal(fmtDuration(120), '2 hr');
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(0), '0 min');
  assert.equal(fmtDuration(null), '');
});

test('the key times are found in the events, or taken from the boxes', () => {
  assert.deepEqual(keyTimes(drta()), { stall: '19:06', relief: '20:46', spot: '20:57' });
  assert.deepEqual(keyTimes({ ...drta(), stallAt: '19:00', reliefAt: '20:00', spotDep: '21:00' }), { stall: '19:00', relief: '20:00', spot: '21:00' });
});

test('detention and the relief loco\'s wait, as in the example report', () => {
  const d = detention(drta());
  assert.equal(d.total, 111);
  assert.equal(d.wait, 100);
  assert.equal(detentionText(drta()), 'Detention: 1 hr 51 min (19:06 to 20:57). Relief loco arrived after 1 hr 40 min (20:46).');
  assert.equal(detShort(drta()), '1 HR 51 MIN');
});

test('detention across midnight, and nothing when a time is missing', () => {
  const s = { ...drta(), events: [{ t: '23:30', text: 'Loco stalled' }, { t: '01:10', text: 'Spot departure' }] };
  assert.equal(detention(s).total, 100);
  assert.equal(detentionText({ ...blankStalling('2026-10-14'), events: [{ t: '10:00', text: 'Loco stalled' }] }), '');
});

test('headings and the details table', () => {
  assert.equal(reportTitle(drta()), 'STALLING REPORT – TRAIN DRTA');
  assert.equal(reportSubtitle(drta()), 'Cause: Drizzling weather · Section KMT – MLMG · Stalled at km 478/01');
  const rows = detailRows(drta());
  assert.deepEqual(rows.map((r) => r[0]), ['Train No', 'Loco No', 'Load', 'Section', 'Stalled at', 'Gradient', 'Loco speed at stalling point', 'Signal aspects', 'Cause of stalling']);
  assert.deepEqual(rows.filter((r) => r[2]).map((r) => r[0]), ['Stalled at', 'Gradient', 'Cause of stalling']);
  assert.equal(rows[4][1], 'KM 478/01');
  assert.deepEqual(detailRows(blankStalling('x')).map((r) => r[0]), []);
  assert.deepEqual(eventsHead(drta()), ['KMT main line', 'Arr 16:47 · Dep 18:45']);
});

test('blank rows are dropped; the stalling event is the highlighted one', () => {
  const ev = writtenEvents(drta());
  assert.equal(ev.length, 8);
  assert.deepEqual(ev.filter(isStallEvent).map((e) => e.t), ['19:06']);
});

test('remarks: written ones are kept, otherwise made from the events', () => {
  assert.equal(remarksText({ ...drta(), remarks: 'as written' }), 'as written');
  const r = remarksText(drta());
  assert.match(r, /^DRTA KMT main line ARR 16:47, DEP 18:45\. Loco stalled at km 478\/01 at 19:06\. /);
  assert.match(r, /Relief loco asked; relief loco 60484 planned from KMT by cancelling MLSW \(KMT arr 19:33\)\./);
  assert.match(r, /Spot departure at 20:57\./);
});

test('the WhatsApp message carries the table, the events, the detention and the repercussions', () => {
  const m = whatsappText(drta());
  assert.match(m, /^\*STALLING REPORT – TRAIN DRTA\*/);
  assert.match(m, /Stalled at: KM 478\/01/);
  assert.match(m, /20:46 Relief loco arrived/);
  assert.match(m, /\*Detention: 1 hr 51 min/);
  assert.match(m, /3\. VSPG – CKN ARR 19:41/);
});

test('a saved report is read back, and a broken one becomes a blank report', () => {
  const back = readStalling(JSON.stringify(drta()), '2026-10-14');
  assert.equal(back.trainNo, 'DRTA');
  assert.equal(back.events.length, 9);
  const bad = readStalling('{not json', '2026-10-15');
  assert.equal(bad.day, '2026-10-15');
  assert.equal(bad.events.length, 6);
});

test('the time of the incident gives the first row by itself, once', () => {
  const s = { ...blankStalling('2026-10-14'), km: '478/01', stallAt: '19:06', events: [{ t: '19:27', text: 'Backed up' }, { t: '', text: '' }] };
  assert.deepEqual(eventsOf(s), [{ t: '19:06', text: 'Loco stalled at km 478/01' }, { t: '19:27', text: 'Backed up' }]);
  // an event that is the stalling already: no second row
  const own = { ...s, events: [{ t: '19:06', text: 'Loco stalled' }] };
  assert.equal(eventsOf(own).length, 1);
  assert.equal(detention({ ...s, events: [...s.events, { t: '20:57', text: 'Spot departure' }] }).total, 111);
  assert.match(whatsappText(s), /19:06 Loco stalled at km 478\/01/);
});

test('a km is read with its post, and the stall is placed on the profile by it', () => {
  assert.equal(kmValue('478/01'), 478.05);
  assert.equal(kmValue('93/26'), 93.95); // a post past the last one is held at the last
  assert.equal(kmValue('479'), 479);
  assert.equal(kmValue('x'), null);
  const s = { ...blankStalling('2026-10-14'), km: '478/01', profFrom: '465', profTo: '479' };
  assert.ok(Math.abs(markPosition(s) - 93.21) < 0.1);
  assert.equal(markPosition({ ...s, profFrom: '' }), null, 'no edges, no automatic place');
  assert.equal(markPosition({ ...s, markX: '40' }), 40, 'a place set by hand wins');
  assert.equal(markPosition({ ...s, markOff: true }), null, 'switched off');
  assert.equal(markPosition({ ...s, km: '470', profFrom: '479', profTo: '465' }) > 60, true, 'a picture that runs the other way');
  assert.equal(markPosition({ ...s, km: '600' }), 100, 'outside the picture it is held at the edge');
});
