// What is typed or pasted into a text box or a notes box gets a capital letter at the start of each word, as it
// goes in: "brake binding at kzj" becomes "Brake Binding At Kzj". The other letters are left as they were typed,
// so a code typed in capitals (KPCC, GDQ) stays in capitals. The cursor stays where it was. It runs before the app
// reads the box, so this is what is saved. The search box, dates, times, numbers, files and boxes marked
// data-keepcase are left alone.

const SKIP = new Set(['search', 'email', 'url', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'file', 'checkbox', 'radio', 'range', 'color', 'hidden', 'button', 'submit']);

/** "brake binding at kzj" -> "Brake Binding At Kzj"; a word starts after a space, a new line, "(", "/", "-" or "@". */
export function firstLetters(value) {
  return String(value).replace(/(^|[\s(/\-@])([a-zà-ÿ])/g, (_, before, letter) => before + letter.toUpperCase());
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
    const fixed = firstLetters(v);
    if (v === fixed) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    el.value = fixed;
    try { if (a !== null) el.setSelectionRange(a, b); } catch { /* a box with no cursor */ }
  }, true); // the capture phase: before the app's own listeners on the box read the value
}
