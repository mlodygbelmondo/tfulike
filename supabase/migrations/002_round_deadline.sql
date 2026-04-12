-- Add deadline column to rounds for server-authoritative timer
alter table rounds add column deadline timestamptz;
