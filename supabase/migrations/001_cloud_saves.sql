-- Sede — saves na nuvem. Rode uma vez no SQL Editor do Supabase.
-- O RLS garante que cada jogador só enxerga e grava os PRÓPRIOS saves, mesmo
-- sabendo que a anon key é pública.

create table if not exists public.cloud_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 0 and 2),
  payload text not null check (char_length(payload) <= 2000000),
  name text,
  class_id text,
  level integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

alter table public.cloud_saves enable row level security;

create policy "cloud_saves_select_own" on public.cloud_saves
  for select using (auth.uid() = user_id);
create policy "cloud_saves_insert_own" on public.cloud_saves
  for insert with check (auth.uid() = user_id);
create policy "cloud_saves_update_own" on public.cloud_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cloud_saves_delete_own" on public.cloud_saves
  for delete using (auth.uid() = user_id);

create or replace function public.touch_cloud_save() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cloud_saves_touch on public.cloud_saves;
create trigger cloud_saves_touch before update on public.cloud_saves
  for each row execute function public.touch_cloud_save();
