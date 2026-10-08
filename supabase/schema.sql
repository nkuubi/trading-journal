-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists public.kv (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.kv enable row level security;

-- Each signed-in user can only read their own rows.
create policy "kv_select_own" on public.kv
  for select using (auth.uid() = user_id);

-- Each signed-in user can only insert rows under their own id.
create policy "kv_insert_own" on public.kv
  for insert with check (auth.uid() = user_id);

-- Each signed-in user can only update their own rows.
create policy "kv_update_own" on public.kv
  for update using (auth.uid() = user_id);

-- Each signed-in user can only delete their own rows (not used by the app
-- today, but harmless to have and matches the other policies).
create policy "kv_delete_own" on public.kv
  for delete using (auth.uid() = user_id);

-- ── Screenshot uploads ──
-- Run this too. Creates a public-read bucket for trade chart screenshots,
-- with write access restricted to each user's own folder (path prefix
-- "<user_id>/..."), via RLS on storage.objects.

insert into storage.buckets (id, name, public)
values ('trade-screenshots', 'trade-screenshots', true)
on conflict (id) do nothing;

create policy "trade_screenshots_read_all" on storage.objects
  for select using (bucket_id = 'trade-screenshots');

create policy "trade_screenshots_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "trade_screenshots_delete_own" on storage.objects
  for delete using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
