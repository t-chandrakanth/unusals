// A list of plain lines (the plan of action of a C&W failure), kept as text with one line per
// entry. Each row has an insert button, so a step that was forgotten can be added between the
// ones already written, and a remove button. Enter in a row inserts a row below it.

export function parseLines(text) {
  return String(text || '').replace(/\r/g, '').split('\n').map((s) => s.replace(/^\d{1,2}[.)]\s*/, '').trim()).filter(Boolean);
}

export function formatLines(rows) {
  return rows.map((s) => s.trim()).filter(Boolean).join('\n');
}

export function linesEditor(h, text, onChange, { min = 3, placeholder = '', label = 'Line', addText = '+ Add line' } = {}) {
  const rows = parseLines(text);
  while (rows.length < min) rows.push('');
  const box = h('div', { class: 'evbox' });
  const emit = () => onChange(formatLines(rows));
  const draw = (focusRow) => {
    box.replaceChildren(
      ...rows.map((r, i) => {
        const el = h('input', { type: 'text', class: 'evw', placeholder, 'aria-label': `${label} ${i + 1}`, autocomplete: 'off', value: r });
        el.addEventListener('input', () => { rows[i] = el.value; emit(); });
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          rows.splice(i + 1, 0, '');
          draw(i + 1);
        });
        return h('div', { class: 'evrow lines' }, h('b', { class: 'rpn' }, String(i + 1)), el,
          insertButton(h, `Add a line below ${label.toLowerCase()} ${i + 1}`, () => { rows.splice(i + 1, 0, ''); draw(i + 1); }),
          h('button', {
            type: 'button', class: 'x', title: 'Remove this line', 'aria-label': `Remove ${label.toLowerCase()} ${i + 1}`,
            onclick: () => { rows.splice(i, 1); if (!rows.length) rows.push(''); emit(); draw(); },
          }, '×'));
      }),
      h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push(''); draw(rows.length - 1); } }, addText));
    if (focusRow !== undefined) { const el = box.querySelectorAll('.evw')[focusRow]; if (el) el.focus(); }
  };
  draw();
  return box;
}

/** The small "+" that inserts a row below the one it sits on; shared by all the list editors. */
export function insertButton(h, label, onclick) {
  return h('button', { type: 'button', class: 'ins', title: 'Add a row below this one', 'aria-label': label, onclick }, '+');
}
