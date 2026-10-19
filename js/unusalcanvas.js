// Draws the one-page report of an unusual record (model from unusalreport.js) on a canvas, in
// the layout of the stalling report: a blue heading, train and wagon details beside the
// sequence of events, remarks and repercussions. The page grows downward when the text needs it.

import { reportModel } from './unusalreport.js';

const W = 1240; // A4 at 150 dpi
const H = 1754;
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
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

/** One report as a canvas, 1240 px wide (about 150 dpi on A4), at least a full page high. */
export async function drawReport(u, scale = 1) {
  const model = reportModel(u);
  const imgs = await Promise.all(model.photos.map(loadImage));
  model.pics = imgs.filter(Boolean);
  const probe = document.createElement('canvas').getContext('2d');
  const height = paint(probe, model, false);
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = Math.max(height, H) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, canvas.height / scale);
  paint(ctx, model, true);
  return canvas;
}

/** Lays the page out; draws it when draw is true. Returns the page height. */
function paint(ctx, m, draw) {
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
  // heading band: long headings are shrunk to fit the band
  rect(M, y, W - 2 * M, 96, BLUE);
  let px = 36;
  font(px, true);
  while (px > 22 && ctx.measureText(m.title).width > W - 2 * M - 48 - 230) { px -= 2; font(px, true); }
  put(m.title, M + 24, y + 12, '#ffffff');
  font(21, false);
  put(m.subtitle, M + 24, y + 58, '#e6eefc');
  font(21, true);
  put(m.when, W - M - 24, y + 14, '#ffffff', 'right');
  y += 96 + 30;

  const section = (title, x, yy, w) => {
    font(24, true);
    put(title, x, yy, BLUE);
    rect(x, yy + 33, w, 2, BLUE);
    return yy + 46;
  };

  /** A table of rows; each row is [label, value, highlighted, labelBold]. Returns the y below it. */
  const table = (x, yy, w, rows, labelShare) => {
    const lw = Math.floor(w * labelShare);
    let yr = yy;
    for (const [label, value, hl, labelBold = true] of rows) {
      font(BASE, labelBold);
      const a = wrap(ctx, label, lw - 2 * PAD);
      font(BASE, false);
      const b = wrap(ctx, value, w - lw - 2 * PAD);
      const rh = Math.max(a.length, b.length) * LH + 2 * PAD - 4;
      rect(x, yr, lw, rh, hl ? HL : LABEL, LINE);
      rect(x + lw, yr, w - lw, rh, hl ? HL : '#ffffff', LINE);
      font(BASE, labelBold);
      lines(a, x + PAD, yr + PAD - 2);
      font(BASE, false);
      lines(b, x + lw + PAD, yr + PAD - 2);
      yr += rh;
    }
    return yr;
  };

  const hasEvents = m.events.length > 0;
  const colW = hasEvents ? Math.floor((W - 2 * M - GAP) * 0.47) : W - 2 * M;
  const rightX = M + colW + GAP;
  const rightW = W - M - rightX;

  let yl = section('Train and wagon details', M, y, colW);
  yl = table(M, yl, colW, m.details, hasEvents ? 0.42 : 0.25);
  let yr = y;
  if (hasEvents) {
    yr = section('Sequence of events', rightX, y, rightW);
    yr = table(rightX, yr, rightW, m.events.map((e) => [e.t || '–', e.text, e.hl, true]), 0.27);
  }
  y = Math.max(yl, yr) + 28;

  if (m.remarks) {
    y = section('Remarks', M, y, W - 2 * M);
    font(BASE, false);
    const rem = wrap(ctx, m.remarks, W - 2 * M - 2 * PAD - 8);
    const remH = rem.length * LH + 2 * PAD;
    rect(M, y, W - 2 * M, remH, '#f7f7f7', LINE);
    font(BASE, false);
    lines(rem, M + PAD + 4, y + PAD - 2);
    y += remH + 28;
  }

  if (m.repercussions.length) {
    y = section('Repercussions', M, y, W - 2 * M);
    // S.NO, TR.NO, ARR, DEP, DET (IN MIN)
    const tw = W - 2 * M;
    const cols = [0.07, 0.22, 0.25, 0.13, 0.13, 0.20].map((f) => Math.floor(tw * f));
    cols[5] = tw - cols[0] - cols[1] - cols[2] - cols[3] - cols[4];
    const xs = [M];
    cols.forEach((c, i) => xs.push(xs[i] + c));
    const rowOf = (cells, head) => {
      font(BASE, !!head);
      const wrapped = cells.map((c, i) => wrap(ctx, c, cols[i] - 2 * PAD));
      const rh = Math.max(...wrapped.map((w) => w.length)) * LH + 2 * PAD - 4;
      cells.forEach((_, i) => {
        rect(xs[i], y, cols[i], rh, head ? LABEL : '#ffffff', LINE);
        font(BASE, !!head);
        lines(wrapped[i], xs[i] + PAD, y + PAD - 2, INK, 'left');
      });
      y += rh;
    };
    rowOf(['S.NO', 'TR.NO', 'STATION', 'ARR', 'DEP', 'DET (IN MIN)'], true);
    m.repercussions.forEach((r, i) => rowOf([String(i + 1), String(r.tr || '').toUpperCase(), String(r.st || '').toUpperCase(), r.arr, r.still ? 'NOT DEPARTED' : r.dep, r.det], false));
    if (m.asOn) {
      font(19, false);
      y += 8;
      y += lines([`Trains not departed: detention counted up to ${m.asOn} HRS.`], M, y);
    }
    y += 28;
  }

  // photographs, two to a row
  const pics = m.pics || [];
  if (pics.length) {
    y = section('Photographs', M, y, W - 2 * M);
    const cw = Math.floor((W - 2 * M - GAP) / 2);
    const ch = 430;
    for (let i = 0; i < pics.length; i += 2) {
      let rowH = 0;
      pics.slice(i, i + 2).forEach((img, j) => {
        const k = Math.min(cw / img.width, ch / img.height);
        const iw = img.width * k;
        const ih = img.height * k;
        const x = M + j * (cw + GAP);
        if (draw) {
          ctx.drawImage(img, x, y, iw, ih);
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 0.5, y + 0.5, iw, ih);
        }
        rowH = Math.max(rowH, ih);
      });
      y += rowH + 24;
    }
    y += 4;
  }

  return y + 20;
}
