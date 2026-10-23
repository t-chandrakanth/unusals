// Interchange deviations: the rows typed or pasted in, the message to CFTM out (text, WhatsApp, picture, PDF).

import { parsePoints, parsePaste, parseRemarks, withRemarks, grouped, deviationsMessage, deviationsWhatsApp, deviationsSheet } from '../js/deviations.js';
import { sheetToCanvas } from '../js/canvas.js';
import { buildPdf } from '../js/pdf.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };

// ---------- state: the rows of each day, the points, the heading fields; all kept on the device ----------
// days = { 'YYYY-MM-DD': [{ point, train, remark }] }; `rows` is the day in the editor (the date box).
let days = {};
try { days = JSON.parse(store.get('dev-days', '{}')); if (!days || typeof days !== 'object' || Array.isArray(days)) days = {}; } catch { days = {}; }
let rows = [];
const points = () => parsePoints(store.get('dev-points'));
const saveDays = () => store.set('dev-days', JSON.stringify(days));
const save = () => { const d = $('date').value; if (rows.length) days[d] = rows; else delete days[d]; saveDays(); };
/** The editor shows the day in the date box. */
function openDay(d) {
  rows = (days[d] || []).map((r) => ({ ...r }));
  history.length = 0;
  $('undo').disabled = true;
  render();
}

// ---------- undo: the rows as they were before each change, the last 50; Ctrl+Z or the Undo button ----------
const history = [];
function remember() {
  const now = JSON.stringify(rows);
  if (history[history.length - 1] !== now) history.push(now);
  if (history.length > 50) history.shift();
  $('undo').disabled = false;
}
function undo() {
  if (!history.length) { toast('Nothing to undo.'); return; }
  rows = JSON.parse(history.pop());
  save(); render();
  $('undo').disabled = !history.length;
  toast('Undone.');
}

const today = new Date();
$('date').value = store.get('dev-date') || key(new Date(today.getTime() - 86400000));
$('from').value = store.get('dev-from') || 'SR.DOM/SC';
$('to').value = store.get('dev-to') || 'CFTM/SCR';
// rows saved before the days came in (one list, no date) become the day in the date box
try {
  const old = JSON.parse(store.get('dev-rows', 'null'));
  if (Array.isArray(old) && old.length && !days[$('date').value]) { days[$('date').value] = old; saveDays(); }
  localStorage.removeItem('dev-rows');
} catch { /* nothing old */ }

const optsFor = (date, list) => ({ from: $('from').value, to: $('to').value, date, points: points(), rows: list });
const opts = () => optsFor($('date').value, rows);

// ---------- the grid: one row per train, a NIL row for a point with none, a + on each point ----------
function renderGrid() {
  const body = $('grid').tBodies[0];
  let html = '';
  for (const g of grouped(points(), rows)) {
    const head = (clear) => `${esc(g.point)} <button class="btn small add" data-point="${esc(g.point)}" title="Add a train">+</button>${clear ? `<button class="btn small pc pclear" data-point="${esc(g.point)}" title="Remove this point's rows">clear</button>` : ''}`;
    if (!g.rows.length) {
      html += `<tr class="nil first"><td class="pt">${head(false)}</td><td class="n"></td><td class="nil" colspan="2">NIL</td><td></td></tr>`;
      continue;
    }
    g.rows.forEach((r, i) => {
      const idx = rows.indexOf(r);
      html += `<tr${i === 0 ? ' class="first"' : ''}>
        <td class="pt">${i === 0 ? head(true) : ''}</td>
        <td class="n">${i + 1}</td>
        <td class="tr"><input data-i="${idx}" data-f="train" value="${esc(r.train)}" placeholder="Train" autocapitalize="characters"></td>
        <td><input data-i="${idx}" data-f="remark" value="${esc(r.remark)}" placeholder="Remark" autocapitalize="characters"></td>
        <td><button class="btn x del" data-i="${idx}" title="Remove">×</button></td>
      </tr>`;
    });
  }
  body.innerHTML = html;
}

function renderMessage() {
  $('msg').textContent = deviationsMessage(opts());
}
const render = () => { renderGrid(); renderMessage(); renderSaved(); };

