// Stalling reports: a train that stalled in a section, written up in the layout of
// the one-page stalling report (train and stalling details, sequence of events,
// detention, remarks, repercussions, load table and section profile). Everything
// that can be worked out is: the detention, the relief loco's wait, the remarks.
// Pure functions, no DOM.

import { toMin, gap } from './block.js';

export function blankStalling(day = '') {
  return {
    day, trainNo: '', locoNo: '', load: '', section: '', km: '', gradient: '', speed: '', signals: '', cause: '',
    station: '', arr: '', dep: '',
    events: Array.from({ length: 6 }, () => ({ t: '', text: '' })),
    stallAt: '', reliefAt: '', spotDep: '',
    remarks: '', repercussions: ['', '', ''],
    loadHead: '', loadNote: '', loadImg: '', profileHead: '', profileNote: '', profileImg: '', profFrom: '', profTo: '', markX: '', markOff: false,
  };
}

/** Reads a stalling report out of its saved text; anything missing is blank. */
export function readStalling(text, day = '') {
  let o = {};
  try { o = JSON.parse(text) || {}; } catch { /* a blank report */ }
  const b = blankStalling(day);
  return {
    ...b, ...o,
    events: Array.isArray(o.events) && o.events.length ? o.events.map((e) => ({ t: String(e.t || ''), text: String(e.text || '') })) : b.events,
    repercussions: Array.isArray(o.repercussions) && o.repercussions.length ? o.repercussions.map(String) : b.repercussions,
  };
}

const text = (v) => String(v == null ? '' : v).trim();

/** The events that were written, in the order they were written. */
export const writtenEvents = (s) => s.events.map((e) => ({ t: text(e.t), text: text(e.text) })).filter((e) => e.t || e.text);
export const writtenRepercussions = (s) => s.repercussions.map(text).filter(Boolean);

/**
 * The events as the report shows them: when the time of the incident is given and no
 * event is the stalling itself, "Loco stalled at km ..." is the first row by itself.
 */
export function eventsOf(s) {
  const ev = writtenEvents(s);
  const t = text(s.stallAt);
  if (t && !ev.some((e) => /stall/i.test(e.text))) {
    const km = text(s.km);
    ev.unshift({ t, text: km ? `Loco stalled at km ${km}` : 'Loco stalled' });
  }
  return ev;
}

/** The time of the first event whose words match, when it has a time. */
function timeOf(s, re) {
  const e = writtenEvents(s).find((x) => re.test(x.text) && toMin(x.t) !== null);
  return e ? e.t : '';
}

/** Stalled, relief loco arrived and spot departure: as written in the boxes, else found in the events. */
export function keyTimes(s) {
  return {
    stall: text(s.stallAt) || timeOf(s, /stall/i),
    relief: text(s.reliefAt) || timeOf(s, /relief.*(arr|came|reach)/i),
    spot: text(s.spotDep) || timeOf(s, /spot\s*dep/i),
  };
}

