// The CAF bound position: from the running-position sheet (copied from Excel) the trains that are
// bound for CAF, in three columns by route (via CAF; via CAF, JSGR, JSG; via CAF, JBP), each with the
// railway zone and state of the station its name is made of (from the station list), and where it stands. Pure functions, no DOM.

import { parseTsv } from './paste.js';

/**
 * What the morning CAF message has always said for a train, by the first part of its name:
 * "RBL (LOK) Uttar Pradesh" -> RBL: ['LOK', 'Uttar Pradesh']. Taken from the sheet of past messages and
 * added to in the app ("Stations").
 */
export const KNOWN = {
  SEBD: ['SBP', 'Odisha'], SMER: ['SBP', 'Odisha'], UCSD: ['CKP', 'Odisha'], FCK: ['SDAH', 'West Bengal'], KGP: ['KGP', 'West Bengal'],
  DKAE: ['HWH', 'West Bengal'], DSTP: ['ASN', 'West Bengal'], NJP: ['KIR', 'West Bengal'], MCCS: ['MLDT', 'West Bengal'],
  WENA: ['DNR', 'Bihar'], MPIB: ['DNR', 'Bihar'], FUT: ['DNR', 'Bihar'], BXR: ['DNR', 'Bihar'], KIUL: ['DNR', 'Bihar'], PRNA: ['KIR', 'Bihar'],
  BJU: ['SEE', 'Bihar'], PHE: ['DDU', 'Bihar'], UCPD: ['DNR', 'Jharkhand'], DUMK: ['ASN', 'Jharkhand'], MDP: ['ASN', 'Jharkhand'],
  BKSC: ['ADRA', 'Jharkhand'], HZBN: ['DHN', 'Jharkhand'], HZD: ['DHN', 'Jharkhand'], NGRH: ['DHN', 'Jharkhand'], DHN: ['DHN', 'Jharkhand'],
  KPSH: ['DHN', 'Jharkhand'], SBGG: ['MLDT', 'Jharkhand'], HTE: ['RNC', 'Jharkhand'], NKM: ['RNC', 'Rajasthan'],
  BTC: ['NAG', 'Madhya Pradesh'], GAR: ['NAG', 'Madhya Pradesh'], JKE: ['JBP', 'Madhya Pradesh'], NTPB: ['JBP', 'Madhya Pradesh'],
  G: ['NAG', 'Maharashtra'], PMAM: ['NAG', 'Maharashtra'], WSA: ['NAG', 'Maharashtra'], BIA: ['R', 'Chattisgarh'], MBPB: ['R', 'Chattisgarh'],
  BXA: ['R', 'Chattisgarh'], MVIS: ['R', 'Chattisgarh'], CCMH: ['R', 'Chattisgarh'], DURG: ['R', 'Chattisgarh'], MNBK: ['R', 'Chattisgarh'],
  RSD: ['R', 'Chattisgarh'], MSMM: ['R', 'Chattisgarh'], BSPC: ['R', 'Chattisgarh'], MNDH: ['R', 'Chattisgarh'], BLSN: ['SBP', 'Chattisgarh'],
  JSLK: ['BSP', 'Chattisgarh'], KHS: ['BSP', 'Chattisgarh'], AKT: ['BSP', 'Chattisgarh'], NYN: ['PRYJ', 'Uttar Pradesh'], PRYJ: ['PRYJ', 'Uttar Pradesh'],
  IDGJ: ['PRYJ', 'Uttar Pradesh'], PNKD: ['PRYJ', 'Uttar Pradesh'], CPC: ['PRYJ', 'Uttar Pradesh'], SIC: ['PRYJ', 'Uttar Pradesh'],
  SUBR: ['LJN', 'Uttar Pradesh'], JEA: ['LJN', 'Uttar Pradesh'], BKT: ['LJN', 'Uttar Pradesh'], BST: ['LJN', 'Uttar Pradesh'], NTV: ['LJN', 'Uttar Pradesh'],
  RBL: ['LOK', 'Uttar Pradesh'], AYC: ['LKO', 'Uttar Pradesh'], FGTP: ['LKO', 'Uttar Pradesh'], SOP: ['LKO', 'Uttar Pradesh'],
  HACG: ['DHN', 'Uttar Pradesh'], DEOS: ['BSB', 'Uttar Pradesh'], BE: ['BRY', 'Uttar Pradesh'], CGS: ['RNY', 'Assam'], BRGB: ['RNY', 'Assam'],
  JRNA: ['LMG', 'Tripura'],
};

