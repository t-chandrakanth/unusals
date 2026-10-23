// CAF bound position: two pasted sheets in, the three-column table out (screen, picture, PDF, Excel, text).

import { cafPosition, cafSheet, cafText, cafTitle, count, ocrToRows, parseOwn } from '../js/caf.js';
import { sheetToCanvas } from '../js/canvas.js';
import { STYLES } from '../js/sheet.js';
import { sheetToXlsx } from '../js/xlsx.js';
import { buildPdf } from '../js/pdf.js';

// the look of the sheet this replaces: a red title, pink SNO headings, grey and white rows, green for a handover
Object.assign(STYLES, {
  cafTitle: { bg: '#FFFFFF', color: '#D93025', align: 'center' },
  cafHead: { bg: '#FFFFFF', color: '#111111', align: 'center' },
  cafPink: { bg: '#F2D7E0', color: '#111111', align: 'center' },
  cafNo: { bg: '#FFFFFF', color: '#111111', align: 'center' },
  cafNoAlt: { bg: '#F2F2F2', color: '#111111', align: 'center' },
  cafText: { bg: '#FFFFFF', color: '#111111', align: 'left' },
  cafTextAlt: { bg: '#F2F2F2', color: '#111111', align: 'left' },
  cafHo: { bg: '#CFE8D6', color: '#111111', align: 'left' },
});

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dmy = (k) => String(k).split('-').reverse().join('-');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };

// the station list (code -> name, state, zone) and the user's own lines over it
let stations = {};
const own = () => parseOwn(store.get('caf-own'));
const lookup = () => ({ stations, own: own() });

const today = new Date();
const yesterday = new Date(today.getTime() - 86400000);
$('d1').value = store.get('caf-d1') || key(yesterday);
$('d2').value = store.get('caf-d2') || key(today);
$('t1').value = store.get('caf-t1');
$('t2').value = store.get('caf-t2');
$('zt').value = store.get('caf-own');

// ---------- the user's corrections to a day's table ----------
// The three lists as the user left them, over what the sheet gave. Kept on this device; dropped when that sheet changes.
const COLS = ['caf', 'jsg', 'jbp'];
const edits = {
  get(id) { try { const e = JSON.parse(store.get(`caf-edit-${id}`, 'null')); return e && COLS.every((c) => Array.isArray(e[c])) ? e : null; } catch { return null; } },
  set(id, e) { store.set(`caf-edit-${id}`, e ? JSON.stringify(e) : ''); },
};

const days = () => {
  const lk = lookup();
  return [
    { id: 't1', prefix: 'YDAY', date: dmy($('d1').value), p: cafPosition($('t1').value, lk), has: $('t1').value.trim() },
    { id: 't2', prefix: 'TODAY', date: dmy($('d2').value), p: cafPosition($('t2').value, lk), has: $('t2').value.trim() },
  ].filter((d) => d.has).map((d) => {
    const e = edits.get(d.id);
    return e ? { ...d, edited: true, p: { ...d.p, ...e } } : d;
  });
};

const isHo = (line) => /\bH\/O\b/.test(line);

function show() {
  const list = days();
  $('actions').hidden = !list.length;
  const out = $('out');
  out.replaceChildren();
  const missing = new Set();
  for (const { id, prefix, date, p, edited } of list) {
    p.unknown.forEach((n) => missing.add(n));
    // one spare row under the trains, to type a new one into
    const n = Math.max(p.caf.length, p.jsg.length, p.jbp.length, 1) + 1;
    const cells = (items, i, col) => {
      const v = items[i] || '';
      const cls = [v && isHo(v) ? 'ho' : '', i === items.length ? 'spare' : ''].filter(Boolean).join(' ');
      return `<td class="n">${v ? i + 1 : ''}</td><td class="e${cls ? ' ' + cls : ''}" contenteditable="true" spellcheck="false" data-day="${id}" data-col="${col}" data-i="${i}">${esc(v)}</td>`;
    };
    let rows = '';
    for (let i = 0; i < n; i++) rows += `<tr>${cells(p.caf, i, 'caf')}${cells(p.jsg, i, 'jsg')}${cells(p.jbp, i, 'jbp')}</tr>`;
    out.insertAdjacentHTML('beforeend', `<section class="day"><h3>${esc(cafTitle(prefix, date, p))}</h3>
      <table><thead><tr><th>SNO</th><th>VIA CAF</th><th class="p">SNO</th><th>VIA CAF, JSGR, JSG</th><th class="p">SNO</th><th>VIA CAF, JBP</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="small hint">Tap a train to correct it; the empty row adds one; clear a train to remove it. The picture, PDF, Excel and text follow.${edited ? ` <button class="btn small undo" data-day="${id}">Undo my edits</button>` : ''}</p></section>`);
  }
  if (missing.size) {
    out.insertAdjacentHTML('afterbegin', `<p class="small bad">No state found for ${esc([...missing].join(', '))}. Add ${missing.size > 1 ? 'them' : 'it'} under "New train names", as NAME = BRACKET, State.</p>`);
  }
  if (!list.length) out.innerHTML = '<p class="small">Paste a sheet above to see the CAF bound trains.</p>';
}

