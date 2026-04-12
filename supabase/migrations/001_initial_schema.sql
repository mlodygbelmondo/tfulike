-- Tapujemy! MVP Schema
-- Run this in your Supabase SQL editor or as a migration

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================
-- TABLES
-- ============================================

create table rooms (
  id uuid primary key default gen_random_uuid(),
  pin text unique not null,
  host_player_id uuid,
  status text not null default 'lobby'
    check (status in ('lobby', 'playing', 'finished')),
  settings jsonb default '{"round_timer": 15, "max_rounds": null}'::jsonb,
  current_round int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  nickname text not null,
  color text not null,
  session_token text unique default gen_random_uuid()::text,
  is_host boolean default false,
  score int default 0,
  videos_ready boolean default false,
  created_at timestamptz default now()
);

-- Add FK for host_player_id after players table exists
alter table rooms
  add constraint rooms_host_player_id_fkey
  foreign key (host_player_id) references players(id) on delete set null;

create table videos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  player_id uuid references players(id) on delete cascade not null,
  tiktok_url text not null,
  oembed_data jsonb,
  used boolean default false,
  created_at timestamptz default now()
);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references rooms(id) on delete cascade not null,
  round_number int not null,
  video_id uuid references videos(id),
  correct_player_id uuid references players(id),
  status text not null default 'voting'
    check (status in ('voting', 'reveal', 'done')),
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references rounds(id) on delete cascade not null,
  player_id uuid references players(id) on delete cascade not null,
  guessed_player_id uuid references players(id) not null,
  is_correct boolean,
  created_at timestamptz default now(),
  unique(round_id, player_id)
);

-- ============================================
-- INDEXES
-- ============================================

create index idx_rooms_pin on rooms(pin);
create index idx_rooms_status on rooms(status);
create index idx_players_room on players(room_id);
create index idx_players_session on players(session_token);
create index idx_videos_room on videos(room_id);
create index idx_videos_player on videos(player_id);
create index idx_videos_unused on videos(room_id, used) where not used;
create index idx_rounds_room on rounds(room_id);
create index idx_votes_round on votes(round_id);

-- ============================================
-- RLS POLICIES
-- ============================================

alter table rooms enable row level security;
alter table players enable row level security;
alter table videos enable row level security;
alter table rounds enable row level security;
alter table votes enable row level security;

-- Rooms: anyone can read, anyone can create
create policy "rooms_select" on rooms for select using (true);
create policy "rooms_insert" on rooms for insert with check (true);
create policy "rooms_update" on rooms for update using (true);

-- Players: anyone can read players in any room, anyone can join
create policy "players_select" on players for select using (true);
create policy "players_insert" on players for insert with check (true);
create policy "players_update" on players for update using (true);

-- Videos: anyone in the room can read (after game starts), owner can insert
create policy "videos_select" on videos for select using (true);
create policy "videos_insert" on videos for insert with check (true);
create policy "videos_update" on videos for update using (true);

-- Rounds: anyone can read
create policy "rounds_select" on rounds for select using (true);
create policy "rounds_insert" on rounds for insert with check (true);
create policy "rounds_update" on rounds for update using (true);

-- Votes: anyone can read after reveal, player can insert own vote
create policy "votes_select" on votes for select using (true);
create policy "votes_insert" on votes for insert with check (true);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-update updated_at on rooms
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger rooms_updated_at
  before update on rooms
  for each row execute function update_updated_at();

-- Generate unique 4-digit PIN
create or replace function generate_room_pin()
returns text as $$
declare
  new_pin text;
  pin_exists boolean;
begin
  loop
    new_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
    select exists(select 1 from rooms where pin = new_pin and status != 'finished') into pin_exists;
    exit when not pin_exists;
  end loop;
  return new_pin;
end;
$$ language plpgsql;

-- Enable realtime for key tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table rounds;
alter publication supabase_realtime add table votes;