/** The railway zone a state mostly belongs to: the last resort for the bracket when nothing else says. */
export const STATE_ZONE = {
  'Uttar Pradesh': 'NR', 'Uttarakhand': 'NR', 'Delhi': 'NR', 'Punjab': 'NR', 'Haryana': 'NR', 'Himachal Pradesh': 'NR', 'Jammu and Kashmir': 'NR',
  'Rajasthan': 'NWR', 'Gujarat': 'WR', 'Madhya Pradesh': 'WCR', 'Maharashtra': 'CR', 'Chhattisgarh': 'SECR', 'Odisha': 'ECoR',
  'Jharkhand': 'ECR', 'Bihar': 'ECR', 'West Bengal': 'ER', 'Assam': 'NFR', 'Telangana': 'SCR', 'Andhra Pradesh': 'SCR',
  'Karnataka': 'SWR', 'Tamil Nadu': 'SR', 'Kerala': 'SR', 'Goa': 'KR', 'Arunachal Pradesh': 'NFR', 'Manipur': 'NFR', 'Meghalaya': 'NFR',
  'Mizoram': 'NFR', 'Nagaland': 'NFR', 'Tripura': 'NFR', 'Sikkim': 'NFR',
};

const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADS = {
  trainno: 'train', ex: 'ex', destzone: 'zone', location: 'location', hotime: 'hoTime', loco: 'loco', remarks: 'remarks',
};
// the order of the columns when no heading row was copied
const PLAIN = ['sno', 'train', 'ex', 'zone', 'start', 'hor', 'km', 'stock', 'loco', 'coa', 'location', 'status', 'hoTime', 'remarks'];

/** The trains of a pasted sheet: [{ train, ex, zone, loco, location, status, hoTime, remarks }]. */
export function parseSheet(text) {
  const rows = parseTsv(text).filter((r) => r.some(Boolean));
  const isHead = (r) => r.map(key).includes('trainno');
  // each heading row names the columns of the rows under it (a picture's rows come under a heading of their own)
  let cols = PLAIN;
  let live = !rows.some(isHead);
  const body = [];
  for (const r of rows) {
    if (isHead(r)) {
      // the second S.NO column is the Arr / Dep one
      let seen = 0;
      cols = r.map((c) => {
        const k = key(c);
        if (k === 'sno') return seen++ ? 'status' : 'sno';
        return HEADS[k] || k;
      });
      live = true;
    } else if (live) body.push({ r, cols });
  }
  return body.map(({ r, cols }) => {
    const o = { rowCells: r.filter(Boolean).length };
    cols.forEach((c, i) => { if (c) o[c] = r[i] || ''; });
    return { rowCells: o.rowCells, train: o.train || '', ex: o.ex || '', zone: o.zone || '', loco: o.loco || '', location: o.location || '', status: o.status || '', hoTime: o.hoTime || '', remarks: o.remarks || '' };
  }).filter((t) => t.train && t.rowCells >= 2 && !/^BLOCK\b|=/i.test(t.train)).map(({ rowCells, ...t }) => t);
}