for (const id of ['t1', 't2', 'd1', 'd2']) {
  $(id).addEventListener('input', () => {
    store.set(`caf-${id}`, $(id).value);
    // the sheet is the source: when it changes, corrections made to the old table no longer fit
    if (id.startsWith('t') && edits.get(id)) { edits.set(id, null); toast('The sheet changed, so your edits to its table were dropped.'); }
    show();
  });
}

// typing in a cell: Enter or leaving the cell keeps it, Escape puts the old text back
const cellOf = (el) => el && el.closest ? el.closest('td.e') : null;
let cellWas = '';
$('out').addEventListener('focusin', (e) => { const td = cellOf(e.target); if (td) cellWas = td.textContent; });
$('out').addEventListener('keydown', (e) => {
  const td = cellOf(e.target);
  if (!td) return;
  if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
  if (e.key === 'Escape') { td.textContent = cellWas; td.blur(); }
});
$('out').addEventListener('focusout', (e) => {
  const td = cellOf(e.target);
  if (!td) return;
  const text = td.textContent.replace(/\s+/g, ' ').trim();
  if (text === cellWas.trim()) return;
  const { day, col } = td.dataset;
  const i = Number(td.dataset.i);
  const d = days().find((x) => x.id === day);
  if (!d) return;
  const e2 = Object.fromEntries(COLS.map((c) => [c, [...d.p[c]]]));
  if (i < e2[col].length) e2[col][i] = text; else if (text) e2[col].push(text);
  e2[col] = e2[col].filter(Boolean);
  edits.set(day, e2);
  // the table is drawn again (numbers, count, colours); a Tab moves on to the same next cell
  const next = cellOf(e.relatedTarget);
  const to = next && `td.e[data-day="${next.dataset.day}"][data-col="${next.dataset.col}"][data-i="${next.dataset.i}"]`;
  show();
  if (to) { const el = $('out').querySelector(to); if (el) el.focus(); }
});
$('out').addEventListener('click', (e) => {
  const b = e.target.closest('button.undo');
  if (b) { edits.set(b.dataset.day, null); show(); toast('Back to what the sheet gave.'); }
});

// ---------- pictures of the sheet: pasted or added, read for their CAF trains ----------

/** Reads the pictures and adds the CAF trains found in them to the box, without repeating a train that is there. */
async function readPictures(files, id) {
  const box = $(id);
  let added = 0;
  try {
    const { imageToText } = await import('../js/filetext.js');
    for (const file of files) {
      toast('Reading the picture. The first time it can take a minute...');
      const text = await imageToText(file, (pct) => toast(`Reading the picture: ${pct}%`));
      const rows = ocrToRows(text).split('\n').slice(1);
      const have = box.value;
      const fresh = rows.filter((r) => {
        const [, train, , , , location] = r.split('\t');
        return !have.split('\n').some((l) => l.includes(train) && (!location || l.includes(location)));
      });
      if (fresh.length) {
        box.value = [box.value.trim(), ocrToRows(text).split('\n')[0], ...fresh].filter(Boolean).join('\n');
        added += fresh.length;
      }
    }
  } catch (e) {
    toast(e && e.message ? e.message : 'The picture could not be read.');
    return;
  }
  box.dispatchEvent(new Event('input'));
  toast(added ? `${added} CAF train${added === 1 ? '' : 's'} read from the picture. Please check them.` : 'No CAF trains were found in the picture.');
}

