-- Fix recursive RLS helper functions used by member-only room policies.
-- These helpers query public.players, so they must bypass players RLS or
-- room/players selects can reject valid members immediately after room creation.

create or replace function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
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
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = target_player_id
      and p.user_id = auth.uid()
  );
$$;

revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;

revoke all on function public.is_player_owner(uuid) from public;
grant execute on function public.is_player_owner(uuid) to authenticated;
