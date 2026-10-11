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
