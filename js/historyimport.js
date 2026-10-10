// One-time import of the older records (js/history-data.js) so the app has
// the day-wise history from before it existed. Two sources are combined:
//   "sheet": the position reports from the " DPWCS LOCO" tab
//   "shed":  the loco shed's daily statements
//
// Every report adds a history entry for each loco whose details changed
// since the previous report from the same source, labelled with the source.
// Position reports are also kept whole under "Reports sent". The newest
// position report becomes the current position, unless a loco has been
// updated in the app more recently than that.
//
// Everything created has a fixed id, so running the import again, or from
// two devices at once, cannot create duplicates.

import { pick, sameFields, foisDateFromRemarks } from './logic.js';

export const IMPORT_TAG = 'imp1';

// 27764 was a typing mistake for 27767 in some reports. The records are
// corrected when the data file is built; this keeps a device that still
// holds the old number matched to the same consist.
const ALIASES = { '27592+27764': '27592+27767' };
// This consist was later split, and the two locos are now tracked singly.
// Its older history is filed under both.
const SPLITS = { '27337+27360': ['27337', '27360'] };

/** Identity of a loco or consist, whichever order or style it is typed in. */
export function locoKey(locoNo) {
  const k = (String(locoNo).match(/\d{5}/g) || []).sort().join('+');
  return ALIASES[k] || k;
}

export function alreadyImported(state) {
  return state.log.some((e) => e.id.startsWith(`${IMPORT_TAG}-`));
}

export function importHistory(state, snapshots) {
  if (alreadyImported(state) || !snapshots.length) return state;

  const ids = new Map();
  for (const l of state.locos) {
    const k = locoKey(l.locoNo);
    if (k && !ids.has(k)) ids.set(k, l.id);
  }
  const idFor = (k) => {
    if (!ids.has(k)) ids.set(k, `${IMPORT_TAG}-loco-${k}`);
    return ids.get(k);
  };

  const log = [];
  const reports = [];
  const lastBySource = {}; // source -> loco id -> details in its latest report
  const lastSeen = new Map(); // loco id -> index of the last report naming it
  const lastData = new Map();

  snapshots.forEach((snap, n) => {
    const last = lastBySource[snap.source] || (lastBySource[snap.source] = new Map());
    const reportLocos = [];
    const inThis = new Map(); // a loco listed twice in one report: the later row stands
    snap.rows.forEach((row, i) => {
      const data = pick({ ...row, foisDate: row.division === 'OTHER' ? foisDateFromRemarks(row.remarks) : '' });
      reportLocos.push({ id: `${IMPORT_TAG}-${n}-${i}`, updatedAt: snap.at, ...data });
      const key = locoKey(row.locoNo);
      (SPLITS[key] || [key]).forEach((k, j) => inThis.set(idFor(k), j ? { ...data, sameSerial: true } : data));
    });
    for (const [id, d] of inThis) {
      const prev = last.get(id);
      if (!prev || !sameFields(prev, d)) {
        log.push({ id: `${IMPORT_TAG}-${n}-${id}`, locoId: id, at: snap.at, kind: lastData.has(id) ? 'updated' : 'created', data: d, by: snap.source });
      }
      last.set(id, d);
      lastData.set(id, d);
      lastSeen.set(id, n);
    }
    if (snap.source === 'sheet') {
      reports.push({ id: `${IMPORT_TAG}-r-${n}`, at: snap.at, day: snap.day, by: snap.source, locos: reportLocos });
    }
  });

  // Current position: the newest position report, in its order.
  const newest = [...snapshots].reverse().find((s) => s.source === 'sheet') || snapshots[snapshots.length - 1];
  const existing = new Map(state.locos.map((l) => [l.id, l]));
  const used = new Set();
  const locos = [];
  for (const row of newest.rows) {
    const data = pick({ ...row, foisDate: row.division === 'OTHER' ? foisDateFromRemarks(row.remarks) : '' });
    const key = locoKey(row.locoNo);
    for (const k of SPLITS[key] || [key]) {
      const id = idFor(k);
      if (used.has(id)) continue;
      used.add(id);
      const mine = existing.get(id);
      locos.push(mine && mine.updatedAt > newest.at
        ? mine
        : { id, ...data, updatedAt: newest.at, updatedBy: newest.source });
    }
  }
  for (const l of state.locos) if (!used.has(l.id)) { locos.push(l); used.add(l.id); }

  // A loco that stops appearing in the records and is not on the current
  // list is marked at the next report, so its last position is not carried
  // forward into days when nobody was reporting it.
  for (const [id, n] of lastSeen) {
    if (used.has(id) || n + 1 >= snapshots.length) continue;
    const next = snapshots[n + 1];
    log.push({ id: `${IMPORT_TAG}-${n + 1}-gone-${id}`, locoId: id, at: next.at, kind: 'removed', data: lastData.get(id), by: next.source });
  }

  const byTime = (a, b) => a.at.localeCompare(b.at);
  return {
    ...state,
    locos,
    log: [...state.log, ...log].sort(byTime),
    reports: [...state.reports, ...reports].sort(byTime),
  };
}
