// The CAF bound position: from the running-position sheet (copied from Excel) the trains that are
// bound for CAF, in three columns by route (via CAF; via CAF, JSGR, JSG; via CAF, JBP), each with the
// railway zone and state of the station its name is made of (from the station list), and where it stands. Pure functions, no DOM.

import { parseTsv } from './paste.js';

/** The railway zone a state mostly belongs to: used when the station list has the state but not the zone. */
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
  const at = rows.findIndex((r) => r.map(key).includes('trainno'));
  let cols;
  let body;
  if (at >= 0) {
    // the second S.NO column is the Arr / Dep one
    let seen = 0;
    cols = rows[at].map((c) => {
      const k = key(c);
      if (k === 'sno') return seen++ ? 'status' : 'sno';
      return HEADS[k] || k;
    });
    body = rows.slice(at + 1);
  } else {
    cols = PLAIN;
    body = rows;
  }
  return body.map((r) => {
    const o = {};
    cols.forEach((c, i) => { if (c) o[c] = r[i] || ''; });
    return { train: o.train || '', ex: o.ex || '', zone: o.zone || '', loco: o.loco || '', location: o.location || '', status: o.status || '', hoTime: o.hoTime || '', remarks: o.remarks || '' };
  }).filter((t) => t.train);
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

/**
 * The zone and state a train belongs to: the first part of its name that is a station code in the
 * station list ("GAR/BZU" -> Gadarwara, Madhya Pradesh, WCR). lookup = { stations: { CODE: [name, state, zone] },
 * own: { CODE: [zone, state] } } (own entries, typed in the app, come first). null when no part is a known station.
 */
export function originOf(name, lookup = {}) {
  const stations = lookup.stations || {};
  const own = lookup.own || {};
  let found = null;
  for (const raw of String(name || '').toUpperCase().split(/[\/\s]+/)) {
    const code = raw.trim();
    if (!code || /^\d+$/.test(code)) continue;
    let rec = null;
    if (own[code]) rec = { code, zone: own[code][0] || '', state: own[code][1] || '' };
    else if (stations[code]) rec = { code, station: stations[code][0], state: stations[code][1] || '', zone: stations[code][2] || '' };
    if (!rec) continue;
    if (!rec.zone && rec.state) rec.zone = STATE_ZONE[rec.state] || '';
    if (rec.zone && rec.state) return rec;
    if (!found || (!found.state && rec.state) || (!found.zone && rec.zone)) found = { ...found, ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v)) };
  }
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

/** One line: "RBL (NR) Uttar Pradesh VHGN Arr 22:17 16-10": the zone and state of the station the train name is made of. */
export function entryText(t, lookup = {}) {
  const o = originOf(baseName(t.train), lookup);
  return [baseName(t.train), `(${(o && o.zone) || '?'})`, o ? o.state : '', standing(t)].filter(Boolean).join(' ');
}

/** { caf: [lines], jsg: [lines], jbp: [lines], unknown: [train names whose state is not known] } of the CAF bound trains of one sheet. */
export function cafPosition(text, lookup = {}) {
  const out = { caf: [], jsg: [], jbp: [], unknown: [] };
  for (const t of parseSheet(text).filter(isCaf)) {
    out[routeOf(t)].push(entryText(t, lookup));
    const name = baseName(t.train);
    const o = originOf(name, lookup);
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
