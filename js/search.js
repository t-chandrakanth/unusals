// Finding reports: one box, any words. A report is found when every word is somewhere in it (its heading,
// location, train, loco, wagon, BPC, events, repercussions, detention, date, or the stalling / block / official
// report kept inside it), in capitals or not. Pure functions, no DOM.

const text = (v) => String(v == null ? '' : v);
const dmy = (day) => text(day).split('-').reverse().join('-');

/** A kept JSON report as plain words: its values only, without picture data. */
function words(json) {
  if (!json) return '';
  const out = [];
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
    else if (!/^data:/i.test(String(v))) out.push(String(v));
  };
  try { walk(JSON.parse(json)); } catch { out.push(String(json).replace(/data:[^"']*/g, ' ')); }
  return out.join(' ');
}

/** Everything a report says, in one lower-case string. */
export function reportHaystack(u) {
  return [
    dmy(u.day), u.day, u.title, u.location, u.trainNo, u.locoNo, u.load, u.reason, u.det, u.rep, u.incident, u.wagonNo, u.bpcNo,
    words(u.official), words(u.stalling), words(u.block),
  ].map(text).join(' \n ').toLowerCase();
}

/** The words of a search: separated by spaces, empty ones dropped. */
export const queryWords = (q) => text(q).toLowerCase().split(/\s+/).filter(Boolean);

/** The reports (newest day first) that have every word of the search; [] for an empty search. */
export function searchReports(list, query) {
  const ws = queryWords(query);
  if (!ws.length) return [];
  return list.filter((u) => { const h = reportHaystack(u); return ws.every((w) => h.includes(w)); })
    .sort((a, b) => text(b.day).localeCompare(text(a.day)) || text(b.updatedAt).localeCompare(text(a.updatedAt)));
}
