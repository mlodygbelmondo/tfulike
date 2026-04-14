-- Add per-user TikTok bookmarks for solo mode.

create table if not exists user_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  tiktok_video_id text not null,
  tiktok_url text,
  video_url text,
  video_urls jsonb not null default '[]'::jsonb,
  author_username text,
  description text,
  cover_url text,
  created_at timestamptz default now(),
  unique(user_id, tiktok_video_id)
);

create index if not exists idx_user_bookmarks_user on user_bookmarks(user_id);
create index if not exists idx_user_bookmarks_video on user_bookmarks(tiktok_video_id);

alter table user_bookmarks enable row level security;

create policy user_bookmarks_select_own on user_bookmarks
  for select using (user_id = auth.uid());

create policy user_bookmarks_insert_own on user_bookmarks
  for insert with check (user_id = auth.uid());

create policy user_bookmarks_update_own on user_bookmarks
  for update using (user_id = auth.uid());

create policy user_bookmarks_delete_own on user_bookmarks
  for delete using (user_id = auth.uid());

alter publication supabase_realtime add table user_bookmarks;
