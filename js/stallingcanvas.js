// Draws a stalling report on a canvas in the layout of the one-page report: a blue
// heading, the train and stalling details beside the sequence of events, the
// detention, remarks, repercussions, then the load table and the section
// profile (pictures) and the date and signature line. The picture is the
// preview, the WhatsApp / PNG image and, as a JPEG, the PDF.

import {
  reportTitle, reportSubtitle, detailRows, eventsHead, eventsOf, isStallEvent, detentionText, remarksText, writtenRepercussions, markPosition,
} from './stalling.js';

const W = 1240; // A4 at 150 dpi
const M = 56;
const GAP = 30;
const BLUE = '#1f4fa3';
const LINE = '#8d99ad';
const LABEL = '#e8eef9';
const HL = '#fdf0c4';
const INK = '#111111';
const FONT = 'Arial, Helvetica, sans-serif';
const BASE = 21;
const LH = 28;
const PAD = 9;

function wrap(ctx, str, width) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

const loadImage = (src) => new Promise((resolve) => {
  if (!src) { resolve(null); return; }
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/**
 * Draws the report. Returns the canvas. scale: 1 is 1240 px wide (about 150 dpi on A4).
 * The page grows downward when the pictures need it.
 */
export async function drawStalling(s, scale = 1) {
  const [loadImg, profileImg] = await Promise.all([loadImage(s.loadImg), loadImage(s.profileImg)]);
  const probe = document.createElement('canvas').getContext('2d');
  const height = paint(probe, s, { loadImg, profileImg }, false);
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = Math.max(height, 1754) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, canvas.height / scale);
  paint(ctx, s, { loadImg, profileImg }, true);
  return canvas;
}

/** Lays the page out; draws it when draw is true. Returns the page height. */
function paint(ctx, s, imgs, draw) {
  const font = (px, bold) => { ctx.font = `${bold ? 'bold ' : ''}${px}px ${FONT}`; };
  const rect = (x, y, w, h, fill, stroke) => {
    if (!draw) return;
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.strokeRect(x + 0.5, y + 0.5, w, h); }
  };
  const put = (str, x, y, color = INK, align = 'left') => {
    if (!draw) return;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillText(str, x, y);
  };
  const lines = (arr, x, y, color, align) => { arr.forEach((l, i) => put(l, x, y + i * LH, color, align)); return arr.length * LH; };

  let y = 40;

  // heading band
  rect(M, y, W - 2 * M, 96, BLUE);
  font(36, true);
  put(reportTitle(s), M + 24, y + 12, '#ffffff');
  font(21, false);
  put(reportSubtitle(s), M + 24, y + 58, '#e6eefc');
  // when it happened, at the right of the band
  const when = [String(s.day || '').split('-').reverse().join('-'), String(s.stallAt || '').trim() && `${String(s.stallAt).trim()} HRS`].filter(Boolean).join('  \u00b7  ');
  font(21, true);
  put(when, W - M - 24, y + 14, '#ffffff', 'right');
  y += 96 + 30;

  const section = (title, x, yy, w) => {
    font(24, true);
    put(title, x, yy, BLUE);
    rect(x, yy + 33, w, 2, BLUE);
    return yy + 46;
  };

  // two columns
  const colW = Math.floor((W - 2 * M - GAP) * 0.47);
  const rightX = M + colW + GAP;
  const rightW = W - M - rightX;

  /** A table of rows; each row is [labelText, valueText, highlighted]. Returns the y below it. */
  const table = (x, yy, w, rows, labelShare, valueBold) => {
    const lw = Math.floor(w * labelShare);
    let yr = yy;
    for (const [label, value, hl, labelBold = true] of rows) {
      font(BASE, labelBold);
      const a = wrap(ctx, label, lw - 2 * PAD);
      font(BASE, valueBold || false);
      const b = wrap(ctx, value, w - lw - 2 * PAD);
      const rh = Math.max(a.length, b.length) * LH + 2 * PAD - 4;
      rect(x, yr, lw, rh, hl ? HL : LABEL, LINE);
      rect(x + lw, yr, w - lw, rh, hl ? HL : '#ffffff', LINE);
      font(BASE, labelBold);
      lines(a, x + PAD, yr + PAD - 2);
      font(BASE, valueBold || false);
      lines(b, x + lw + PAD, yr + PAD - 2);
      yr += rh;
    }
    return yr;
  };

  // left: train and stalling details
  let yl = section('Train and stalling details', M, y, colW);
  yl = table(M, yl, colW, detailRows(s), 0.42, false);

  // right: sequence of events, then the detention
  let yr = section('Sequence of events', rightX, y, rightW);
  const head = eventsHead(s);
  const evRows = eventsOf(s).map((e) => [e.t || '–', e.text, isStallEvent(e), true]);
  yr = table(rightX, yr, rightW, [...(head ? [[head[0], head[1], false, true]] : []), ...evRows], 0.27, false);
  const det = detentionText(s);
  if (det) {
    font(BASE, true);
    const a = wrap(ctx, det, rightW);
    yr += 12;
    yr += lines(a, rightX, yr);
  }
  y = Math.max(yl, yr) + 28;

  // remarks
  y = section('Remarks', M, y, W - 2 * M);
  font(BASE, false);
  const rem = wrap(ctx, remarksText(s), W - 2 * M - 2 * PAD - 8);
  const remH = rem.length * LH + 2 * PAD;
  rect(M, y, W - 2 * M, remH, '#f7f7f7', LINE);
  font(BASE, false);
  lines(rem, M + PAD + 4, y + PAD - 2);
  y += remH + 28;

  // repercussions
  const rep = writtenRepercussions(s);
  if (rep.length) {
    y = section('Repercussions', M, y, W - 2 * M);
    font(BASE, false);
    rep.forEach((r, i) => { y += lines(wrap(ctx, `${i + 1}. ${r}`, W - 2 * M), M, y); });
    y += 22;
  }

  // a picture under a heading and a note
  const picture = (title, note, img, mark) => {
    if (!img && !note) return;
    y = section(title, M, y, W - 2 * M);
    if (note) { font(19, false); y += lines(wrap(ctx, note, W - 2 * M), M, y) + 6; }
    if (img) {
      const maxW = W - 2 * M;
      const k = Math.min(maxW / img.width, 520 / img.height);
      const iw = img.width * k;
      const ih = img.height * k;
      const x = M;
      if (draw) {
        ctx.drawImage(img, x, y, iw, ih);
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(x + 0.5, y + 0.5, iw, ih);
        if (mark) {
          const mx = x + (Math.max(0, Math.min(100, Number(mark.x))) / 100) * iw;
          ctx.fillStyle = '#e11d1d';
          ctx.fillRect(mx - 2, y, 4, ih);
          font(18, true);
          const label = mark.label;
          const tw = ctx.measureText(label).width + 20;
          const lx = mx + tw > x + iw ? mx - tw : mx;
          ctx.fillStyle = '#e11d1d';
          ctx.fillRect(lx, y, tw, 30);
          put(label, lx + 10, y + 5, '#ffffff');
        }
      }
      y += ih;
    }
    y += 28;
  };
  const km = String(s.km || '').trim();
  picture(String(s.loadHead || '').trim() || 'Load table', s.loadNote, imgs.loadImg, null);
  picture(String(s.profileHead || '').trim() || 'Section profile at the stalling point', s.profileNote, imgs.profileImg,
    imgs.profileImg && markPosition(s) !== null ? { x: markPosition(s), label: `Stall km ${km}`.trim() } : null);

  // date and signature
  y += 6;
  font(19, false);
  put('Date: ____________', M, y);
  put('Signature: ______________________', W - M, y, INK, 'right');
  y += LH + 36;
  return y;
}
