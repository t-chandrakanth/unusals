// A one-page PDF holding a picture (a JPEG), made without any library, so a
// report picture can be saved or sent as a PDF. Pure function, no DOM.

/** jpeg: bytes of a JPEG; w, h: its size in pixels. Returns the bytes of an A4 PDF with it on the page. */
export function buildPdf(jpeg, w, h) {
  const PW = 595.28;
  const PH = 841.89;
  const M = 28;
  const k = Math.min((PW - 2 * M) / w, (PH - 2 * M) / h);
  const dw = w * k;
  const dh = h * k;
  const x = (PW - dw) / 2;
  const y = PH - M - dh;
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (u8) => { parts.push(u8); len += u8.length; };
  const text = (s) => push(enc.encode(s));
  const obj = (n, body) => { offsets[n] = len; text(`${n} 0 obj\n${body}\nendobj\n`); };

  text('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  offsets[5] = len;
  text(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  text('\nendstream\nendobj\n');
  const xref = len;
  text(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
