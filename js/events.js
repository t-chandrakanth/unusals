// The sequence of events of a failure: rows of a time and what happened. It is kept
// as plain text, one event to a line ("19:06 Loco stalled at km 478/01"), in the
// same box the reason was always written in, so older reports, the shared
// sheets and the WhatsApp text all keep working.

const CLOCK = '\\d{1,2}[:.]\\d{2}(?:\\s*(?:HRS|HR|hrs|hr))?';
const LINE = new RegExp(`^\\s*(${CLOCK}(?:\\s*[-\\u2013\\u2014]\\s*${CLOCK})?)(?:\\s*[-:\\u2013\\u2014]\\s*|\\s+)(.*)$`);
const ONLY_TIME = new RegExp(`^\\s*(${CLOCK}(?:\\s*[-\\u2013\\u2014]\\s*${CLOCK})?)\\s*$`);

/** "19:06 Loco stalled\nBacked up" -> [{ t: '19:06', text: 'Loco stalled' }, { t: '', text: 'Backed up' }] */
export function parseEvents(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r/g, '');
    if (!line.trim()) continue;
    const only = ONLY_TIME.exec(line);
    if (only) { out.push({ t: only[1].trim(), text: '' }); continue; }
    const m = LINE.exec(line);
    out.push(m ? { t: m[1].trim(), text: m[2].trim() } : { t: '', text: line.trim() });
  }
  return out;
}

/** The rows back to text; rows with nothing in them are dropped. */
export function formatEvents(rows) {
  return rows
    .map((r) => [String(r.t || '').trim(), String(r.text || '').trim()].filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
}

/**
 * The rows on the page: a time box, a box for what happened, a remove button, and a button to add a row.
 * h: the app's element builder. text: the events as saved. onChange(text): called as they are typed.
 * Enter in the "what happened" box starts the next row.
 */
export function eventsEditor(h, text, onChange, { min = 4 } = {}) {
  const rows = parseEvents(text);
  while (rows.length < min) rows.push({ t: '', text: '' });
  const box = h('div', { class: 'evbox' });
  const emit = () => onChange(formatEvents(rows));
  const draw = (focusRow) => {
    box.replaceChildren(
      ...rows.map((r, i) => {
        const time = h('input', { type: 'text', class: 'evt', placeholder: '19:06', 'aria-label': `Time of event ${i + 1}`, autocomplete: 'off', value: r.t });
        const what = h('input', { type: 'text', class: 'evw', placeholder: 'What happened', 'aria-label': `What happened in event ${i + 1}`, autocomplete: 'off', value: r.text });
        time.addEventListener('input', () => { r.t = time.value; emit(); });
        what.addEventListener('input', () => { r.text = what.value; emit(); });
        what.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          rows.splice(i + 1, 0, { t: '', text: '' });
          draw(i + 1);
        });
        return h('div', { class: 'evrow' }, time, what, h('button', {
          type: 'button', class: 'x', title: 'Remove this row', 'aria-label': `Remove event ${i + 1}`,
          onclick: () => { rows.splice(i, 1); if (!rows.length) rows.push({ t: '', text: '' }); emit(); draw(); },
        }, '×'));
      }),
      h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push({ t: '', text: '' }); draw(rows.length - 1); } }, '+ Add a row'));
    if (focusRow !== undefined) { const el = box.querySelectorAll('.evt')[focusRow]; if (el) el.focus(); }
  };
  draw();
  return box;
}
