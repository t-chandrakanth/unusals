// The saved reports in sentence style too: the same rule that is applied to what is typed (a capital at the start of
// each sentence and line, every other letter as it was), applied to the reports that were saved before. Pure
// functions, no DOM.

import { sentenceStart } from './uppercase.js';

const TEXT_FIELDS = ['title', 'location', 'trainNo', 'locoNo', 'load', 'reason', 'det', 'rep', 'incident', 'wagonNo', 'bpcNo'];
const JSON_FIELDS = ['stalling', 'block'];

/** Every text in a kept report (a stalling or block report) in sentence style; picture data is left alone. */
function deep(v) {
  if (typeof v === 'string') return /^data:/i.test(v) ? v : sentenceStart(v);
  if (Array.isArray(v)) return v.map(deep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]));
  return v;
}

/** The report in sentence style, or null when it already is (nothing to save). */
export function capitaliseUnusual(u) {
  const out = { ...u };
  let changed = false;
  for (const f of TEXT_FIELDS) {
    if (typeof u[f] !== 'string' || !u[f]) continue;
    const v = sentenceStart(u[f]);
    if (v !== u[f]) { out[f] = v; changed = true; }
  }
  for (const f of JSON_FIELDS) {
    if (typeof u[f] !== 'string' || !u[f]) continue;
    let parsed;
    try { parsed = JSON.parse(u[f]); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const v = JSON.stringify(deep(parsed));
    if (v !== JSON.stringify(parsed)) { out[f] = v; changed = true; }
  }
  return changed ? out : null;
}