// ---------- the saved days, below: from - to, a search, each day to open, copy, send or remove ----------
const dmy = (iso) => String(iso || '').split('-').reverse().join('-');
function renderSaved() {
  const from = $('sfrom').value, to = $('sto').value;
  const q = $('sq').value.trim().toUpperCase();
  const list = Object.keys(days).filter((d) => days[d].length && (!from || d >= from) && (!to || d <= to)).sort().reverse();
  const out = [];
  for (const d of list) {
    const hits = q ? days[d].filter((r) => `${r.point} ${r.train} ${r.remark}`.toUpperCase().includes(q)) : [];
    if (q && !hits.length) continue;
    const trains = days[d].filter((r) => r.train.trim()).length;
    const pts = new Set(days[d].map((r) => r.point)).size;
    out.push(`<div class="sday${d === $('date').value ? ' cur' : ''}" data-d="${d}">
      <div class="sdhead"><b>${dmy(d)}</b><span class="small">${trains} train${trains === 1 ? '' : 's'} at ${pts} point${pts === 1 ? '' : 's'}${d === $('date').value ? ' · in the editor' : ''}</span></div>
      ${hits.length ? `<ul class="hits">${hits.map((r) => `<li><b>${esc(r.point)}</b> ${esc(r.train)} ${esc(r.remark)}</li>`).join('')}</ul>` : ''}
      <div class="actions"><button class="btn small primary" data-act="open">Open to edit</button><button class="btn small" data-act="copy">Copy message</button><button class="btn small wa" data-act="wa">WhatsApp</button><button class="btn small" data-act="img">Share image</button><button class="btn small x" data-act="del" title="Remove this day">×</button></div>
    </div>`);
  }
  $('saved').innerHTML = out.join('') || `<p class="small">${Object.keys(days).length ? 'No saved day matches.' : 'Nothing saved yet. The rows above are saved under their date as you type.'}</p>`;
  $('scount').textContent = list.length ? `${list.length} day${list.length === 1 ? '' : 's'}` : '';
}
for (const id of ['sfrom', 'sto']) $(id).addEventListener('input', () => { store.set(`dev-${id}`, $(id).value); renderSaved(); });
$('sq').addEventListener('input', renderSaved);
$('sall').onclick = () => { $('sfrom').value = ''; $('sto').value = ''; store.set('dev-sfrom', ''); store.set('dev-sto', ''); renderSaved(); };
$('saved').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const d = b.closest('.sday').dataset.d;
  const o = optsFor(d, days[d] || []);
  if (b.dataset.act === 'open') {
    $('date').value = d; store.set('dev-date', d); openDay(d);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`${dmy(d)} is in the editor.`);
  } else if (b.dataset.act === 'copy') {
    try { await navigator.clipboard.writeText(deviationsMessage(o)); toast(`Message of ${dmy(d)} copied.`); } catch { toast('Could not copy.'); }
  } else if (b.dataset.act === 'wa') {
    sendWhatsApp(o);
  } else if (b.dataset.act === 'img') {
    shareOrSave(await blobOf(sheetToCanvas(deviationsSheet(o)), 'image/png'), `Interchange-deviations-${d}.png`, 'image/png');
  } else if (b.dataset.act === 'del' && confirm(`Remove the deviations of ${dmy(d)}?`)) {
    delete days[d]; saveDays();
    if (d === $('date').value) { rows = []; history.length = 0; $('undo').disabled = true; }
    render();
  }
});

$('grid').addEventListener('click', (e) => {
  const pclear = e.target.closest('button.pclear');
  if (pclear) {
    remember();
    rows = rows.filter((r) => r.point !== pclear.dataset.point);
    save(); render(); toast(`${pclear.dataset.point} cleared. Ctrl+Z brings it back.`);
    return;
  }
  const add = e.target.closest('button.add');
  if (add) {
    remember();
    rows.push({ point: add.dataset.point, train: '', remark: '' });
    save(); render();
    const inputs = $('grid').querySelectorAll(`input[data-f="train"]`);
    const last = [...inputs].find((el) => Number(el.dataset.i) === rows.length - 1);
    if (last) last.focus();
  }
  const del = e.target.closest('button.del');
  if (del) { remember(); rows.splice(Number(del.dataset.i), 1); save(); render(); }
});
// typing updates the row and the message; the grid is not redrawn under the caret. What the box held
// before the typing is remembered once, when it is entered, so Ctrl+Z outside the box takes the typing back.
$('grid').addEventListener('focusin', (e) => { if (e.target.dataset && e.target.dataset.f) remember(); });
$('grid').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.f) return;
  const r = rows[Number(el.dataset.i)];
  if (!r) return;
  r[el.dataset.f] = el.value.toUpperCase();
  save(); renderMessage();
});
$('grid').addEventListener('change', (e) => { if (e.target.dataset.f) render(); });
// Ctrl+Z: inside a box the browser takes back the typing there; anywhere else it is the grid's undo
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); undo(); }
});
$('undo').onclick = undo;
$('undo').disabled = true;
$('grid').addEventListener('keydown', (e) => {
  // Enter on a remark adds the next train at that point
  if (e.key === 'Enter' && e.target.dataset.f === 'remark') {
    e.preventDefault();
    const r = rows[Number(e.target.dataset.i)];
    if (r) $('grid').querySelector(`button.add[data-point="${CSS.escape(r.point)}"]`).click();
  }
});

for (const id of ['from', 'to']) $(id).addEventListener('input', () => { store.set(`dev-${id}`, $(id).value); renderMessage(); });
// the date box picks the day: its rows come into the editor (a day not yet saved starts empty)
const pickDay = (d) => { if (!d) return; $('date').value = d; store.set('dev-date', d); openDay(d); };
$('date').addEventListener('change', () => pickDay($('date').value));
$('yday').onclick = () => pickDay(key(new Date(Date.now() - 86400000)));
$('tday').onclick = () => pickDay(key(new Date()));