for (const id of ['t1', 't2']) {
  // a picture on its own is read; when text comes with it (Excel puts both on the clipboard) the text is used
  $(id).addEventListener('paste', (e) => {
    const data = e.clipboardData;
    const pics = [...((data && data.files) || [])].filter((f) => /^image\//.test(f.type));
    if (pics.length && !(data.getData('text') || '').trim()) { e.preventDefault(); readPictures(pics, id); }
  });
}
document.querySelectorAll('button.pic').forEach((b) => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.multiple = true; input.hidden = true;
  input.onchange = () => { const files = [...input.files]; input.value = ''; if (files.length) readPictures(files, b.dataset.for); };
  b.after(input);
  b.onclick = () => input.click();
});

const allText = () => days().map((d) => cafText(d.prefix, d.date, d.p)).join('\n\n');

/** The sheet model of a day, in the look above. */
function styled(prefix, date, p) {
  const sheet = cafSheet(prefix, date, p);
  const map = { title: 'cafTitle', serial: 'cafHead', head: 'cafHead', cell: 'cafNo', alt: 'cafNoAlt', text: 'cafText', altText: 'cafTextAlt' };
  sheet.rows.forEach((row, r) => row.forEach((c, i) => {
    if (!c) return;
    c.s = map[c.s] || c.s;
    if (r === 1 && i % 2 === 0 && i > 0) c.s = 'cafPink';
    if (r > 1 && i % 2 === 1 && isHo(c.v)) c.s = 'cafHo';
  }));
  return sheet;
}

/** Both days as one picture. */
function picture() {
  const canvases = days().map((d) => sheetToCanvas(styled(d.prefix, d.date, d.p)));
  const w = Math.max(...canvases.map((c) => c.width));
  const h = canvases.reduce((t, c) => t + c.height, 0);
  const all = document.createElement('canvas');
  all.width = w; all.height = h;
  const ctx = all.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  let y = 0;
  for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height; }
  return all;
}
const blobOf = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
const fileName = (ext) => `CAF-bound-${$('d2').value}.${ext}`;

/** On a phone the share sheet (WhatsApp and the rest); on a computer the file is saved. */
async function shareOrSave(blob, name, type) {
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && window.matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: 'CAF bound position' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = name; document.body.append(link); link.click(); link.remove();
  toast(`Saved ${name}`);
}

$('img').onclick = async () => shareOrSave(await blobOf(picture(), 'image/png'), fileName('png'), 'image/png');
$('pdf').onclick = async () => {
  const c = picture();
  const jpeg = new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.92)).arrayBuffer());
  shareOrSave(new Blob([buildPdf(jpeg, c.width, c.height)], { type: 'application/pdf' }), fileName('pdf'), 'application/pdf');
};
$('xls').onclick = () => {
  // both days in one sheet, one under the other
  const sheets = days().map((d) => styled(d.prefix, d.date, d.p));
  const rows = [];
  sheets.forEach((s, i) => {
    if (i) rows.push([{ v: '', s: 'gap', colSpan: 6 }, null, null, null, null, null]);
    rows.push(...s.rows);
  });
  const bytes = sheetToXlsx({ name: 'CAF bound', cols: sheets[0].cols, rows });
  shareOrSave(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName('xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
};
$('copyimg').onclick = async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobOf(picture(), 'image/png') })]);
    toast('Picture copied. Paste it in WhatsApp or a message.');
  } catch { toast('This browser cannot copy a picture. Use Share image.'); }
};
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(allText()); toast('Copied. Paste it in WhatsApp.'); } catch { toast('Could not copy.'); } };
$('wa').onclick = () => {
  const link = window.matchMedia('(pointer: coarse)').matches ? 'https://wa.me/' : 'https://web.whatsapp.com/send';
  window.open(`${link}?text=${encodeURIComponent(allText().slice(0, 5500))}`, 'caf-whatsapp');
};
$('clear').onclick = () => { for (const id of ['t1', 't2']) { $(id).value = ''; store.set(`caf-${id}`, ''); edits.set(id, null); } show(); };
$('zsave').onclick = () => { store.set('caf-own', $('zt').value); show(); toast('Saved'); };
$('zreset').onclick = () => { store.set('caf-own', ''); $('zt').value = ''; show(); toast('Cleared'); };

fetch('stations.json').then((r) => r.json()).then((s) => { stations = s; show(); }).catch(() => { toast('The station list could not be loaded.'); show(); });
show();
