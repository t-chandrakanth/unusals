// Pure helpers for keeping this device and the shared database in step.
// No network here: sync.js does the talking, this decides what to say.

import { pick } from './logic.js';

export const TABLES = ['locos', 'log', 'reports'];

export function locoRow(loco, pos, by, deleted = false) {
  return {
    id: loco.id, pos, deleted,
    data: { ...pick(loco), updatedAt: loco.updatedAt || '' },
    updated_by: by || '',
  };
}

export function logRow(e) {
  return { id: e.id, loco_id: e.locoId, happened_at: e.at, kind: e.kind, data: e.data, changed_by: e.by || '' };
}

export function reportRow(r, deleted = false) {
  return { id: r.id, sent_at: r.at, day: r.day, locos: r.locos, sent_by: r.by || '', deleted };
}

/** What has to be sent to the database after the state went from prev to next. */
export function diffOps(prev, next, by) {
  const ops = [];
  if (prev.locos !== next.locos) {
    const before = new Map(prev.locos.map((l, i) => [l.id, { l, i }]));
    next.locos.forEach((l, i) => {
      const b = before.get(l.id);
      if (!b || b.l !== l || b.i !== i) ops.push({ table: 'locos', row: locoRow(l, i, by) });
      before.delete(l.id);
    });
    for (const { l, i } of before.values()) ops.push({ table: 'locos', row: locoRow(l, i, by, true) });
  }
  if (prev.log !== next.log) {
    const seen = new Set(prev.log.map((e) => e.id));
    for (const e of next.log) if (!seen.has(e.id)) ops.push({ table: 'log', row: logRow(e) });
  }
  if (prev.reports !== next.reports) {
    const before = new Map(prev.reports.map((r) => [r.id, r]));
    for (const r of next.reports) {
      if (!before.has(r.id)) ops.push({ table: 'reports', row: reportRow(r) });
      before.delete(r.id);
    }
    for (const r of before.values()) ops.push({ table: 'reports', row: reportRow(r, true) });
  }
  return ops;
}

/** Everything on this device, for the very first upload to an empty database. */
export function allOps(state, by) {
  return [
    ...state.locos.map((l, i) => ({ table: 'locos', row: locoRow(l, i, by) })),
    ...state.log.map((e) => ({ table: 'log', row: logRow(e) })),
    ...state.reports.map((r) => ({ table: 'reports', row: reportRow(r) })),
  ];
}

/** Later rows for the same record replace earlier ones; order is kept. */
export function collapse(ops) {
  const last = new Map();
  ops.forEach((op, i) => last.set(`${op.table}/${op.row.id}`, i));
  return ops.filter((op, i) => last.get(`${op.table}/${op.row.id}`) === i);
}

/**
 * Fold rows fetched from the database into the local state. Records with a
 * change still waiting to upload (skip) are left alone so it is not undone.
 */
export function applyRemote(state, table, rows, skip = new Set()) {
  rows = rows.filter((r) => !skip.has(r.id));
  if (!rows.length) return state;
  if (table === 'locos') {
    const items = new Map(state.locos.map((l, i) => [l.id, { loco: l, pos: i }]));
    for (const r of rows) {
      if (r.deleted) items.delete(r.id);
      else items.set(r.id, { loco: { id: r.id, ...r.data, updatedBy: r.updated_by || '' }, pos: r.pos });
    }
    const locos = [...items.values()].sort((a, b) => a.pos - b.pos).map((x) => x.loco);
    return { ...state, locos };
  }
  if (table === 'log') {
    const items = new Map(state.log.map((e) => [e.id, e]));
    for (const r of rows) {
      items.set(r.id, { id: r.id, locoId: r.loco_id, at: new Date(r.happened_at).toISOString(), kind: r.kind, data: r.data, by: r.changed_by || '' });
    }
    const log = [...items.values()].sort((a, b) => a.at.localeCompare(b.at));
    return { ...state, log };
  }
  if (table === 'reports') {
    const items = new Map(state.reports.map((r) => [r.id, r]));
    for (const r of rows) {
      if (r.deleted) items.delete(r.id);
      else items.set(r.id, { id: r.id, at: new Date(r.sent_at).toISOString(), day: r.day, locos: r.locos, by: r.sent_by || '' });
    }
    const reports = [...items.values()].sort((a, b) => a.at.localeCompare(b.at));
    return { ...state, reports };
  }
  return state;
}
