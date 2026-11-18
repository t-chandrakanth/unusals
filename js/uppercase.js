// Everything is written in capital letters: what is typed or pasted into a text box or a notes box is turned into
// capitals as it goes in. The cursor stays where it was. It runs before the app reads the box, so the capitals
// are what is saved. The search box, dates, times, numbers, files and boxes marked data-keepcase are left alone.

const SKIP = new Set(['search', 'email', 'url', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'file', 'checkbox', 'radio', 'range', 'color', 'hidden', 'button', 'submit']);

/** Whether a box takes capitals. */
export function takesCapitals(el) {
  if (!el || el.dataset.keepcase !== undefined) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !SKIP.has((el.type || 'text').toLowerCase());
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (e.isComposing || !takesCapitals(el)) return;
  const v = el.value;
  const up = v.toUpperCase();
  if (v === up) return;
  const a = el.selectionStart;
  const b = el.selectionEnd;
  el.value = up;
  try { if (a !== null && up.length === v.length) el.setSelectionRange(a, b); } catch { /* a box with no cursor */ }
}, true); // the capture phase: before the app's own listeners on the box read the value
