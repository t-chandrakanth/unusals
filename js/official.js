// Reads the text of a Sr.DEE "Loco Unusual Report" (the PDF printed from the
// incident system) after it has been copied and pasted, and turns it into a
// small structured record that the Unusuals tab can show neatly and use to
// fill in the report form. Pure functions, no DOM.

const LABELS = [
  ['day', 'Date of Incident'], ['type', 'Incident Type'], ['loco', 'Loco No'],
  ['commission', 'Date of Commission'], ['multi', 'Multi Loco'], ['nature', 'Nature of Failure'],
  ['schedDone', 'Schedule Done'], ['schedDue', 'Schedule Due'], ['schedMajor', 'Schedule Major'],
  ['trip', 'Trip Done Date'], ['converter', 'Type of Converter'], ['train', 'Train No'],
  ['load', 'Load'], ['section', 'Failed Section/Div/Zone'], ['major', 'Major Section'],
  ['working', 'Working on'], ['lp', 'LP Name/Depot/Grade'], ['alp', 'ALP Name'],
  ['cli', 'CLI Name'], ['cause', 'Cause of Incident'],
];

const HEADINGS = /Schedule Details|conven\S*\s+loco Details|Train Details|Crew Details|Incident Report/gi;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const clean = (v) => {
  const t = String(v || '').replace(/^[\s:]+|[\s:]+$/g, '').replace(/\s+/g, ' ');
  return /^[*\s-]*$/.test(t) ? '' : t;
};

