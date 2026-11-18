// Sentence style: what is typed or pasted into a text box or a notes box gets a capital letter at the start of each
// sentence and each line, as it goes in: "brake binding at KZJ. relief loco asked" becomes "Brake binding at KZJ.
// Relief loco asked". Every other letter is left exactly as it was typed, so you decide where the other capitals
// go (KPCC, GDQ, Vijayawada). The cursor stays where it was. It runs before the app reads the box, so this is what
// is saved. The search box, dates, times, numbers, files and boxes marked data-keepcase are left alone.

const SKIP = new Set(['search', 'email', 'url', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'file', 'checkbox', 'radio', 'range', 'color', 'hidden', 'button', 'submit']);

/** A capital at the start of the text, after ". ", "! " or "? ", and at the start of each line. */
export function sentenceStart(value) {
  return String(value).replace(/(^|[.!?]\s+|\n\s*)([a-zà-ÿ])/g, (_, before, letter) => before + letter.toUpperCase());
}

/** Whether a box takes the capitals. */
export function takesCapitals(el) {
  if (!el || el.dataset.keepcase !== undefined) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !SKIP.has((el.type || 'text').toLowerCase());
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (e.isComposing || !takesCapitals(el)) return;
    const v = el.value;
    const fixed = sentenceStart(v);
    if (v === fixed) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    el.value = fixed;
    try { if (a !== null) el.setSelectionRange(a, b); } catch { /* a box with no cursor */ }
  }, true); // the capture phase: before the app's own listeners on the box read the value
}
