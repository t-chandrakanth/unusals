// Draws a sheet model (see sheet.js) to a canvas, for sharing as a picture.

import { STYLES } from './sheet.js';

const FONT = 'bold 15px Arial, Helvetica, sans-serif';
const LINE = 19;
const PAD = 6;
const CHAR = 9; // pixels per character of column width

function wrap(ctx, text, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (let word of para.split(' ')) {
      // A single word wider than the cell is broken by characters.
      while (ctx.measureText(word).width > width && word.length > 1) {
        let n = word.length;
        while (n > 1 && ctx.measureText(line ? `${line} ${word.slice(0, n)}` : word.slice(0, n)).width > width) n--;
        if (n <= 1 && line) { lines.push(line); line = ''; continue; }
        lines.push(line ? `${line} ${word.slice(0, n)}` : word.slice(0, n));
        line = '';
        word = word.slice(n);
      }
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > width && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function sheetToCanvas(sheet, scale = 2) {
  const colW = sheet.cols.map((c) => c * CHAR + PAD * 2);
  const colX = [0];
  for (const w of colW) colX.push(colX[colX.length - 1] + w);

  const probe = document.createElement('canvas').getContext('2d');
  probe.font = FONT;

  // First pass: wrap text and work out row heights.
  const laid = sheet.rows.map((row) => row.map((cell, c) => {
    if (!cell) return null;
    const w = colX[c + (cell.colSpan || 1)] - colX[c];
    return { cell, w, lines: wrap(probe, cell.v, w - PAD * 2) };
  }));
  const rowH = laid.map((row) => {
    let h = LINE + PAD * 2;
    for (const it of row) if (it && (it.cell.rowSpan || 1) === 1) h = Math.max(h, it.lines.length * LINE + PAD * 2);
    return h;
  });
  const rowY = [0];
  for (const h of rowH) rowY.push(rowY[rowY.length - 1] + h);

  const margin = 8;
  const canvas = document.createElement('canvas');
  canvas.width = (colX[colX.length - 1] + margin * 2) * scale;
  canvas.height = (rowY[rowY.length - 1] + margin * 2) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(margin, margin);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#000000';

  laid.forEach((row, r) => row.forEach((it, c) => {
    if (!it) return;
    const st = STYLES[it.cell.s] || STYLES.cell;
    const x = colX[c], y = rowY[r];
    const h = rowY[r + (it.cell.rowSpan || 1)] - y;
    if (st.bg) { ctx.fillStyle = st.bg; ctx.fillRect(x, y, it.w, h); }
    if (!st.noBorder) ctx.strokeRect(x + 0.5, y + 0.5, it.w, h);
    ctx.fillStyle = st.color;
    ctx.textAlign = st.align === 'left' ? 'left' : 'center';
    const tx = st.align === 'left' ? x + PAD : x + it.w / 2;
    const top = y + h / 2 - ((it.lines.length - 1) * LINE) / 2;
    it.lines.forEach((line, i) => ctx.fillText(line, tx, top + i * LINE));
  }));
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
