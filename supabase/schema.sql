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
