-- Loco Tracker: database setup for Supabase, OPEN version (no sign-in).
-- Use this one when js/config.js has REQUIRE_LOGIN = false.
--
-- Anyone who has the app link can view and edit. To limit the damage a
-- stranger could do, nothing can be deleted outright and the log of changes
-- can only be added to, never rewritten, so the true history is always kept.
-- Paste this whole file into Supabase > SQL Editor and press Run. It is safe
-- to run more than once.

create table if not exists public.locos (
  id         text primary key,
  pos        integer     not null default 0,
  deleted    boolean     not null default false,
  data       jsonb       not null,
  updated_by text        not null default '',
  synced_at  timestamptz not null default now()
);

create table if not exists public.log (
  id          text primary key,
  loco_id     text        not null,
  happened_at timestamptz not null,
  kind        text        not null,
  data        jsonb       not null,
  changed_by  text        not null default '',
  synced_at   timestamptz not null default now()
);

create table if not exists public.reports (
  id        text primary key,
  sent_at   timestamptz not null,
  day       text        not null,
  locos     jsonb       not null,
  sent_by   text        not null default '',
  deleted   boolean     not null default false,
  synced_at timestamptz not null default now()
);

create index if not exists locos_synced_at   on public.locos   (synced_at);
create index if not exists log_synced_at     on public.log     (synced_at);
create index if not exists log_loco          on public.log     (loco_id, happened_at);
create index if not exists reports_synced_at on public.reports (synced_at);

-- Stamp every saved row with the server's time, so each device can ask for
-- "everything saved since I last looked" without trusting phone clocks.
create or replace function public.touch_synced_at() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

-- If two people change the same loco, the change made later wins, even when
-- the earlier one reaches the database last (for example from a phone that
-- was offline). Both changes are still kept in the log.
create or replace function public.locos_keep_latest() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(new.data->>'updatedAt', '') < coalesce(old.data->>'updatedAt', '') then
    new.data := old.data;
    new.updated_by := old.updated_by;
  end if;
  new.synced_at := now();
  return new;
end $$;

drop trigger if exists locos_touch   on public.locos;
drop trigger if exists log_touch     on public.log;
drop trigger if exists reports_touch on public.reports;
create trigger locos_touch   before insert or update on public.locos   for each row execute function public.locos_keep_latest();
create trigger log_touch     before insert or update on public.log     for each row execute function public.touch_synced_at();
create trigger reports_touch before insert or update on public.reports for each row execute function public.touch_synced_at();

-- Open access: anyone using the app may read, add and update. Nobody can
-- delete rows: the app marks records as removed instead.
alter table public.locos   enable row level security;
alter table public.log     enable row level security;
alter table public.reports enable row level security;

drop policy if exists "signed-in read"   on public.locos;
drop policy if exists "signed-in insert" on public.locos;
drop policy if exists "signed-in update" on public.locos;
drop policy if exists "open read"   on public.locos;
drop policy if exists "open insert" on public.locos;
drop policy if exists "open update" on public.locos;
create policy "open read"   on public.locos for select to anon, authenticated using (true);
create policy "open insert" on public.locos for insert to anon, authenticated with check (true);
create policy "open update" on public.locos for update to anon, authenticated using (true) with check (true);

-- The log can be added to but never rewritten.
drop policy if exists "signed-in read"   on public.log;
drop policy if exists "signed-in insert" on public.log;
drop policy if exists "signed-in update" on public.log;
drop policy if exists "open read"   on public.log;
drop policy if exists "open insert" on public.log;
create policy "open read"   on public.log for select to anon, authenticated using (true);
create policy "open insert" on public.log for insert to anon, authenticated with check (true);

drop policy if exists "signed-in read"   on public.reports;
drop policy if exists "signed-in insert" on public.reports;
drop policy if exists "signed-in update" on public.reports;
drop policy if exists "open read"   on public.reports;
drop policy if exists "open insert" on public.reports;
drop policy if exists "open update" on public.reports;
create policy "open read"   on public.reports for select to anon, authenticated using (true);
create policy "open insert" on public.reports for insert to anon, authenticated with check (true);
create policy "open update" on public.reports for update to anon, authenticated using (true) with check (true);

revoke all on public.locos, public.log, public.reports from anon, authenticated;
grant select, insert, update on public.locos, public.reports to anon, authenticated;
grant select, insert         on public.log                   to anon, authenticated;

-- Unusuals tab: the unusual reports (also in setup-unusuals.sql, for
-- databases that were set up before this tab existed).
create table if not exists public.unusuals (
  id         text primary key,
  day        text        not null,
  deleted    boolean     not null default false,
  data       jsonb       not null,
  updated_by text        not null default '',
  synced_at  timestamptz not null default now()
);
create index if not exists unusuals_synced_at on public.unusuals (synced_at);
create index if not exists unusuals_day       on public.unusuals (day);
drop trigger if exists unusuals_touch on public.unusuals;
create trigger unusuals_touch before insert or update on public.unusuals
  for each row execute function public.locos_keep_latest();
alter table public.unusuals enable row level security;
drop policy if exists "signed-in read"   on public.unusuals;
drop policy if exists "signed-in insert" on public.unusuals;
drop policy if exists "signed-in update" on public.unusuals;
drop policy if exists "open read"   on public.unusuals;
drop policy if exists "open insert" on public.unusuals;
drop policy if exists "open update" on public.unusuals;
create policy "open read"   on public.unusuals for select to anon, authenticated using (true);
create policy "open insert" on public.unusuals for insert to anon, authenticated with check (true);
create policy "open update" on public.unusuals for update to anon, authenticated using (true) with check (true);
revoke all on public.unusuals from anon, authenticated;
grant select, insert, update on public.unusuals to anon, authenticated;
