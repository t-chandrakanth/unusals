// One-time import of the unusual reports written before the Unusuals tab
// existed (js/unusual-data.js).
//
// Every record has a fixed id, so importing again, or from two devices at
// once, cannot create duplicates.

import { pickUnusual } from './logic.js';

export const UNUSUAL_IMPORT_TAG = 'imp-u';

export function unusualsImported(state) {
  return !!state.unusualsImported || state.unusuals.some((u) => u.id.startsWith(`${UNUSUAL_IMPORT_TAG}-`));
}

export function importUnusuals(state, records) {
  if (unusualsImported(state)) return state.unusualsImported ? state : { ...state, unusualsImported: true };
  const perDay = new Map();
  const added = records.map((r) => {
    const n = (perDay.get(r.day) || 0) + 1;
    perDay.set(r.day, n);
    const [y, m, d] = r.day.split('-').map(Number);
    return {
      id: `${UNUSUAL_IMPORT_TAG}-${r.day}-${n}`, ...pickUnusual(r),
      updatedAt: new Date(y, m - 1, d, 12).toISOString(), updatedBy: 'record',
    };
  });
  return { ...state, unusuals: [...state.unusuals, ...added], unusualsImported: true };
}

/**
 * Devices that loaded the records before the official reports were stored in
 * a structured form get the new form, so every device shows them the same.
 */
export function upgradeUnusuals(state, records) {
  const perDay = new Map();
  const fresh = new Map();
  for (const r of records) {
    const n = (perDay.get(r.day) || 0) + 1;
    perDay.set(r.day, n);
    if (r.official) fresh.set(`${UNUSUAL_IMPORT_TAG}-${r.day}-${n}`, r);
  }
  let changed = false;
  const unusuals = state.unusuals.map((u) => {
    const r = fresh.get(u.id);
    if (!r || (u.official || '').startsWith('{') || u.official === r.official) return u;
    changed = true;
    return { ...u, official: r.official, incident: r.incident, load: u.load || r.load, updatedAt: new Date().toISOString() };
  });
  return changed ? { ...state, unusuals } : state;
}

// ---------- the DPWCS loco failures: a list of their own ----------

export const DPWCS_TAG = 'dpw';

export const dpwcsSeeded = (state) => state.unusuals.some((u) => u.id.startsWith(`${DPWCS_TAG}-`));

/** The first DPWCS loco failures, as copies tagged app = 'dpwcs', with fixed ids so they are never doubled. */
export function importDpwcs(state, records) {
  if (dpwcsSeeded(state)) return state;
  const perDay = new Map();
  const added = records.map((r) => {
    const n = (perDay.get(r.day) || 0) + 1;
    perDay.set(r.day, n);
    const [y, m, d] = r.day.split('-').map(Number);
    return {
      id: `${DPWCS_TAG}-${r.day}-${n}`, ...pickUnusual(r), type: 'loco', app: 'dpwcs',
      updatedAt: new Date(y, m - 1, d, 12).toISOString(), updatedBy: 'record',
    };
  });
  return { ...state, unusuals: [...state.unusuals, ...added] };
}
