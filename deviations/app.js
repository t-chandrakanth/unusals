// Interchange deviations: the rows typed or pasted in, the message to CFTM out (text, WhatsApp, picture, PDF).

import { DEFAULT_POINTS, parsePoints, parsePaste, grouped, deviationsMessage, deviationsWhatsApp, deviationsSheet } from '../js/deviations.js';
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

// ---------- state: the rows, the points, the heading fields; all kept on the device ----------
let rows = [];
try { rows = JSON.parse(store.get('dev-rows', '[]')); if (!Array.isArray(rows)) rows = []; } catch { rows = []; }
const points = () => parsePoints(store.get('dev-points'));
const save = () => store.set('dev-rows', JSON.stringify(rows));

const today = new Date();
$('date').value = store.get('dev-date') || key(new Date(today.getTime() - 86400000));
$('from').value = store.get('dev-from') || 'SR.DOM/SC';
$('to').value = store.get('dev-to') || 'CFTM/SCR';
$('points').value = store.get('dev-points');

const opts = () => ({ from: $('from').value, to: $('to').value, date: $('date').value, points: points(), rows });

// ---------- the grid: one row per train, a NIL row for a point with none, a + on each point ----------
function renderGrid() {
  const body = $('grid').tBodies[0];
  let html = '';
  for (const g of grouped(points(), rows)) {
    if (!g.rows.length) {
      html += `<tr class="nil first"><td class="pt">${esc(g.point)} <button class="btn small add" data-point="${esc(g.point)}" title="Add a train">+</button></td><td class="n"></td><td class="nil" colspan="2">NIL</td><td></td></tr>`;
      continue;
    }
    g.rows.forEach((r, i) => {
      const idx = rows.indexOf(r);
      html += `<tr${i === 0 ? ' class="first"' : ''}>
        <td class="pt">${i === 0 ? `${esc(g.point)} <button class="btn small add" data-point="${esc(g.point)}" title="Add a train">+</button>` : ''}</td>
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
const render = () => { renderGrid(); renderMessage(); };

$('grid').addEventListener('click', (e) => {
  const add = e.target.closest('button.add');
  if (add) {
    rows.push({ point: add.dataset.point, train: '', remark: '' });
    save(); render();
    const inputs = $('grid').querySelectorAll(`input[data-f="train"]`);
    const last = [...inputs].find((el) => Number(el.dataset.i) === rows.length - 1);
    if (last) last.focus();
  }
  const del = e.target.closest('button.del');
  if (del) { rows.splice(Number(del.dataset.i), 1); save(); render(); }
});
// typing updates the row and the message; the grid is not redrawn under the caret
$('grid').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.f) return;
  const r = rows[Number(el.dataset.i)];
  if (!r) return;
  r[el.dataset.f] = el.value.toUpperCase();
  save(); renderMessage();
});
$('grid').addEventListener('change', (e) => { if (e.target.dataset.f) render(); });
$('grid').addEventListener('keydown', (e) => {
  // Enter on a remark adds the next train at that point
  if (e.key === 'Enter' && e.target.dataset.f === 'remark') {
    e.preventDefault();
    const r = rows[Number(e.target.dataset.i)];
    if (r) $('grid').querySelector(`button.add[data-point="${CSS.escape(r.point)}"]`).click();
  }
});

for (const id of ['from', 'to', 'date']) $(id).addEventListener('input', () => { store.set(`dev-${id}`, $(id).value); renderMessage(); });
$('yday').onclick = () => { $('date').value = key(new Date(Date.now() - 86400000)); store.set('dev-date', $('date').value); renderMessage(); };
$('tday').onclick = () => { $('date').value = key(new Date()); store.set('dev-date', $('date').value); renderMessage(); };

// ---------- paste from Excel ----------
$('paste').onclick = () => { $('pastebox').hidden = false; $('pt').focus(); };
$('ptcancel').onclick = () => { $('pastebox').hidden = true; $('pt').value = ''; };
$('ptadd').onclick = () => {
  const got = parsePaste($('pt').value);
  if (!got.length) { toast('No rows found. Each row needs the IC point, the train and the remark.'); return; }
  rows.push(...got);
  save(); render();
  $('pastebox').hidden = true; $('pt').value = '';
  toast(`${got.length} row${got.length === 1 ? '' : 's'} added.`);
};
$('clear').onclick = () => { if (!rows.length || confirm('Remove all the rows?')) { rows = []; save(); render(); } };

// ---------- the points ----------
$('psave').onclick = () => { store.set('dev-points', $('points').value); render(); toast('Saved'); };
$('preset').onclick = () => { store.set('dev-points', ''); $('points').value = ''; render(); toast(`The usual ${DEFAULT_POINTS.length} points.`); };

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
$('wa').onclick = () => {
  const link = window.matchMedia('(pointer: coarse)').matches ? 'https://wa.me/' : 'https://web.whatsapp.com/send';
  window.open(`${link}?text=${encodeURIComponent(deviationsWhatsApp(opts()).slice(0, 5500))}`, 'dev-whatsapp');
};
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

render();
