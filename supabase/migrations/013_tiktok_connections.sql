-- TikTok Data Portability API integration: OAuth connections and data
-- request tracking. Service-role access only; no client-side policies.

create table if not exists tiktok_connections (
  user_id uuid primary key references profiles(id) on delete cascade,
  open_id text,
  access_token text not null,
  refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tiktok_connections enable row level security;

create table if not exists tiktok_data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  request_id bigint not null,
  status text not null default 'pending',
  likes_imported integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tiktok_data_requests enable row level security;

create index if not exists tiktok_data_requests_user_idx
  on tiktok_data_requests (user_id, created_at desc);