/** "CPC/SIC-42 CAF, JBP" -> "CPC/SIC"; "RBL-42-1 CAF JBP STB" -> "RBL"; "NTV NMG" stays. */
export function baseName(train) {
  return String(train || '').toUpperCase().split(/\s*-\s*\d|\s+CAF\b|\s*\(/)[0].replace(/\s+/g, ' ').trim();
}

export const isCaf = (t) => /\bCAF\b/i.test(t.train);

/** The route column: "jbp", "jsg" or "caf". */
export function routeOf(t) {
  if (/\bJBP\b/i.test(t.train)) return 'jbp';
  if (/\bJSGR?\b/i.test(t.train)) return 'jsg';
  return 'caf';
}

/** The state a railway zone mostly serves: the state of a train whose station the list does not have, from its DEST ZONE. */
export const ZONE_STATE = {
  CR: 'Maharashtra', WR: 'Gujarat', NR: 'Uttar Pradesh', NCR: 'Uttar Pradesh', NER: 'Uttar Pradesh', NWR: 'Rajasthan',
  WCR: 'Madhya Pradesh', SECR: 'Chhattisgarh', SER: 'West Bengal', ECOR: 'Odisha', ECR: 'Bihar', ER: 'West Bengal',
  NFR: 'Assam', SCR: 'Telangana', SWR: 'Karnataka', SR: 'Tamil Nadu', KR: 'Goa',
};

const STATES = Object.fromEntries(Object.keys(STATE_ZONE).map((s) => [s.toLowerCase(), s]));
/** "uttar pradesh" -> "Uttar Pradesh"; '' when it is not a state. */
export const stateNamed = (s) => STATES[String(s || '').trim().toLowerCase()] || '';

/**
 * The lines typed in the app under "New train names": NAME = BRACKET, State; a line with only a state
 * (BCNE = Maharashtra) is taken as that. -> { CODE: [bracket, state] }.
 */
export function parseOwn(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*([A-Za-z0-9]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (!m || !m[2]) continue;
    const parts = m[2].split(',').map((s) => s.trim());
    let bracket = parts.length > 1 ? parts[0] : /^[A-Za-z]+$/.test(parts[0]) && !stateNamed(parts[0]) ? parts[0] : '';
    const rest = parts.length > 1 ? parts.slice(1).join(', ') : bracket ? '' : parts[0];
    out[m[1].toUpperCase()] = [bracket.toUpperCase(), stateNamed(rest) || rest];
  }
  return out;
}

/**
 * The bracket and state of a train, from the first part of its name that is known: first what the morning
 * message has always said (the entries typed in the app, then KNOWN), else the station list for the state,
 * with the sheet's own DEST ZONE for the bracket (the station's zone when the sheet has none).
 * lookup = { stations: { CODE: [name, state, zone] }, own: { CODE: [bracket, state] } }.
 * A name no part of which is known gets the sheet's zone alone; null when there is not even that.
 */
export function originOf(name, lookup = {}, zone = '') {
  const stations = lookup.stations || {};
  const own = lookup.own || {};
  zone = String(zone || '').trim().toUpperCase();
  const codes = String(name || '').toUpperCase().split(/[\/\s]+/).map((c) => c.replace(/^-+|-+$/g, '')).filter((c) => c && !/^\d+$/.test(c) && c !== 'CAF');
  for (const code of codes) {
    const hit = own[code] || KNOWN[code];
    if (hit) return { code, bracket: hit[0] || zone, state: hit[1] || '' };
  }
  let found = null;
  for (const code of codes) {
    const st = stations[code];
    if (!st) continue;
    const rec = { code, station: st[0], state: st[1] || '', bracket: zone || st[2] || STATE_ZONE[st[1]] || '' };
    if (rec.state && rec.bracket) return rec;
    if (!found || (!found.state && rec.state)) found = rec;
  }
  // the station is not in the list: the state the sheet's zone mostly serves, to be corrected in the table if wrong
  const byZone = ZONE_STATE[zone.replace(/[^A-Z]/g, '')] || '';
  if (!found && zone) return { code: '', bracket: zone, state: byZone };
  if (found && !found.state && byZone) found.state = byZone;
  return found;
}

/** Where it stands: "VHGN Arr 22:17 16-10", "AT MAGH", "H/O 03:40", or "AT" its starting station. */
export function standing(t) {
  const loc = t.location.trim().toUpperCase();
  const when = t.hoTime.replace(/\s+/g, ' ').trim();
  const st = /^(arr|dep)/i.test(t.status.trim()) ? t.status.trim().replace(/^./, (c) => c.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '';
  if (loc && st) return `${loc} ${st}${when ? ` ${when}` : ''}`;
  if (loc) return `AT ${loc}`;
  if (when) return `H/O ${when}`;
  return t.ex.trim() ? `AT ${t.ex.trim().toUpperCase()}` : '';
}

/** One line: "RBL (LOK) Uttar Pradesh VHGN Arr 22:17 16-10": the bracket and state the train's name has always had in the morning message. */
export function entryText(t, lookup = {}) {
  const o = originOf(baseName(t.train), lookup, t.zone);
  return [baseName(t.train), `(${(o && o.bracket) || '?'})`, o ? o.state : '', standing(t)].filter(Boolean).join(' ');
}

/** { caf: [lines], jsg: [lines], jbp: [lines], unknown: [train names whose state is not known] } of the CAF bound trains of one sheet. */
export function cafPosition(text, lookup = {}) {
  const out = { caf: [], jsg: [], jbp: [], unknown: [] };
  for (const t of parseSheet(text).filter(isCaf)) {
    out[routeOf(t)].push(entryText(t, lookup));
    const name = baseName(t.train);
    const o = originOf(name, lookup, t.zone);
    if ((!o || !o.state) && !out.unknown.includes(name)) out.unknown.push(name);
  }
  return out;
}

export const count = (p) => p.caf.length + p.jsg.length + p.jbp.length;

/** The picture's table as a sheet model for the image: a title, headings, and the three columns side by side. */
export const cafTitle = (prefix, date, p) => `${prefix} -${String(count(p)).padStart(2, '0')}- CAF BOUND TRAINS ${date}`;

export function cafSheet(prefix, date, p) {
  const n = Math.max(p.caf.length, p.jsg.length, p.jbp.length, 1);
  const cell = (v, s) => ({ v: String(v), s });
  const rows = [
    [cell(cafTitle(prefix, date, p), 'title'), null, null, null, null, null],
    ['SNO', 'VIA CAF', 'SNO', 'VIA CAF, JSGR, JSG', 'SNO', 'VIA CAF, JBP'].map((v, i) => cell(v, i % 2 ? 'head' : 'serial')),
  ];
  for (let i = 0; i < n; i++) {
    const s = i % 2 ? 'alt' : 'cell';
    const t = i % 2 ? 'altText' : 'text';
    rows.push([
      cell(p.caf[i] ? i + 1 : '', s), cell(p.caf[i] || '', t),
      cell(p.jsg[i] ? i + 1 : '', s), cell(p.jsg[i] || '', t),
      cell(p.jbp[i] ? i + 1 : '', s), cell(p.jbp[i] || '', t),
    ]);
  }
  rows[0][0].colSpan = 6;
  return { name: 'CAF bound', cols: [5, 34, 5, 34, 5, 34], rows };
}

/** The picture as text for WhatsApp. */
export function cafText(prefix, date, p) {
  const part = (title, list) => (list.length ? [`*${title}*`, ...list.map((l, i) => `${i + 1}. ${l}`), ''] : []);
  return [`*${cafTitle(prefix, date, p)}*`, '', ...part('VIA CAF', p.caf), ...part('VIA CAF, JSGR, JSG', p.jsg), ...part('VIA CAF, JBP', p.jbp)].join('\n').trim();
}

// ---------- a picture of the sheet ----------

const ROUTE_WORDS = new Set(['JBP', 'JSG', 'JSGR', 'JHS', 'NP', 'NGP', 'STB', 'STR', 'INV', 'VIA']);

/**
 * The CAF trains in the text a picture was read as (a line of the table with its cells run together, as the
 * picture reader gives them) -> rows in the sheet's own columns, as text with tabs, under a heading row. Lines
 * of the picture that are not CAF trains are left out. The reading of a picture can be wrong in a letter or a
 * number, so the rows are shown for checking.
 */
export function ocrToRows(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/[|\u00a6]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/\bCAF\b/i.test(line)) continue;
    const words = line.replace(/^(\d+|IMP)\s+/i, '').split(' ');
    const at = words.findIndex((w) => /^CAF,?$/i.test(w));
    if (at < 0) continue;
    let end = at;
    while (end + 1 < words.length && ROUTE_WORDS.has(words[end + 1].replace(/,$/, '').toUpperCase())) end++;
    const train = words.slice(0, end + 1).join(' ');
    if (/^BLOCK\b/i.test(train) || /=/.test(train)) continue;
    const rest = words.slice(end + 1);
    const s = rest.findIndex((w) => /^(arr|dep)\.?$/i.test(w));
    const status = s >= 0 ? rest[s].replace('.', '') : '';
    const location = s > 0 && /^[A-Z]{2,5}$/.test(rest[s - 1]) ? rest[s - 1] : '';
    // the handover time follows Arr / Dep; without them it is the last time with a date on the line
    const dates = [...(s >= 0 ? rest.slice(s + 1) : rest).join(' ').matchAll(/\b(\d{1,2}:\d{2}\s+\d{1,2}-\d{1,2}(?:-\d{2,4})?)/g)];
    const when = s >= 0 ? dates[0] : dates[dates.length - 1];
    out.push(['*', train, '', '', '', location, status, when ? when[1] : ''].join('\t'));
  }
  return out.length ? ['S.NO\tTRAIN NO\tEX\tDEST ZONE\tLOCO\tLOCATION\tS.NO\tH/O TIME', ...out].join('\n') : '';
}
