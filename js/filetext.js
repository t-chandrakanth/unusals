// Turns an attached file into plain text, so the report reader (official.js)
// can work on it exactly as it does on pasted text.
//   .pdf   read in the browser with pdf.js (loaded from a CDN the first time)
//   .xlsx  read directly: an .xlsx is a zip of XML files
//   .csv / .txt  as they are

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export class FileError extends Error {}

// ---------- zip / xlsx ----------

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The named entries of a zip file (only those the filter accepts), as bytes. */
export async function unzip(buffer, wanted) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new FileError('This is not an Excel (.xlsx) file.');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const dataAt = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + size);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
  }
  return out;
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const textOf = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** All sheets of an .xlsx as text: a line per row, cells separated by tabs. */
export async function xlsxToText(buffer) {
  const dec = new TextDecoder();
  const files = await unzip(buffer, (n) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(n));
  const shared = files.has('xl/sharedStrings.xml')
    ? [...dec.decode(files.get('xl/sharedStrings.xml')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const sheets = [...files.keys()].filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!sheets.length) throw new FileError('No sheet found in that Excel file.');
  const lines = [];
  for (const name of sheets) {
    const xml = dec.decode(files.get(name));
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (/\br="([A-Z]+\d+)"/.exec(c[1]) || [])[1];
        if (!ref || !c[2]) continue;
        const type = (/\bt="(\w+)"/.exec(c[1]) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(c[2]) || [])[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] || '';
        else if (type === 'inlineStr') value = textOf(c[2]);
        else if (v != null) value = unescapeXml(v);
        if (value !== '') cells[colIndex(ref)] = value;
      }
      const line = Array.from(cells, (x) => x || '').join('\t').replace(/\s+$/, '');
      if (line) lines.push(line);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------- pdf ----------

function loadPdfjs() {
  if (globalThis.pdfjsLib) return Promise.resolve(globalThis.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS;
    s.onload = () => {
      globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(globalThis.pdfjsLib);
    };
    s.onerror = () => reject(new FileError('Could not load the PDF reader. Connect to the internet once and try again, or paste the text instead.'));
    document.head.append(s);
  });
}

/** Text of every page, a line per row of text on the page. */
export async function pdfToText(buffer) {
  const lib = await loadPdfjs();
  let pdf;
  try {
    pdf = await lib.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch {
    throw new FileError('That PDF could not be opened.');
  }
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const items = content.items.filter((i) => i.str && i.str.trim())
      .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let y = null;
    for (const it of items) {
      if (y === null || Math.abs(it.y - y) > 3) { lines.push([]); y = it.y; }
      lines[lines.length - 1].push(it);
    }
    pages.push(lines.map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.s.trim()).join(' ')).join('\n'));
  }
  if (!pages.join('').trim()) throw new FileError('That PDF has no readable text (it may be a scanned picture).');
  return fixLigatures(pages.join('\n'));
}

// The Sr.DEE PDF stores the letter pairs "ti" and "ft" as one glyph that
// copies out as a broken character: "Sec � on", "Train le � LTRR".
const FT_BEFORE = /^(le|shi|li|so|dri)$/i;
const CONTINUES = /^(on|onal|ons|ng|ve|vely|er|ed|ing)(?=[^a-z]|$)/;

/** Puts "ti" / "ft" back where the PDF lost them. */
export function fixLigatures(text) {
  return text.replace(/(\S*)[ \t]*�[ \t]*(\S*)/g, (_, left, right) => {
    const ft = FT_BEFORE.test(left) || (/^a$/i.test(left) && /^er/.test(right));
    const glue = ft ? 'ft' : 'ti';
    return CONTINUES.test(right) ? `${left}${glue}${right}` : `${left}${glue} ${right}`.trimEnd();
  });
}

// ---------- word (.docx) ----------

/**
 * A Word document as text: a line per paragraph, and a line per table row with
 * the cells separated by tabs (a cell with several paragraphs keeps them as
 * lines). Headers, footers and text boxes are left out.
 */
export async function docxToText(buffer) {
  const files = await unzip(buffer, (n) => n === 'word/document.xml');
  if (!files.has('word/document.xml')) throw new FileError('That is not a Word (.docx) file. Old .doc files must be saved as .docx first.');
  const xml = new TextDecoder().decode(files.get('word/document.xml'));
  const lines = [];
  let row = null; // cells of the table row being read
  let cell = null; // paragraphs of the cell being read
  let para = null; // text of the paragraph being read
  const token = /<w:tbl\b[^>]*>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>|<w:tc\b[^>]*>|<\/w:tc>|<w:p\b[^>]*\/>|<w:p\b[^>]*>|<\/w:p>|<w:t\b[^>]*>[^<]*<\/w:t>|<w:tab\s*\/>|<w:br\b[^>]*\/>|<w:noBreakHyphen\s*\/>/g;
  for (const m of xml.matchAll(token)) {
    const t = m[0];
    if (t.startsWith('<w:tr ') || t === '<w:tr>') row = [];
    else if (t.startsWith('<w:tc ') || t === '<w:tc>') cell = [];
    else if (t.startsWith('<w:p ') || t === '<w:p>') para = '';
    else if (/^<w:p\b.*\/>$/.test(t)) { if (cell) cell.push(''); else lines.push(''); }
    else if (t.startsWith('<w:t ') || t.startsWith('<w:t>')) { if (para !== null) para += unescapeXml(t.replace(/<[^>]+>/g, '')); }
    else if (t.startsWith('<w:tab')) { if (para !== null) para += ' '; }
    else if (t.startsWith('<w:br')) { if (para !== null) para += '\n'; }
    else if (t.startsWith('<w:noBreakHyphen')) { if (para !== null) para += '-'; }
    else if (t === '</w:p>') {
      if (para !== null) { if (cell) cell.push(para); else lines.push(para); }
      para = null;
    } else if (t === '</w:tc>') {
      if (row && cell) row.push(cell.join('\n').replace(/\n+$/, ''));
      cell = null;
    } else if (t === '</w:tr>') {
      if (row) lines.push(row.join('\t'));
      row = null;
    }
  }
  return lines.join('\n');
}

/** Plain text of a PDF, Word (.docx), Excel (.xlsx), CSV or text file. */
export async function fileToText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return pdfToText(await file.arrayBuffer());
  if (name.endsWith('.xlsx')) return xlsxToText(await file.arrayBuffer());
  if (name.endsWith('.docx') || name.endsWith('.docm')) return docxToText(await file.arrayBuffer());
  if (name.endsWith('.doc')) throw new FileError('Old .doc files cannot be read. In Word use Save As, choose .docx, and attach that.');
  if (name.endsWith('.xls')) throw new FileError('Old .xls files cannot be read. In Excel use Save As, choose .xlsx, and attach that.');
  if (/\.(csv|txt)$/.test(name)) return (await file.text()).replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '\t');
  throw new FileError('Attach a Word (.docx), PDF or Excel (.xlsx) file.');
}