/** 111 -> "1 hr 51 min", 100 -> "1 hr 40 min", 120 -> "2 hr", 45 -> "45 min" */
export function fmtDuration(mins) {
  if (mins === null || mins === undefined) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h} hr` : '', m || !h ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** The detention the train suffered and how long the relief loco took, from the key times. */
export function detention(s) {
  const k = keyTimes(s);
  const total = k.stall && k.spot ? gap(k.stall, k.spot) : null;
  const wait = k.stall && k.relief ? gap(k.stall, k.relief) : null;
  return { ...k, total, wait };
}

/** "Detention: 1 hr 51 min (19:06 to 20:57). Relief loco arrived after 1 hr 40 min (20:46)." */
export function detentionText(s) {
  const d = detention(s);
  const parts = [];
  if (d.total !== null) parts.push(`Detention: ${fmtDuration(d.total)} (${d.stall} to ${d.spot}).`);
  if (d.wait !== null) parts.push(`Relief loco arrived after ${fmtDuration(d.wait)} (${d.relief}).`);
  return parts.join(' ');
}

/** The short form kept in the register's DET box: "1 HR 51 MIN". */
export const detShort = (s) => { const d = detention(s); return d.total === null ? '' : fmtDuration(d.total).toUpperCase(); };

export function reportTitle(s) {
  return `STALLING REPORT – TRAIN ${text(s.trainNo).toUpperCase() || '----'}`;
}

/** "Cause: DRIZZLING WEATHER · Section KMT–MLMG · Stalled at km 478/01" */
export function reportSubtitle(s) {
  return [
    text(s.cause) && `Cause: ${text(s.cause)}`,
    text(s.section) && `Section ${text(s.section)}`,
    text(s.km) && `Stalled at km ${text(s.km)}`,
  ].filter(Boolean).join(' · ');
}

/** The left table: label and value, the key lines highlighted. Empty lines are left out. */
export function detailRows(s) {
  const km = text(s.km);
  return [
    ['Train No', text(s.trainNo), false],
    ['Loco No', text(s.locoNo), false],
    ['Load', text(s.load), false],
    ['Section', text(s.section), false],
    ['Stalled at', km ? `KM ${km}` : '', true],
    ['Gradient', text(s.gradient), true],
    ['Loco speed at stalling point', text(s.speed), false],
    ['Signal aspects', text(s.signals), false],
    ['Cause of stalling', text(s.cause), true],
  ].filter(([, v]) => v);
}

/** The heading line of the events table: "KMT main line | Arr 16:47 · Dep 18:45". */
export function eventsHead(s) {
  const when = [text(s.arr) && `Arr ${text(s.arr)}`, text(s.dep) && `Dep ${text(s.dep)}`].filter(Boolean).join(' · ');
  return text(s.station) || when ? [text(s.station) || 'Train', when] : null;
}

/** An event is highlighted when it is the stalling itself. */
export const isStallEvent = (e) => /stall/i.test(e.text);

/**
 * The remarks: what was written, or if nothing was, a paragraph made from the
 * train timings and the events, in the words of the report.
 */
export function remarksText(s) {
  if (text(s.remarks)) return text(s.remarks);
  const who = [text(s.trainNo).toUpperCase(), text(s.station)].filter(Boolean).join(' ');
  const times = [text(s.arr) && `ARR ${text(s.arr)}`, text(s.dep) && `DEP ${text(s.dep)}`].filter(Boolean).join(', ');
  const first = [who, times].filter(Boolean).join(' ');
  const events = eventsOf(s).map((e) => (e.t && e.text ? `${e.text} at ${e.t}.` : `${e.text || e.t}.`));
  return [first && `${first}.`, ...events].filter(Boolean).join(' ');
}

/** The message for WhatsApp: the report in a few lines. */
export function whatsappText(s) {
  const lines = [`*${reportTitle(s)}*`];
  if (reportSubtitle(s)) lines.push(reportSubtitle(s));
  lines.push('');
  for (const [label, value] of detailRows(s)) lines.push(`${label}: ${value}`);
  const ev = eventsOf(s);
  if (ev.length) {
    lines.push('', '*Sequence of events*');
    if (eventsHead(s)) lines.push(eventsHead(s).filter(Boolean).join(': '));
    for (const e of ev) lines.push(`${e.t ? `${e.t} ` : ''}${e.text}`.trim());
  }
  if (detentionText(s)) lines.push('', `*${detentionText(s)}*`);
  const rep = writtenRepercussions(s);
  if (rep.length) { lines.push('', '*Repercussions*'); rep.forEach((r, i) => lines.push(`${i + 1}. ${r}`)); }
  return lines.join('\n');
}

/** "478/01" -> 478.05 (the figure after the slash is the post within the km, 20 to the km); "478" -> 478; else null. */
export function kmValue(v) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?/.exec(String(v == null ? '' : v));
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Math.min(Number(m[2]), 19) / 20 : 0);
}

/**
 * Where the stall is on the section profile, as a percentage of the picture's width: the
 * stall km between the km at the picture's left and right edges. A position set by hand
 * wins. null when the stall is not to be marked, or cannot be placed.
 */
export function markPosition(s) {
  if (s.markOff) return null;
  const clamp = (n) => Math.max(0, Math.min(100, n));
  if (text(s.markX) !== '' && !Number.isNaN(Number(s.markX))) return clamp(Number(s.markX));
  const km = kmValue(s.km);
  const a = kmValue(s.profFrom);
  const b = kmValue(s.profTo);
  if (km === null || a === null || b === null || a === b) return null;
  return clamp(((km - a) / (b - a)) * 100);
}

/** True when the report has something worth saving. */
export const hasContent = (s) => !!(text(s.trainNo) || text(s.cause) || eventsOf(s).length);
