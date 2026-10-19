// A PDF holding pictures (JPEGs), one on each A4 page, made without any library, so a
// report picture can be saved or sent as a PDF. Pure functions, no DOM.

const PW = 595.28;
const PH = 841.89;
const M = 28;

/** pages: [{ jpeg: bytes of a JPEG, w, h: its size in pixels }]. Returns the bytes of an A4 PDF, a picture to a page. */
export function buildPdfPages(pages) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (u8) => { parts.push(u8); len += u8.length; };
  const text = (s) => push(enc.encode(s));
  const obj = (n, body) => { offsets[n] = len; text(`${n} 0 obj\n${body}\nendobj\n`); };

  const n = pages.length;
  // objects: 1 catalog, 2 pages, then a page, its content and its picture for each
  text('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] /Count ${n} >>`);
  pages.forEach(({ jpeg, w, h }, i) => {
    const k = Math.min((PW - 2 * M) / w, (PH - 2 * M) / h);
    const dw = w * k;
    const dh = h * k;
    const x = (PW - dw) / 2;
    const y = PH - M - dh;
    const page = 3 + 3 * i;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    obj(page + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[page + 2] = len;
    text(`${page + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    text('\nendstream\nendobj\n');
  });
  const total = 3 + 3 * n;
  const xref = len;
  const ids = Array.from({ length: total - 1 }, (_, i) => i + 1);
  text(`xref\n0 ${total}\n0000000000 65535 f \n${ids.map((id) => `${String(offsets[id]).padStart(10, '0')} 00000 n \n`).join('')}`);
  text(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** jpeg: bytes of a JPEG; w, h: its size in pixels. Returns the bytes of an A4 PDF with it on the page. */
export const buildPdf = (jpeg, w, h) => buildPdfPages([{ jpeg, w, h }]);