// ---------- paste: a list of trains, or rows from Excel ----------
function addRows(got) {
  if (!got.length) { toast('No rows found. Paste the trains one on a line, or the rows from Excel.'); return; }
  remember();
  rows.push(...got);
  save(); render();
  toast(`${got.length} row${got.length === 1 ? '' : 's'} added.`);
}
function addRemarks(point, lines, from = null) {
  if (!lines.length) { toast('No remarks found. Paste them one on a line.'); return false; }
  remember();
  rows = withRemarks(rows, point, lines, from);
  save(); render();
  toast(`${lines.length} remark${lines.length === 1 ? '' : 's'} put on ${point}.`);
  return true;
}
function openPaste(point) {
  const sel = $('ptpoint');
  sel.innerHTML = points().map((p) => `<option>${esc(p)}</option>`).join('');
  sel.value = point || store.get('dev-paste-point') || points()[0];
  if (!sel.value) sel.selectedIndex = 0;
  $('pastebox').hidden = false; $('pt').focus();
}
$('paste').onclick = () => openPaste();
$('ptcancel').onclick = () => { $('pastebox').hidden = true; $('pt').value = ''; };
$('ptadd').onclick = () => {
  store.set('dev-paste-point', $('ptpoint').value);
  const point = $('ptpoint').value;
  if ($('ptkind').value === 'remarks') {
    if (addRemarks(point, parseRemarks($('pt').value))) { $('pastebox').hidden = true; $('pt').value = ''; }
    return;
  }
  const got = parsePaste($('pt').value, { point, points: points() });
  if (got.length) { $('pastebox').hidden = true; $('pt').value = ''; }
  addRows(got);
};
// many lines pasted into a train box: one row each, in order, at that point; into a remark box: the
// remarks of that point's rows from this one on, in order
$('grid').addEventListener('paste', (e) => {
  const el = e.target;
  if (!el.dataset.f) return;
  const text = (e.clipboardData || window.clipboardData).getData('text') || '';
  if (!/\n\s*\S/.test(text.trim())) return;
  e.preventDefault();
  const i = Number(el.dataset.i);
  const r = rows[i];
  if (!r) return;
  if (el.dataset.f === 'remark') { addRemarks(r.point, parseRemarks(text), i); return; }
  const got = parsePaste(text, { point: r.point, points: points() });
  if (!r.train.trim() && got.length) rows.splice(i, 1);
  addRows(got);
});
$('clear').onclick = () => { if (!rows.length || confirm('Remove all the rows? Ctrl+Z brings them back.')) { remember(); rows = []; save(); render(); } };

// ---------- save: the day's rows under its date (they are also saved as they are typed) ----------
$('savebtn').onclick = () => {
  save(); renderSaved();
  const n = rows.filter((r) => r.train.trim()).length;
  toast(rows.length ? `Saved under ${dmy($('date').value)}: ${n} train${n === 1 ? '' : 's'}.` : `Nothing to save for ${dmy($('date').value)}.`);
};

// ---------- out: text, WhatsApp, picture, PDF ----------
const fileName = (ext) => `Interchange-deviations-${$('date').value}.${ext}`;
const blobOf = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
const picture = () => sheetToCanvas(deviationsSheet(opts()));

/** On a phone the share sheet (WhatsApp and the rest); on a computer the file is saved. */
async function shareOrSave(blob, name, type) {
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && window.matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: 'Interchange deviations' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = name; document.body.append(link); link.click(); link.remove();
  toast(`Saved ${name}`);
}

$('copy').onclick = async () => { try { await navigator.clipboard.writeText(deviationsMessage(opts())); toast('Message copied.'); } catch { toast('Could not copy.'); } };
function sendWhatsApp(o) {
  const link = window.matchMedia('(pointer: coarse)').matches ? 'https://wa.me/' : 'https://web.whatsapp.com/send';
  window.open(`${link}?text=${encodeURIComponent(deviationsWhatsApp(o).slice(0, 5500))}`, 'dev-whatsapp');
}
$('wa').onclick = () => sendWhatsApp(opts());
$('img').onclick = async () => shareOrSave(await blobOf(picture(), 'image/png'), fileName('png'), 'image/png');
$('copyimg').onclick = async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobOf(picture(), 'image/png') })]);
    toast('Picture copied. Paste it in WhatsApp or a message.');
  } catch { toast('This browser cannot copy a picture. Use Share image.'); }
};
$('pdf').onclick = async () => {
  const c = picture();
  const jpeg = new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.92)).arrayBuffer());
  shareOrSave(new Blob([buildPdf(jpeg, c.width, c.height)], { type: 'application/pdf' }), fileName('pdf'), 'application/pdf');
};

$('sfrom').value = store.get('dev-sfrom');
$('sto').value = store.get('dev-sto');
openDay($('date').value);
