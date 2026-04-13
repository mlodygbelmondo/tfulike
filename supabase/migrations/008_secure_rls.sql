-- Secure RLS for auth-based gameplay.
-- Browser clients should only read rows for rooms they belong to.
-- Privileged cross-player reads and state mutations happen via server routes
-- using the service role client.

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.players p
    where p.room_id = target_room_id
      and p.user_id = auth.uid()
  );
$$;

create or replace function public.is_player_owner(target_player_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.players p
    where p.id = target_player_id
      and p.user_id = auth.uid()
  );
$$;

drop policy if exists rooms_select on rooms;
drop policy if exists rooms_insert on rooms;
drop policy if exists rooms_update on rooms;

create policy rooms_select_member on rooms
  for select using (public.is_room_member(id));

create policy rooms_insert_authenticated on rooms
  for insert to authenticated with check (true);

drop policy if exists players_select on players;
drop policy if exists players_insert on players;
drop policy if exists players_update on players;

create policy players_select_member on players
  for select using (public.is_room_member(room_id));

create policy players_insert_self on players
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists videos_select on videos;
drop policy if exists videos_insert on videos;
drop policy if exists videos_update on videos;
drop policy if exists videos_delete on videos;

create policy videos_select_member on videos
  for select using (public.is_room_member(room_id));

drop policy if exists rounds_select on rounds;
drop policy if exists rounds_insert on rounds;
drop policy if exists rounds_update on rounds;

create policy rounds_select_member on rounds
  for select using (public.is_room_member(room_id));

drop policy if exists votes_select on votes;
drop policy if exists votes_insert on votes;

create policy votes_select_member on votes
  for select using (
    exists (
      select 1
      from public.rounds r
      where r.id = votes.round_id
        and public.is_room_member(r.room_id)
    )
  );

create policy votes_insert_self on votes
  for insert to authenticated with check (public.is_player_owner(player_id));

drop policy if exists profiles_select on profiles;
drop policy if exists profiles_insert on profiles;
drop policy if exists profiles_update on profiles;

create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_insert_own on profiles
  for insert with check (id = auth.uid());

create policy profiles_update_own on profiles
  for update using (id = auth.uid());

drop policy if exists user_likes_select on user_likes;
drop policy if exists user_likes_insert on user_likes;
drop policy if exists user_likes_update on user_likes;
drop policy if exists user_likes_delete on user_likes;

create policy user_likes_select_own on user_likes
  for select using (user_id = auth.uid());

create policy user_likes_insert_own on user_likes
  for insert with check (user_id = auth.uid());

create policy user_likes_update_own on user_likes
  for update using (user_id = auth.uid());

create policy user_likes_delete_own on user_likes
  for delete using (user_id = auth.uid());

drop policy if exists likes_select on likes;
drop policy if exists likes_insert on likes;
drop policy if exists likes_update on likes;
drop policy if exists likes_delete on likes;

create policy likes_no_access on likes
  for select using (false);
