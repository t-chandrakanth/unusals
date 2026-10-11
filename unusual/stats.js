// The numbers behind the Unusals overview. Pure functions, no DOM.

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

/** Minutes of detention in the way people write it: "06:39 HRS", "4 HRS", "04 HRS:19 MINTS", "55 MINTS". */
export function detMinutes(det) {
  const t = String(det || '').toUpperCase();
  let m = /(\d{1,2})\s*HRS?\s*:?\s*(\d{1,2})\s*MIN/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /(\d{1,2}):(\d{2})/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /(\d+)\s*HRS?\b/.exec(t);
  if (m) return Number(m[1]) * 60;
  m = /(\d+)\s*MIN/.exec(t);
  if (m) return Number(m[1]);
  return 0;
}

export function fmtMinutes(min) {
  return min >= 60 ? `${Math.floor(min / 60)} h ${pad(min % 60)} m` : `${min} m`;
}

/** The loco numbers named in a loco no ("27592+27767/KZJ/DUE-11/11" gives 27592 and 27767). */
export function locoNumbers(locoNo) {
  return [...new Set(String(locoNo || '').match(/\d{5}/g) || [])];
}

/** Counts of something per report, biggest first. */
export function topCounts(list, keysOf, limit = 5) {
  const counts = new Map();
  for (const u of list) for (const k of keysOf(u)) if (k) counts.set(k, (counts.get(k) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);
}

/** Locos with more than one report since a day: the ones to look at. */
export function repeatLocos(list, sinceDay) {
  const by = new Map();
  for (const u of list) {
    if (u.day < sinceDay) continue;
    for (const n of locoNumbers(u.locoNo)) {
      if (!by.has(n)) by.set(n, []);
      by.get(n).push(u);
    }
  }
  return [...by.entries()].filter(([, items]) => items.length > 1)
    .map(([loco, items]) => ({ loco, count: items.length, last: items.map((x) => x.day).sort().pop() }))
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
}

/** Reports per day for the last n days (oldest first), by group. */
export function lastDays(list, n, today, kindOf) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push({ day: addDays(today, -i), loco: 0, cw: 0, other: 0 });
  const at = new Map(days.map((d) => [d.day, d]));
  for (const u of list) {
    const d = at.get(u.day);
    if (d) d[kindOf(u)]++;
  }
  return days;
}

export function longestDetentions(list, limit = 5) {
  return list.map((u) => ({ u, min: detMinutes(u.det) })).filter((x) => x.min > 0)
    .sort((a, b) => b.min - a.min).slice(0, limit);
}
