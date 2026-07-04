-- Server-side video cache: videos are uploaded once to Supabase Storage and
-- streamed by all players via signed URLs, instead of each player fetching
-- expiring TikTok CDN URLs through the extension.

alter table videos add column if not exists storage_path text;
alter table videos add column if not exists cache_status text not null default 'pending';
alter table videos add column if not exists cached_at timestamptz;

alter table videos drop constraint if exists videos_cache_status_check;
alter table videos add constraint videos_cache_status_check
  check (cache_status in ('pending', 'uploading', 'ready', 'failed'));

-- Private bucket; access goes through signed URLs minted by API routes.
insert into storage.buckets (id, name, public)
values ('video-cache', 'video-cache', false)
on conflict (id) do nothing;
