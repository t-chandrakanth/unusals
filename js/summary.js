// The daily summary of unusual reports, as a WhatsApp message: counts first,
// then a short entry for each report. Pure functions, no DOM.

import { fmtDay } from './logic.js';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const GROUPS = [['loco', 'LOCO FAILURES'], ['cw', 'C&W FAILURES'], ['other', 'OTHERS']];

/** "07-09-2026 (MONDAY)" */
export function officialDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${fmtDay(key)} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

/** The start of the reason on one line, cut at a word. */
export function shortReason(text, max = 110) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}...`;
}

/**
 * The message for one day. list: the reports; day: 'YYYY-MM-DD'.
 * options.title: the heading; options.kindOf: which group a report is in;
 * options.groups: the groups to show (default loco, C&W, others).
 */
export function dailySummary(list, day, { title = 'UNUSUAL REPORTS', kindOf = (u) => u.type || 'loco', groups = GROUPS } = {}) {
  const today = list.filter((u) => u.day === day)
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''));
  const lines = [`*${title}: DAILY REPORT*`, officialDay(day), ''];
  if (!today.length) {
    lines.push('NIL: no unusual reports.');
    return lines.join('\n');
  }
  const counts = groups.map(([k, name]) => [name, today.filter((u) => kindOf(u) === k).length]).filter(([, n]) => n > 0);
  lines.push(`*Total: ${today.length}*${counts.length > 1 ? `  (${counts.map(([name, n]) => `${name.toLowerCase()} ${n}`).join(', ')})` : ''}`);
  for (const [k, name] of groups) {
    const items = today.filter((u) => kindOf(u) === k);
    if (!items.length) continue;
    lines.push('', `*${name} (${items.length})*`);
    items.forEach((u, i) => {
      const parts = [u.location, u.trainNo && `Train ${u.trainNo}`, u.locoNo && `Loco ${u.locoNo}`, u.det && `DET ${u.det}`].filter(Boolean);
      lines.push(`${i + 1}. *${u.title || 'UNUSUAL REPORT'}*${parts.length ? `: ${parts.join(' | ')}` : ''}`);
      const why = shortReason(u.reason);
      if (why) lines.push(`   ${why}`);
    });
  }
  return lines.join('\n');
}
