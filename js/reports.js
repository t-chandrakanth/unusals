// Reads reports out of the text of an attached file or a paste, whichever
// layout it is in, and tidies a batch of them (bulk upload of many files).

import { parseOfficial, fillFromOfficial, parseBlocks, parseDetention, parseFIR, parseHotAxleForm, classifyReport, shortDay } from './official.js';

const FIELDS = ['day', 'time', 'title', 'location', 'trainNo', 'locoNo', 'load', 'wagonNo', 'bpcNo', 'det', 'reason', 'rep'];

const blank = () => Object.fromEntries(FIELDS.map((k) => [k, '']));

/** A date in a file name: "10.10.26-BT SPL...", "HQ ... 07.10.26", "02.10.2026-LOCO...". */
export function dayFromName(name) {
  const m = /(\d{1,2})[.\-](\d{1,2})[.\-](\d{4}|\d{2})(?!\d)/.exec(name || '');
  return m ? shortDay(m[0]) : '';
}

const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * All the reports in some text, each { type, day, time, title, location, trainNo,
 * locoNo, load, wagonNo, bpcNo, det, reason, rep, [official, incident] }.
 * meta: { fileName, lastModified } is used for a date the text lacks.
 * Reports in the detention, asset failure, first-information and hot-axle
 * layouts are C&W failures. A sheet of blocks is sorted by what each says.
 */
export function readReports(text, meta = {}) {
  const t = String(text || '');
  const out = [];
  const push = (r, extra = {}) => out.push({ ...blank(), ...r, ...extra });

  const fir = parseFIR(t);
  const hot = fir ? null : parseHotAxleForm(t);
  if (fir) push(fir);
  else if (hot) push(hot);
  else {
    const det = parseDetention(t);
    if (det) push(det);
    else {
      if (/Failure Report|Incident ID/i.test(t) && parseOfficial(t)) {
        const sree = parseOfficial(t);
        push({ ...fillFromOfficial(sree), type: 'loco' }, { official: JSON.stringify(sree), incident: sree.id });
      } else {
        const blocks = parseBlocks(t);
        if (blocks.length) for (const b of blocks) push({ ...b, type: classifyReport(b) });
        else {
          // a plain note: its first line is the heading, the rest the reason
          const lines = t.split('\n').map((l) => l.replace(/[\t ]+/g, ' ').trim()).filter(Boolean);
          const body = lines.filter((l) => !/^(sir|dear sir)[, ]*$/i.test(l));
          if (body.length >= 1) push({ type: 'cw', title: body[0].replace(/\*/g, '').toUpperCase().slice(0, 120), reason: body.slice(1).join('\n') });
        }
      }
    }
  }
  // A report with no date takes it from the file name, else from the day the file was saved.
  for (const r of out) {
    if (!r.day) {
      r.day = dayFromName(meta.fileName) || (meta.lastModified ? localDay(meta.lastModified) : '');
      r.datedFromFile = true;
    }
  }
  return out;
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** The same incident, however it is spelled: same day, train and loco. */
export const reportKey = (r) => `${r.day}|${norm(r.trainNo)}|${norm(r.locoNo)}`;

/** Of two copies of one report, the one that says more, with any box it left empty filled from the other. */
function richer(a, b) {
  const generic = (r) => /^ASSET FAILURE$/i.test(r.title || '');
  let best = b;
  let other = a;
  if (generic(a) !== generic(b)) { best = generic(a) ? b : a; other = generic(a) ? a : b; }
  else if (String(a.reason || '').length >= String(b.reason || '').length) { best = a; other = b; }
  const merged = { ...best };
  for (const k of FIELDS) if (!String(merged[k] || '').trim() && String(other[k] || '').trim() && !(generic(other) && k === 'title')) merged[k] = other[k];
  return merged;
}

/**
 * A batch of reports (from many files) with the duplicates folded together and
 * those already held (a list of keys) set aside.
 */
export function tidyBatch(reports, haveKeys = new Set()) {
  const byKey = new Map();
  let folded = 0;
  for (const r of reports) {
    const k = reportKey(r);
    if (byKey.has(k)) { byKey.set(k, richer(byKey.get(k), r)); folded++; } else byKey.set(k, r);
  }
  const fresh = [];
  let held = 0;
  for (const [k, r] of byKey) { if (haveKeys.has(k)) held++; else fresh.push(r); }
  return { fresh, folded, held, total: reports.length };
}
