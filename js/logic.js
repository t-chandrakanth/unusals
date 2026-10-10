// Pure data logic: no DOM, no storage. Everything here is covered by tests.

export const FIELDS = [
  'locoNo', 'dueDate', 'trainNo', 'location', 'division',
  'hoTrain', 'hoPoint', 'hoTime', 'foisDate', 'working', 'remarks', 'sameSerial',
];

export const DIVISIONS = { OTHER: 'Other division', SC: 'SC division' };

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD (sortable). */
export function dayKey(d) {
  d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD -> DD-MM-YYYY, the format used on the report. */
export function fmtDay(key) {
  const [y, m, d] = key.split('-');
  return `${d}-${m}-${y}`;
}

export function fmtTime(d) {
  d = new Date(d);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** DD-MM-YY HH:MM, the format used in the H/O time column. */
export function fmtDateTime(d) {
  d = new Date(d);
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)} ${fmtTime(d)}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function blankLoco(division = 'SC') {
  return {
    id: uid(), locoNo: '', dueDate: '', trainNo: '', location: '', division,
    hoTrain: '', hoPoint: '', hoTime: '', foisDate: '', working: '', remarks: '',
    sameSerial: false, updatedAt: '',
  };
}

/** Only the tracked fields of a loco, trimmed. */
export function pick(loco) {
  const out = {};
  for (const f of FIELDS) {
    const v = loco[f];
    out[f] = typeof v === 'string' ? v.trim() : (f === 'sameSerial' ? !!v : (v ?? ''));
  }
  return out;
}

export function sameFields(a, b) {
  const pa = pick(a), pb = pick(b);
  return FIELDS.every((f) => pa[f] === pb[f]);
}

/**
 * The FOIS message date written inside a remark (DD-MM-YYYY), as YYYY-MM-DD.
 * Used for locos saved before the date had its own field.
 */
export function foisDateFromRemarks(remarks) {
  const m = /\bon\s+(\d{2})-(\d{2})-(\d{4})/i.exec(remarks || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

export function foisRemark(day) {
  return `FOIS message given to the division on ${fmtDay(day)}. Following it up with the Division regularly. FOIS MESSAGE GIVEN TODAY IT SELF.`;
}

/**
 * Report order: other-division locos first, then SC division, with one running
 * serial number. A loco marked sameSerial shares the number of the loco above
 * it (a split consist shown as two rows under one S.No).
 * span is the number of rows the serial cell covers; 0 means "covered above".
 */
export function numbered(locos) {
  const out = [];
  let serial = 0;
  for (const division of ['OTHER', 'SC']) {
    let head = null;
    for (const loco of locos.filter((l) => l.division === division)) {
      if (loco.sameSerial && head) {
        head.span++;
        out.push({ loco, serial, span: 0 });
      } else {
        serial++;
        head = { loco, serial, span: 1 };
        out.push(head);
      }
    }
  }
  return out;
}

/**
 * The moment the current round of updating began: when the last report was
 * sent, or the start of today if nothing has been sent yet today.
 */
export function roundStart(reports, now = new Date()) {
  let since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  for (const r of reports) if (r.at > since) since = r.at;
  return since;
}

/** Has this loco been updated, or confirmed unchanged, in the current round? */
export function isUpdated(loco, since) {
  return (loco.updatedAt || '') > since || (loco.checkedAt || '') > since;
}

export function emptyState() {
  return { version: 1, locos: [], log: [], reports: [] };
}

/** All state changes go through here so every edit is logged with its time. */
export function reduce(state, action) {
  switch (action.type) {
    case 'save': {
      const now = action.now;
      const existing = state.locos.find((l) => l.id === action.loco.id);
      if (existing && sameFields(existing, action.loco)) return state;
      const loco = { ...existing, ...action.loco, ...pick(action.loco), updatedAt: now, updatedBy: action.by || '' };
      let locos;
      if (!existing) {
        locos = [...state.locos, loco];
      } else if (existing.division !== loco.division) {
        // Moved between divisions: goes to the end of its new section.
        loco.sameSerial = false;
        locos = [...state.locos.filter((l) => l.id !== loco.id), loco];
      } else {
        locos = state.locos.map((l) => (l.id === loco.id ? loco : l));
      }
      const entry = {
        id: uid(), locoId: loco.id, at: now,
        kind: existing ? 'updated' : 'created', data: pick(loco), by: action.by || '',
      };
      return { ...state, locos, log: [...state.log, entry] };
    }
    case 'check': {
      // "Looked at it, nothing has changed": counts as updated for the round
      // without adding a history entry.
      if (!state.locos.some((l) => l.id === action.id)) return state;
      return { ...state, locos: state.locos.map((l) => (l.id === action.id ? { ...l, checkedAt: action.now } : l)) };
    }
    case 'remove': {
      const loco = state.locos.find((l) => l.id === action.id);
      if (!loco) return state;
      const entry = { id: uid(), locoId: loco.id, at: action.now, kind: 'removed', data: pick(loco), by: action.by || '' };
      return { ...state, locos: state.locos.filter((l) => l.id !== loco.id), log: [...state.log, entry] };
    }
    case 'move': {
      const i = state.locos.findIndex((l) => l.id === action.id);
      if (i < 0) return state;
      const division = state.locos[i].division;
      let j = i + action.dir;
      while (j >= 0 && j < state.locos.length && state.locos[j].division !== division) j += action.dir;
      if (j < 0 || j >= state.locos.length) return state;
      const locos = [...state.locos];
      [locos[i], locos[j]] = [locos[j], locos[i]];
      return { ...state, locos };
    }
    case 'addReport':
      return { ...state, reports: [...state.reports, action.report] };
    case 'removeReport':
      return { ...state, reports: state.reports.filter((r) => r.id !== action.id) };
    default:
      return state;
  }
}

/**
 * Day-wise history of one loco between two days (inclusive).
 * Each update made on a day is its own row. A day with no update repeats the
 * last known position, marked carried: true, so every day has an answer.
 */
export function daySummary(log, locoId, fromKey, toKey) {
  const entries = log.filter((e) => e.locoId === locoId).sort((a, b) => a.at.localeCompare(b.at));
  const rows = [];
  if (!entries.length || fromKey > toKey) return rows;
  let i = 0;
  let last = null;
  // Catch up to the state as it was before the range starts.
  while (i < entries.length && dayKey(entries[i].at) < fromKey) last = entries[i++];
  for (let day = fromKey; day <= toKey; day = addDays(day, 1)) {
    let any = false;
    while (i < entries.length && dayKey(entries[i].at) === day) {
      last = entries[i++];
      any = true;
      rows.push({ day, time: fmtTime(last.at), kind: last.kind, data: last.data, by: last.by || '', carried: false });
    }
    if (!any && last && last.kind !== 'removed') {
      rows.push({ day, time: '', kind: last.kind, data: last.data, by: '', carried: true });
    }
  }
  return rows;
}

/**
 * The whole fleet as it stood at the end of a given day, rebuilt from the
 * log. Locos keep their current list order; ones removed since then follow.
 */
export function locosOnDay(state, day) {
  const last = new Map();
  for (const e of [...state.log].sort((a, b) => a.at.localeCompare(b.at))) {
    if (dayKey(e.at) <= day) last.set(e.locoId, e);
  }
  const out = [];
  const take = (id) => {
    const e = last.get(id);
    if (e && e.kind !== 'removed') out.push({ id, updatedAt: e.at, ...e.data });
    last.delete(id);
  };
  for (const l of state.locos) take(l.id);
  for (const id of [...last.keys()]) take(id);
  return out;
}

/** Every loco that has history, including removed ones. */
export function locoChoices(state) {
  const out = state.locos.map((l) => ({ id: l.id, label: l.locoNo || '(no number)' }));
  const seen = new Set(out.map((o) => o.id));
  const removed = new Map();
  for (const e of state.log) if (!seen.has(e.locoId)) removed.set(e.locoId, e.data.locoNo);
  for (const [id, no] of removed) out.push({ id, label: `${no || '(no number)'} (removed)` });
  return out;
}

export function reportTitles(day) {
  return {
    other: `DPWS LOCOS IN OTHER DIV DATA DT-${fmtDay(day)}`,
    sc: `SC DIV DPWS LOCOS DATA DT-${fmtDay(day)}`,
  };
}

/** Plain-text report for pasting into WhatsApp or SMS. */
export function reportText(locos, day) {
  const t = reportTitles(day);
  const rows = numbered(locos);
  const lines = [];
  const section = (title, division, detail) => {
    lines.push(`*${title}*`);
    const list = rows.filter((r) => r.loco.division === division);
    if (!list.length) lines.push('NIL');
    for (const { loco, serial } of list) {
      lines.push(`${serial}. ${loco.locoNo}`);
      lines.push(`   Due: ${loco.dueDate || '-'} | TR: ${loco.trainNo || '-'}`);
      lines.push(`   Loc: ${loco.location || '-'}`);
      const d = detail(loco);
      if (d) lines.push(`   ${d}`);
      if (loco.remarks) lines.push(`   Rem: ${loco.remarks}`);
    }
  };
  section(t.other, 'OTHER', (l) =>
    `H/O: ${l.hoTrain || '-'} at ${l.hoPoint || '-'}, ${l.hoTime || '-'}`);
  lines.push('');
  section(t.sc, 'SC', (l) => (l.working ? `Working: ${l.working}` : ''));
  return lines.join('\n');
}

export function historyTitle(label, fromKey, toKey) {
  return `LOCO ${label} DAY-WISE SUMMARY ${fmtDay(fromKey)} TO ${fmtDay(toKey)}`;
}

export function historyText(label, rows, fromKey, toKey) {
  const lines = [`*${historyTitle(label, fromKey, toKey)}*`];
  if (!rows.length) lines.push('No records in this period.');
  for (const r of rows) {
    const d = r.data;
    const where = d.division === 'OTHER'
      ? `Other div | H/O ${d.hoTrain || '-'} at ${d.hoPoint || '-'}, ${d.hoTime || '-'}`
      : `SC div${d.working ? ` | Working: ${d.working}` : ''}`;
    const when = r.carried ? `${fmtDay(r.day)} (no change)` : `${fmtDay(r.day)} ${r.time}`;
    const tail = r.kind === 'removed' ? ' | REMOVED FROM LIST' : (d.remarks ? ` | ${d.remarks}` : '');
    const who = r.by ? ` | by ${r.by}` : '';
    lines.push(`${when}: TR ${d.trainNo || '-'} | ${d.location || '-'} | ${where}${tail}${who}`);
  }
  return lines.join('\n');
}
