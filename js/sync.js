// Talks to the shared database (Supabase) over its plain web API.
//
// Changes made on this device go into an outbox that is saved with the rest
// of the state, so they survive being offline or closing the app, and are
// uploaded as soon as the network is back. Changes made by other people are
// fetched every half minute and whenever the app comes back into view.

import { TABLES, allOps, collapse, applyRemote } from './syncdata.js';

const SESSION_KEY = 'loco-tracker-session';
const NAME_KEY = 'loco-tracker-name';
const EPOCH = '1970-01-01T00:00:00Z';
const PAGE = 1000;
const POLL_MS = 30000;

export function createSync({ url, key, login, getState, setState, onStatus }) {
  url = url.replace(/\/+$/, '');
  let session = null;
  if (login) {
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { /* none */ }
  } else {
    // Open access: no sign-in. The person's name is only a label on their
    // updates, kept on this device.
    let name = '';
    try { name = localStorage.getItem(NAME_KEY) || ''; } catch { /* private mode */ }
    session = { access: key, email: name, open: true };
  }
  let running = null;
  let again = false;
  let timer = null;
  let lastError = '';

  const syncInfo = () => getState().sync || { outbox: [], cursor: {}, linked: false };
  const pending = () => syncInfo().outbox.length;

  function report(phase) {
    onStatus({ phase, pending: pending(), email: session ? session.email : '', error: lastError });
  }

  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* private mode */ }
  }

  async function auth(grant, body) {
    const res = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error_description || data.msg || data.message || 'Sign-in failed');
      err.status = res.status;
      throw err;
    }
    saveSession({
      access: data.access_token,
      refresh: data.refresh_token,
      expires: Date.now() + (data.expires_in || 3600) * 1000,
      email: (data.user && data.user.email) || body.email || (session && session.email) || '',
    });
  }

  async function token() {
    if (!session) throw Object.assign(new Error('Not signed in'), { status: 401 });
    if (!session.open && Date.now() > session.expires - 60000) {
      try {
        await auth('refresh_token', { refresh_token: session.refresh });
      } catch (e) {
        // A refused refresh means the login is no longer valid. A network
        // failure just means we are offline and should try again later.
        if (e.status && e.status < 500) { saveSession(null); e.status = 401; }
        throw e;
      }
    }
    return session.access;
  }

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    const headers = { apikey: key, Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || `Database error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 || method !== 'GET' ? null : res.json();
  }

  async function push() {
    const outbox = syncInfo().outbox;
    if (!outbox.length) return;
    const count = outbox.length;
    const ops = collapse(outbox);
    for (const table of TABLES) {
      const rows = ops.filter((op) => op.table === table).map((op) => op.row);
      for (let i = 0; i < rows.length; i += 500) {
        // Log entries are only ever added, never rewritten, so the history
        // cannot be altered once saved.
        const onConflict = table === 'log' ? 'ignore-duplicates' : 'merge-duplicates';
        await rest(table, { method: 'POST', body: rows.slice(i, i + 500), prefer: `resolution=${onConflict},return=minimal` });
      }
    }
    // Anything queued while we were uploading stays in the outbox.
    const s = getState();
    setState({ ...s, sync: { ...s.sync, outbox: s.sync.outbox.slice(count) } }, false);
  }

  async function fetchSince(table, since) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await rest(`${table}?select=*&synced_at=gt.${encodeURIComponent(since)}&order=synced_at.asc,id.asc&limit=${PAGE}&offset=${offset}`);
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async function pull() {
    let s = getState();
    const first = !s.sync.linked;
    const fetched = {};
    for (const table of TABLES) {
      const cursor = s.sync.cursor[table];
      // Step back a few seconds so a row saved just as we last looked is not missed.
      const since = cursor ? new Date(new Date(cursor).getTime() - 5000).toISOString() : EPOCH;
      fetched[table] = await fetchSince(table, since);
    }

    s = getState();
    if (first) {
      const empty = TABLES.every((t) => fetched[t].length === 0);
      if (empty) {
        // Brand new database: this device's data becomes the shared data.
        setState({ ...s, sync: { ...s.sync, linked: true, outbox: [...s.sync.outbox, ...allOps(s, session.email)] } }, true);
        await push();
        return;
      }
      // The database already has data: it replaces what was on this device.
      s = { ...s, locos: [], log: [], reports: [] };
    }

    let next = s;
    const cursor = { ...s.sync.cursor };
    for (const table of TABLES) {
      const waiting = new Set(s.sync.outbox.filter((op) => op.table === table).map((op) => op.row.id));
      next = applyRemote(next, table, fetched[table], waiting);
      for (const r of fetched[table]) if (!cursor[table] || r.synced_at > cursor[table]) cursor[table] = r.synced_at;
    }
    const changed = next !== s || first;
    setState({ ...next, sync: { ...s.sync, linked: true, cursor } }, changed);
  }

  async function run() {
    if (!session) { report('signed-out'); return; }
    report('syncing');
    try {
      await push();
      // Only look for other people's changes once ours are safely uploaded.
      if (!pending()) await pull();
      lastError = '';
      report(pending() ? 'syncing' : 'synced');
    } catch (e) {
      if (e.status === 401 && login) { report('signed-out'); return; }
      lastError = e.status ? e.message : '';
      report(e.status ? 'error' : 'offline');
    }
  }

  function syncNow() {
    if (running) { again = true; return running; }
    running = run().finally(() => {
      running = null;
      if (again) { again = false; syncNow(); }
    });
    return running;
  }

  return {
    get email() { return session ? session.email : ''; },
    get signedIn() { return !!session; },
    pending,
    syncNow,
    /** Call after a local change; batches quick edits into one upload. */
    kick() {
      report(navigator.onLine === false ? 'offline' : 'syncing');
      clearTimeout(timer);
      timer = setTimeout(syncNow, 400);
    },
    async signIn(email, password) {
      await auth('password', { email, password });
      return syncNow();
    },
    setName(name) {
      name = name.trim();
      try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
      session = { ...session, email: name };
      report(pending() ? 'syncing' : 'synced');
    },
    signOut() {
      saveSession(null);
      report('signed-out');
    },
    start() {
      report(session ? 'syncing' : 'signed-out');
      syncNow();
      setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, POLL_MS);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
      window.addEventListener('online', syncNow);
      window.addEventListener('offline', () => report('offline'));
    },
  };
}