/** "30-09-2026" -> "2026-09-30" */
function isoDay(v) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(v || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

const TIME_LINE = /^(\d{1,2}[:.]\d{2})\s+(.*)$/;

/** Lines of a failure report: each starting with a time begins a new entry. */
export function timelineOf(lines) {
  const out = [];
  for (const raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;
    const m = TIME_LINE.exec(line);
    if (m) out.push({ t: m[1].replace('.', ':'), text: m[2].trim() });
    else if (out.length) out[out.length - 1].text += ` ${line}`;
    else out.push({ t: '', text: line });
  }
  return out;
}

/** The record, or null when the text does not look like a Sr.DEE report. */
export function parseOfficial(text) {
  const src = String(text || '').split('\r\n').join('\n');
  const id = (/Incident ID:?\s*(\d{3,})/i.exec(src) || [])[1] || '';
  const fr = src.search(/Failure Report/i);
  const dt = src.search(/Detention\s*\(minutes\)/i);
  const head = (fr >= 0 ? src.slice(0, fr) : (dt >= 0 ? src.slice(0, dt) : src)).replace(HEADINGS, ' ');
  const flat = head.replace(/\s+/g, ' ');

  // Where each label appears (the last time: a table above can have a column
  // of the same name); its value runs to the next label.
  const found = [];
  for (const [key, label] of LABELS) {
    const all = [...flat.matchAll(new RegExp(`(?:^|\\s)${esc(label)}(?=\\s|:|$)`, 'gi'))];
    const m = all[all.length - 1];
    if (m) found.push({ key, start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const f = {};
  found.forEach((x, i) => { f[x.key] = clean(flat.slice(x.end, i + 1 < found.length ? found[i + 1].start : undefined)); });
  if (!f.day && !id) return null;

  let timeline = [];
  let detention = '';
  let repercussions = '';
  let previous = '';
  if (fr >= 0) {
    const after = src.slice(fr).replace(/^Failure Report:?/i, '');
    const stop = after.search(/Detention\s*\(minutes\)/i);
    timeline = timelineOf((stop >= 0 ? after.slice(0, stop) : after).split('\n'));
    if (stop >= 0) {
      const tail = after.slice(stop).replace(/^Detention\s*\(minutes\):?/i, '');
      const rep = tail.search(/Repercussions/i);
      detention = clean(rep >= 0 ? tail.slice(0, rep) : tail).replace(/"/g, '');
      if (rep >= 0) {
        const r = tail.slice(rep).replace(/^Repercussions:?/i, '');
        const prev = r.search(/Previous Incidents/i);
        repercussions = clean(prev >= 0 ? r.slice(0, prev) : r);
        if (prev >= 0) {
          previous = r.slice(prev).replace(/^Previous Incidents:?/i, '').replace(/S\.?no\s+Incident ID\s+Incident Date\s+Section\/Div\/Zone\s+Cause of incident/i, '');
          previous = previous.split('\n').map(clean).filter(Boolean).join('; ');
        }
      }
    }
  }
  return {
    id, day: isoDay(f.day), type: f.type || '', cause: f.cause || '', nature: f.nature || '',
    loco: f.loco || '', multi: f.multi || '', schedDone: f.schedDone || '', schedDue: f.schedDue || '',
    train: f.train || '', load: f.load || '', section: f.section || '', major: f.major || '',
    lp: f.lp || '', alp: f.alp || '', cli: f.cli || '', timeline, detention, repercussions, previous,
  };
}

const fiveDigits = (v) => (String(v || '').match(/\d{5}/) || [''])[0];

/** The report-form fields that an official report can fill in. */
export function fillFromOfficial(o) {
  const locos = [fiveDigits(o.loco), fiveDigits(o.multi)].filter(Boolean).join('+');
  const mins = /(\d+)/.exec(o.detention || '');
  return {
    day: o.day,
    title: o.cause,
    location: String(o.section || '').replace(/(\/[A-Z]{1,5}){1,2}$/, ''),
    trainNo: o.train,
    locoNo: locos,
    load: o.load,
    det: mins ? `${mins[1]} MIN` : '',
    reason: o.timeline.map((x) => (x.t ? `${x.t} ${x.text}` : x.text)).join('\n'),
    incident: o.id,
  };
}

// ---------- unusual sheets (the daily-sheet layout) ----------

const DATE_MARK = /(?:UNUS[A-Z]*-)?DATE\s*-\s*(\d{1,2})-(\d{1,2})-(\d{4})/gi;
const one = (v) => String(v || '').replace(/[\t\s]+/g, ' ').replace(/^[\s:]+|[\s:]+$/g, '');

function cutBlock(part) {
  const find = (re, from) => {
    const m = new RegExp(re, 'i').exec(part.slice(from));
    return m ? { start: from + m.index, end: from + m.index + m[0].length } : null;
  };
  const loc = find('\\bLOCATION\\b', 0);
  const tr = loc && find('\\bTR(?:AIN)?\\.?\\s*NO\\b', loc.end);
  const lo = tr && find('\\bLOCO\\s*(?:NO|NUMBER)\\b', tr.end);
  const reason = lo && find('\\b(?:REASON|READON)\\b', lo.end);
  if (!reason) return null;
  // Between LOCO NO and REASON: the loco number (first line), maybe a LOAD
  // row, and, in a PDF where the REASON label sits in the middle of a wrapped
  // paragraph, the first lines of the reason.
  const lines = part.slice(lo.end, reason.start).split('\n');
  const first = lines.findIndex((l) => l.trim());
  let locoText = first >= 0 ? lines[first] : '';
  let before = first >= 0 ? lines.slice(first + 1) : [];
  let load = '';
  const inline = /(?:^|\s)LOAD\b[\s:]*(.*)$/i.exec(locoText);
  if (inline) { load = inline[1]; locoText = locoText.slice(0, inline.index); }
  const loadAt = before.findIndex((l) => /^\s*LOAD\b/i.test(l));
  if (!load && loadAt >= 0) {
    load = before[loadAt].replace(/^\s*LOAD\b[\s:]*/i, '');
    before = before.filter((_, k) => k !== loadAt);
  }
  const rest = part.slice(reason.end);
  const dets = [...rest.matchAll(/(?:^|\s)DET\b/gi)];
  const det = dets[dets.length - 1];
  const mid = det ? rest.slice(0, det.index) : rest;
  // C&W reports carry the wagon and BPC numbers after the reason.
  // The words can also appear inside the reason, so the label is the last
  // one that starts a line or a cell.
  const lastLabel = (re) => {
    const starts = [...mid.matchAll(new RegExp(`(?:^|[\\n\\t])[ \\t]*(${re})`, 'gi'))];
    const m = starts[starts.length - 1];
    if (m) return { index: m.index + m[0].length - m[1].length, 0: m[1] };
    const any = [...mid.matchAll(new RegExp(`\\b${re}\\b`, 'gi'))];
    const a = any[any.length - 1];
    return a ? { index: a.index, 0: a[0] } : null;
  };
  const wag = lastLabel('WAGON\\s*NO');
  const bpc = lastLabel('BPC\\s*NO');
  const cut = Math.min(...[wag, bpc].filter(Boolean).map((m) => m.index), mid.length);
  const reasonText = [...before, mid.slice(0, cut)].join('\n');
  const wagonNo = wag ? mid.slice(wag.index + wag[0].length, bpc && bpc.index > wag.index ? bpc.index : undefined) : '';
  const bpcNo = bpc ? mid.slice(bpc.index + bpc[0].length, wag && wag.index > bpc.index ? wag.index : undefined) : '';
  const tail = det ? rest.slice(det.index + det[0].length) : '';
  const rep = /\bREP\b/i.exec(tail);
  return {
    title: one(part.slice(0, loc.start)),
    location: one(part.slice(loc.end, tr.start)),
    trainNo: one(part.slice(tr.end, lo.start)),
    locoNo: one(locoText),
    load: one(load),
    reason: reasonText.split('\n').map((l) => l.replace(/[\t ]+/g, ' ').trim()).filter(Boolean).join('\n'),
    wagonNo: one(wagonNo),
    bpcNo: one(bpcNo),
    det: one((rep ? tail.slice(0, rep.index) : tail).replace(/^[\s:-]+/, '')),
    rep: rep ? one(tail.slice(rep.index + rep[0].length)) : '',
  };
}

/**
 * Unusual reports written as blocks (TRAIN DETAILS / LOCATION / TRAIN NO /
 * LOCO NO / REASON / DET, with a "UNUSALS-DATE-dd-mm-yyyy" line), as in the
 * daily sheets and the monthly statement, from a PDF, Excel or pasted text.
 * One block gives one report; a whole month gives all of them.
 */
export function parseBlocks(text) {
  const days = [];
  const src = String(text || '').split('\r\n').join('\n').replace(DATE_MARK, (_, d, m, y) => {
    days.push(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    return ' ';
  });
  // A PDF can break the label over two lines with the serial and the heading
  // in between: "TRAIN / 2 STALLED DUE TO LOCO PROBLEM / DETAILS".
  const joined = src.replace(/\bTRAIN\b[ \t]*\n[ \t]*(?:\d{1,3}[ \t]+)?([^\n]*)\n[ \t]*DETAILS\b/gi, 'TRAIN DETAILS $1\n');
  const parts = joined.split(/\bTRAIN\s+DETAILS\b/i).slice(1);
  const out = [];
  parts.forEach((part, i) => {
    const b = cutBlock(part);
    if (!b) return;
    // The serial number of the next block ends this block's last box.
    if (i < parts.length - 1) {
      const key = b.rep ? 'rep' : 'det';
      const next = String(i + 2); // the serial the next block should carry
      if (b[key] === next) b[key] = '';
      else if (b[key].endsWith(` ${next}`)) b[key] = b[key].slice(0, -next.length - 1);
      else {
        const trimmed = b[key].replace(/\s+\d{1,3}$/, '');
        if (/\D/.test(trimmed)) b[key] = trimmed;
      }
    }
    out.push({ day: days.length === parts.length ? days[i] : (days[i] || ''), ...b });
  });
  return out;
}

// ---------- C&W detention particulars and asset failure reports ----------

const COLON_LABELS = [
  ['date', 'Date'], ['trainNo', 'Train No'], ['locoNo', 'Loco No'], ['bpcNo', 'BPC No'], ['load', 'Load'],
  ['station', 'Station'], ['section', 'Section'], ['commodity', 'Commodity'], ['ex', 'Ex\\.?'],
  ['driver', 'Driver'], ['guard', 'Guard'],
];
// "ASSET FAILURE" reports are a table: labels and values side by side, no colons.
const TABLE_LABELS = [
  ['division', 'Division'], ['trainNo', 'Train No'], ['date', 'Date'], ['eno', 'ENO\\s*&\\s*Load'], ['station', 'Station'],
  ['section', 'Section'], ['detention', 'Detention'], ['driver', 'DRIVER'], ['commodity', 'Commodity'],
  ['guard', 'GUARD'], ['ex', 'EX'], ['bpcNo', 'BPC No'],
];

/** "07.10.26" or "7-10-2026" -> "2026-10-07" */
export function shortDay(v) {
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(v || '');
  if (!m) return '';
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** True for the text of a "Detention particulars of goods train" or "Asset failure" report. */
export function looksLikeDetention(text) {
  return /DETENTION\s+PARTICULARS\s+OF/i.test(text)
    || (/ASSET\s+FAILURE/i.test(text) && /BRIEF\s+(HISTORY|DETAILS)/i.test(text))
    || (/BRIEF\s+(HISTORY|DETAILS)/i.test(text) && /WAGON\s+(DETAILS|PARTICULARS)/i.test(text));
}

/** "170" -> "02:50 HRS" */
const minutesAsHrs = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')} HRS`;

const timeLine = (l) => l.replace(/^(\d{1,2})[.:](\d{2})\s*hrs?\s*:?\s*/i, '$1:$2 ');

/** A wagon line has a wagon number; the POH / ROH / RD dates under it are details. */
function wagonLines(text) {
  const wagons = [];
  const details = [];
  for (const raw of text.split('\n')) {
    const l = raw.replace(/[\t ]+/g, ' ').replace(/^\d+\.\s*(?=[A-Z])/, (m) => m).trim();
    if (!l) continue;
    if (/\b(R\/?D|POH|ROH)\b|\d{2}\.\d{2}\.\d{2,4}|^[A-Z]{2,6}:/.test(l) || !/\d{4,}/.test(l)) details.push(l);
    else wagons.push(l.replace(/^\d+\.\s*/, ''));
  }
  return { wagons, details };
}

/**
 * A "DETENTION PARTICULARS OF GOODS TRAIN ... AT <station> DUE TO <cause>" note
 * or an "ASSET FAILURE" table (hot axle, brake binding, metal on tyre...), from
 * pasted text, Word or PDF, as the boxes of a C&W failure report. Section,
 * commodity, ex, driver and guard have no box of their own, so they go at the
 * end of the reason.
 */
export function parseDetention(text) {
  const src = String(text || '').split('\r\n').join('\n').replace(/\*/g, '');
  if (!looksLikeDetention(src)) return null;
  const hist = src.search(/BRIEF\s+(?:HISTORY|DETAILS)\s*:?/i);
  const wag = src.search(/WAGON\s+(?:DETAILS|PARTICULARS)\s*:?/i);
  const tableMode = /ENO\s*&\s*Load/i.test(src);
  let head = hist >= 0 ? src.slice(0, hist) : (wag >= 0 ? src.slice(0, wag) : src);
  if (tableMode) head = head.split(/Detention\s+Particulars\s*:/i)[0];
  const flat = head.replace(/\s+/g, ' ');

  // the heading: "... TRAIN NO. X AT Y DUE TO Z", "... BETWEEN A AND B DUE TO Z", "ASSET FAILURE TRNO X DUE TO Z"
  let trainH = '';
  let placeH = '';
  let cause = '';
  for (const line of head.split('\n').slice(0, 8)) {
    const l = line.replace(/\s+/g, ' ').trim();
    let m = /(?:GOODS\s+TRAIN\s*(?:NO\.?|:)?|TRNO)\s*(.+?)\s+(AT|BETWEEN)\s+(.+?)\s+DUE\s+TO\s+(.+)$/i.exec(l);
    if (m) { trainH = m[1]; placeH = m[3]; cause = m[4]; break; }
    m = /(?:GOODS\s+TRAIN\s*(?:NO\.?|:)?|TRNO)\s*(.+?)\s+DUE\s+TO\s+(.+)$/i.exec(l);
    if (m) { trainH = m[1]; cause = m[2]; break; }
  }

  const found = [];
  for (const [key, label] of (tableMode ? TABLE_LABELS : COLON_LABELS)) {
    const re = tableMode ? `(?:^|\\s)${label}(?=\\s|$)` : `(?:^|\\s)${label}\\s*:`;
    const m = new RegExp(re, 'i').exec(flat);
    if (m) found.push({ key, start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const f = {};
  found.forEach((x, i) => { f[x.key] = clean(flat.slice(x.end, i + 1 < found.length ? found[i + 1].start : undefined)); });

  let locoNo = f.locoNo || '';
  let load = f.load || '';
  if (f.eno) { // "34003+34036/WAG9/KZJ&42+2": loco and load together
    const at = f.eno.lastIndexOf('&');
    locoNo = at >= 0 ? f.eno.slice(0, at).trim() : f.eno;
    load = at >= 0 ? f.eno.slice(at + 1).trim() : '';
  }
  let det = '';
  const mins = f.detention && /(\d+)/.exec(f.detention);
  if (mins) det = minutesAsHrs(Number(mins[1]));

  const histText = hist >= 0 ? src.slice(hist, wag > hist ? wag : undefined).replace(/^BRIEF\s+(?:HISTORY|DETAILS)\s*:?/i, '') : '';
  const lines = histText.split('\n').map((l) => l.replace(/[\t ]+/g, ' ').trim()).filter(Boolean).map(timeLine);
  const wagonText = wag >= 0 ? src.slice(wag).replace(/^WAGON\s+(?:DETAILS|PARTICULARS)\s*:?/i, '') : '';
  const { wagons, details } = wagonLines(wagonText);

  const extra = [
    f.section && `Section: ${f.section}`, f.commodity && `Commodity: ${f.commodity}`, f.ex && `Ex: ${f.ex}`,
    f.driver && `Driver: ${f.driver}`, f.guard && `Guard: ${f.guard}`,
    details.length ? `Wagon details: ${details.join(' ')}` : '',
  ].filter(Boolean).join(' | ');

  const train = f.trainNo || trainH;
  return {
    type: 'cw',
    day: shortDay(f.date),
    title: cause ? clean(cause).replace(/[*.]+$/, '').toUpperCase() : 'ASSET FAILURE',
    location: f.station || placeH,
    trainNo: train,
    locoNo,
    load,
    bpcNo: f.bpcNo || '',
    wagonNo: wagons.join('; '),
    reason: lines.join('\n') + (extra ? `\n\n${extra}` : ''),
    det,
  };
}

// ---------- First Information Report (unusual incident) ----------

export function looksLikeFIR(text) {
  return /FIRST\s+INFORMATION\s+REPORT/i.test(text) && /INCIDENT/i.test(text);
}

const unscore = (v) => String(v || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

/** The "FORMAT - FIRST INFORMATION REPORT (UNUSUAL INCIDENT)" form, as one report. */
export function parseFIR(text) {
  const src = String(text || '').split('\r\n').join('\n').replace(/\*/g, '');
  if (!looksLikeFIR(src)) return null;
  const grab = (re) => { const m = re.exec(src); return m ? m[1] : ''; };
  const glance = grab(/INCIDENT AT A GLANCE[^\n;]*;\s*([^\n]+)/i);
  const other = unscore(grab(/Other:\s*([^\n]*)/i));
  const when = grab(/Date\s*&\s*Time of Incident:\s*([^\n]*)/i);
  const time = /(\d{1,2})[.:](\d{2})\s*HRS/i.exec(when);
  const trainRaw = grab(/Train No\.?\s*\/\s*Type:\s*([^\n]*)/i);
  const bpcAt = src.search(/BPC No\.?,\s*Type[^\n]*\n/i);
  const bpc = bpcAt >= 0 ? (src.slice(bpcAt).split('\n')[1] || '').trim() : '';
  const desc0 = src.search(/BRIEF DESCRIPTION OF INCIDENT[^\n]*\n/i);
  let desc = '';
  if (desc0 >= 0) {
    const rest = src.slice(desc0).split('\n').slice(1).join('\n');
    const end = rest.search(/WAGON DETAILS|^\s*5\./im);
    desc = (end >= 0 ? rest.slice(0, end) : rest).replace(/^\s*\(What happened[^\n]*\n/i, '');
  }
  const repAt = desc.search(/^\s*REP\s*:/im);
  const rep = repAt >= 0 ? desc.slice(repAt).replace(/^\s*REP\s*:\s*/i, '').split('\n').map((l) => l.trim()).filter(Boolean).join(', ') : '';
  if (repAt >= 0) desc = desc.slice(0, repAt);
  const wagonAt = src.search(/WAGON DETAILS\s*:?/i);
  const wagon = wagonAt >= 0 ? (src.slice(wagonAt).split('\n').slice(1).find((l) => l.trim()) || '').trim() : '';
  const location = (/\sAT\s+(.+)$/i.exec(glance) || [])[1] || '';
  return {
    type: 'cw',
    day: shortDay(when),
    time: time ? `${time[1].padStart(2, '0')}:${time[2]}` : '',
    title: (other || glance).toUpperCase().replace(/HOTAXLE/g, 'HOT AXLE'),
    location: clean(location),
    trainNo: unscore(trainRaw.includes(';') ? trainRaw.slice(trainRaw.lastIndexOf(';') + 1) : trainRaw),
    locoNo: unscore(grab(/Loco No\(s\)\s*\/\s*Type:\s*([^\n]*)/i)),
    load: unscore(grab(/Total Load:\s*([^\n]*)/i)),
    bpcNo: bpc,
    wagonNo: wagon,
    reason: desc.split('\n').map((l) => l.replace(/[\t ]+/g, ' ').trim()).filter(Boolean).map(timeLine).join('\n'),
    rep,
    det: '',
  };
}

// ---------- the "Hot Axle (Wagon)" form (an Excel sheet of Description / Details rows) ----------

export function looksLikeHotAxleForm(text) {
  return /^\s*Hot\s*Axle/i.test(text) && /S\.?\s*No\s*\tDescription/i.test(text);
}

export function parseHotAxleForm(text) {
  const src = String(text || '').split('\r\n').join('\n');
  if (!looksLikeHotAxleForm(src)) return null;
  const rows = [];
  for (const line of src.split('\n')) {
    if (/^(\d+(\.0)?)?\t/.test(line) || !rows.length) rows.push(line);
    else rows[rows.length - 1] += `\n${line}`;
  }
  const val = (label) => {
    const row = rows.find((r) => new RegExp(`^[^\\t]*\\t\\s*${label}\\b`, 'i').test(r));
    return row ? row.split('\t').slice(2).join(' ').replace(/[\t ]+/g, ' ').trim() : '';
  };
  const train = val('Train No');
  const brief = val('Brief details');
  const finding = val('Fiding|Finding');
  const remarks = val('Remarks');
  return {
    type: 'cw',
    day: shortDay(val('Date')),
    title: 'HOT AXLE',
    location: val('Location'),
    trainNo: train,
    locoNo: val('Loco No'),
    load: '',
    bpcNo: val('BPC No'),
    wagonNo: val('Wagon No\\.?-?'),
    reason: [brief, finding && `Finding: ${finding}`, remarks && `Remarks: ${remarks}`].filter(Boolean).join('\n'),
    det: '',
  };
}

// ---------- which group a report belongs to ----------

const CW_TITLE = /AXLE|WAGON|BRAKE|BREAK\s*BINDING|BINDING|BODY BULGE|TXR|COUPL|UNCOUPL|CBC|BV DETACH|TYRE|BP HANDLE|SPRING|C&W|ADAPTOR|ASAPTOR|SNUBBER|SCABB/i;
const LOCO_TITLE = /LOCO|STALL|DPWCS|DPWS|FAIL|FIALED|TROUBLE|SANDER|PRBLEM/i;

/** 'cw', 'loco' or 'other', from the heading and the boxes. */
export function classifyReport(r) {
  const title = `${r.title || ''}`;
  if (r.wagonNo) return 'cw';
  if (/\bLOCO\b/i.test(title) && !/WAGON/i.test(title)) return 'loco';
  if (CW_TITLE.test(title) && !LOCO_TITLE.test(title)) return 'cw';
  if (LOCO_TITLE.test(title)) return 'loco';
  return r.bpcNo ? 'cw' : 'other';
}
