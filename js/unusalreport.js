// What goes on the one-page report of an unusual record (a loco failure, a C&W failure or any
// other unusual): heading, train and wagon details, sequence of events, remarks, repercussions.
// The page is drawn from this by unusalcanvas.js. Pure functions, no DOM.

import { parseEvents } from './events.js';
import { parseRep, detOf } from './repercussions.js';

const text = (v) => String(v == null ? '' : v).trim();
const dmy = (day) => String(day || '').split('-').reverse().join('-');

function official(u) {
  try { const o = JSON.parse(u.official); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** "1. KSNK ARR 15:30\n2. PSNH ARR 16:00" or "1. A 2. B" -> ['KSNK ARR 15:30', 'PSNH ARR 16:00'] */
export function splitRepercussions(rep) {
  const src = text(rep);
  if (!src) return [];
  let parts = src.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = src.split(/\s*(?:^|\s)\d{1,2}[.)]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) parts = src.split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => p.replace(/^\d{1,2}[.)]\s*/, '').trim()).filter(Boolean);
}

/** The pictures kept with a record: a JSON list of picture data. */
export function photosOf(u) {
  try { const a = JSON.parse(u.photos); return Array.isArray(a) ? a.filter((p) => typeof p === 'string' && p.startsWith('data:image')) : []; } catch { return []; }
}

/** The page of one record. */
export function reportModel(u) {
  const o = official(u) || {};
  const train = text(u.trainNo).toUpperCase();
  const name = (text(u.title) || 'UNUSUAL').toUpperCase();
  const title = `${/REPORT/.test(name) ? name : `${name} REPORT`}${train ? ` – TRAIN ${train}` : ''}`;
  const subtitle = [
    text(u.wagonNo) && `Wagon ${text(u.wagonNo)}`,
    text(u.location) && `Location ${text(u.location)}`,
    text(u.incident) && `Incident ${text(u.incident)}`,
  ].filter(Boolean).join(' · ');
  const det = text(u.det) || text(o.detention) || [text(u.detFrom), text(u.detTo)].filter(Boolean).join(' to ');

  const details = [
    ['Train No', train, false],
    ['Loco No', [text(u.locoNo) || text(o.loco), o.multi && `+ ${text(o.multi)}`].filter(Boolean).join(' '), false],
    ['Load', text(u.load), false],
    ['Location', text(u.location) || text(o.section), false],
    ['Defective wagon', text(u.wagonNo), true],
    ['BPC No', text(u.bpcNo), true],
    ['Cause', text(o.cause), true],
    ['Incident type', text(o.type), false],
    ['Loco pilot', text(o.lp), false],
    ['Assistant', text(o.alp), false],
    ['CLI', text(o.cli), false],
    ['Detention', det, true],
  ].filter(([, v]) => v);

  // the events: the official timeline, else the lines of the reason that start with a time
  let events = Array.isArray(o.timeline) ? o.timeline.map((e) => ({ t: text(e.t), text: text(e.text) })).filter((e) => e.t || e.text) : [];
  let free = [];
  if (!events.length) {
    const rows = parseEvents(u.reason);
    events = rows.filter((r) => r.t);
    free = rows.filter((r) => !r.t).map((r) => r.text);
    // a single timed line is not a sequence: the whole text is the remarks
    if (events.length < 2) { free = rows.map((r) => [r.t, r.text].filter(Boolean).join(' ')); events = []; }
  }
  let remarks = free.join(' ');
  if (!remarks && events.length) {
    remarks = events.map((e) => (e.t && e.text ? `${e.text} at ${e.t}.` : `${e.text || e.t}.`)).join(' ');
  }
  if (text(o.previous)) remarks = [remarks, `Earlier incidents: ${text(o.previous)}`].filter(Boolean).join(' ');

  const repercussions = parseRep(u.rep || o.repercussions).map((r) => ({ ...r, det: detOf(r) }));
  return {
    title, subtitle, when: [dmy(u.day), text(u.time) && `${text(u.time)} HRS`].filter(Boolean).join('  ·  '),
    photos: photosOf(u),
    details, events: events.map((e) => ({ ...e, hl: /stall|stopp|derail|burst|fail/i.test(e.text) })), remarks, repercussions,
  };
}

/** The same record as plain text for a file name. */
export const reportFile = (u) => `Unusal-${dmy(u.day)}-${(text(u.trainNo) || text(u.title) || 'report').replace(/[^0-9A-Za-z]+/g, '-')}`;
