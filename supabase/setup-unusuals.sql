-- Loco Tracker: adds the table for the Unusuals tab (unusual reports).
--
-- Run this ONCE if the database was set up before the Unusuals tab existed.
-- Paste the whole file into Supabase > SQL Editor and press Run. It is safe
-- to run more than once, and it does not touch the existing tables.
--
-- This is the OPEN version (js/config.js has REQUIRE_LOGIN = false): anyone
-- with the app link can read, add and update. Nothing can be deleted
-- outright: the app marks a deleted report as removed instead.
-- If REQUIRE_LOGIN is true, use the "signed-in" policies at the foot of
-- setup-login.sql instead.

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

-- If two people change the same report, the change made later wins, even
-- when the earlier one reaches the database last (for example from a phone
-- that was offline). Uses the same function as the locos table.
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
