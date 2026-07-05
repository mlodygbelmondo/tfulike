-- game-play-view subscribes to postgres_changes on videos (source refreshes
-- and cache_status transitions), but the table was never added to the
-- realtime publication, so those events never reached clients.
alter publication supabase_realtime add table videos;
