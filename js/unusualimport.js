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
