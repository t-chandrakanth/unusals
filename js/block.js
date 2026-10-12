// Block detention reports: a block taken on a section, how long it ran over,
// and the trains held up by it. The times worked out here are the ones the
// form fills in by itself. Pure functions, no DOM.

const HM = /^(\d{1,2}):(\d{2})$/;

/** "12:30" -> minutes since midnight, or null. */
export function toMin(t) {
  const m = HM.exec(String(t || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const wrap = (n) => ((n % 1440) + 1440) % 1440;

/** Minutes from one clock time to the next (past midnight too), or null. */
export function gap(from, to) {
  const a = toMin(from);
  const b = toMin(to);
  return a === null || b === null ? null : wrap(b - a);
}

/** The minutes the block ran past its permitted time: 0 when it was cleared in time. */
export function burstMinutes(to, cleared) {
  const a = toMin(to);
  const b = toMin(cleared);
  if (a === null || b === null) return null;
  const d = wrap(b - a);
  return d > 720 ? 0 : d; // cleared earlier than permitted is no burst, not 23 hours
}

/** 150 -> "150 MINS (02:30 HRS)" */
export function longMins(n) {
  if (n === null || n === undefined) return '';
  return n >= 60 ? `${n} MINS (${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')} HRS)` : `${n} MINS`;
}

export const blankRow = () => ({ tr: '', at: '', from: '', to: '' });

export function blankBlock(day = '') {
  return { day, station: '', dir: 'UP', name: '', from: '', to: '', cleared: '', asOn: '', rows: Array.from({ length: 6 }, blankRow) };
}

/** "BCM" or "BCM BLOCK" -> "BCM BLOCK": the word BLOCK goes at the end of the name by itself. */
export function blockName(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  return n && !/(^|\s)BLOCK$/i.test(n) ? `${n} BLOCK` : n;
}

/** "BCM BLOCK AT UP CT - SUH" */
export function blockTitle(b) {
  const where = [b.dir, b.station].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  const name = blockName(b.name);
  return (name && where ? `${name} AT ${where}` : name || where).toUpperCase();
}

/** The detention of one train: from its start to its departure, or to the "as on" time when it has not left. */
export function rowDetention(b, r) {
  if (gap(r.from, r.to) !== null) return { mins: gap(r.from, r.to), still: false };
  if (!String(r.to || '').trim() && gap(r.from, b.asOn) !== null) return { mins: gap(r.from, b.asOn), still: true };
  return null;
}

/** All the worked-out numbers of a block report. */
export function computeBlock(b) {
  const rows = (b.rows || []).filter((r) => String(r.tr || '').trim() || String(r.from || '').trim() || String(r.to || '').trim())
    .map((r, i) => ({ ...r, n: i + 1, det: rowDetention(b, r) }));
  return {
    title: blockTitle(b),
    duration: gap(b.from, b.to),
    burst: burstMinutes(b.to, b.cleared),
    rows,
    total: rows.reduce((s, r) => s + (r.det ? r.det.mins : 0), 0),
  };
}

const U = (s) => String(s || '').trim().toUpperCase();

/** The WhatsApp message, in the usual wording. */
export function blockMessage(b) {
  const c = computeBlock(b);
  const lines = ['*SIR,*', '', `*${c.title}*`, ''];
  if (b.from || b.to) lines.push(`*BLOCK TIME: ${b.from || '--:--'} TO ${b.to || '--:--'} HRS*`);
  if (b.cleared) lines.push(`*BLOCK CLEAR: ${b.cleared} HRS*`);
  if (c.burst !== null) lines.push(`*BLOCK BURST: ${c.burst > 0 ? `${c.burst} MINS` : 'NIL'}*`);
  lines.push('', '*REPERCUSSIONS:*', '');
  if (!c.rows.length) lines.push('*NIL*');
  c.rows.forEach((r, i) => {
    const head = `${r.n}. ${U(r.tr) || 'TRAIN'}${U(r.at) ? ` AT ${U(r.at)}` : ''}:`;
    const parts = [];
    if (r.from) parts.push(`ARR: ${r.from} HRS`);
    parts.push(r.to ? `DEP: ${r.to} HRS` : 'STILL NOT DEPARTED');
    const det = r.det ? `, *DETENTION: ${r.det.mins} MINS${r.det.still ? ` (UP TO ${b.asOn} HRS)` : ''}*` : '';
    lines.push(`*${head}* ${parts.join(', ')}${det}`);
    if (i < c.rows.length - 1) lines.push('');
  });
  return lines.join('\n');
}
