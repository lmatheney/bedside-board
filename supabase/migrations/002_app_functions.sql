-- Bedside Updates, phase 1, part 2.
-- Run after 001_phase1.sql.
--
-- 1. Everything the app writes goes through a function that checks the
--    caller's role, so the tables themselves are read-only for signed-in
--    users.
-- 2. Followers can't read the members table, so names (first name plus
--    last initial) and the mod-only member list come from functions.
-- 3. A few helpers are callable only by the server's secret key. They look
--    up phone numbers, which live in Supabase Auth.

-- ---------------------------------------------------------------------------
-- Activity log: remember who did it, even after they are removed.
-- ---------------------------------------------------------------------------

alter table activity_log add column if not exists actor_name text;

create or replace function activity_fill_actor_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_name is null then
    select display_name into new.actor_name
    from members
    where page_id = new.page_id and user_id = new.actor;
  end if;
  new.actor_name := coalesce(new.actor_name, 'Someone');
  return new;
end;
$$;

drop trigger if exists activity_actor_name on activity_log;
create trigger activity_actor_name
  before insert on activity_log
  for each row execute function activity_fill_actor_name();

-- ---------------------------------------------------------------------------
-- Names. Followers only ever see "First L."
-- ---------------------------------------------------------------------------

create or replace function public_name(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[] := regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+');
  n int := coalesce(array_length(parts, 1), 0);
begin
  if n = 0 or parts[1] = '' then
    return 'Someone';
  end if;
  if n = 1 then
    return parts[1];
  end if;
  return array_to_string(parts[1:n - 1], ' ') || ' ' || upper(left(parts[n], 1)) || '.';
end;
$$;

-- Display names for authors and reactors, for anyone on the page.
create or replace function page_names(p_page uuid, p_users uuid[])
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, public_name(m.display_name)
  from members m
  where m.page_id = p_page
    and m.user_id = any(p_users)
    and app_member_role(p_page) is not null
$$;

-- The full people list, with phone numbers, for the owner and mods only.
create or replace function list_members(p_page uuid)
returns table (id uuid, user_id uuid, display_name text, role text, phone text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.user_id, m.display_name, m.role, u.phone::text, m.created_at
  from members m
  join auth.users u on u.id = m.user_id
  where m.page_id = p_page
    and app_member_role(p_page) in ('owner', 'mod')
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

create or replace function role_label(p_role text)
returns text
language sql
immutable
as $$
  select case p_role
    when 'owner' then 'owner'
    when 'mod' then 'mod'
    when 'inner' then 'inner circle'
    else 'wider circle'
  end
$$;

-- p_people: [{"user_id": "...", "name": "..."}]. All or nothing.
create or replace function add_members(p_page uuid, p_people jsonb, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := coalesce(app_member_role(p_page), '');
  person jsonb;
  person_name text;
  total int;
begin
  if p_role not in ('mod', 'inner', 'wider') then
    raise exception 'That role isn''t valid.';
  end if;
  if actor_role = 'owner' then
    null;
  elsif actor_role = 'mod' and p_role in ('inner', 'wider') then
    null;
  elsif actor_role = 'mod' then
    raise exception 'Only the owner can add a mod.';
  else
    raise exception 'You can''t add people.';
  end if;
  if jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception 'Add at least one name and number.';
  end if;
  select count(*) into total from members where page_id = p_page;
  if total + jsonb_array_length(p_people) > 300 then
    raise exception 'This page is full.';
  end if;

  for person in select * from jsonb_array_elements(p_people) loop
    person_name := btrim(person ->> 'name');
    begin
      insert into members (page_id, user_id, display_name, role, added_by)
      values (p_page, (person ->> 'user_id')::uuid, person_name, p_role, auth.uid());
    exception when unique_violation then
      raise exception '% is already on this page.', person_name;
    end;
  end loop;

  if jsonb_array_length(p_people) = 1 then
    insert into activity_log (page_id, actor, action, target)
    values (p_page, auth.uid(), 'added someone', person_name || ', ' || role_label(p_role));
  else
    insert into activity_log (page_id, actor, action, target)
    values (p_page, auth.uid(), 'added people',
            jsonb_array_length(p_people) || ' as ' || role_label(p_role));
  end if;
end;
$$;

create or replace function edit_update(
  p_update uuid,
  p_status text,
  p_preset text,
  p_wider_summary text,
  p_inner_note text,
  p_latest_actions jsonb,
  p_show_critical boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing updates%rowtype;
  show_critical boolean := p_status = 'critical' and coalesce(p_show_critical, false);
  late boolean;
  status_changed boolean;
  newest uuid;
begin
  select * into existing from updates where id = p_update;
  if not found then
    raise exception 'That update isn''t on this page.';
  end if;
  if coalesce(app_member_role(existing.page_id), '') not in ('owner', 'mod') then
    raise exception 'You can''t post on this page.';
  end if;
  if p_status not in ('improving', 'stable', 'declining', 'procedure', 'critical') then
    raise exception 'Choose a status.';
  end if;

  late := now() - existing.created_at > interval '10 minutes';
  status_changed := existing.status <> p_status or existing.show_critical_to_wider <> show_critical;
  select id into newest from updates
    where page_id = existing.page_id and hidden = false
    order by created_at desc limit 1;

  update updates
    set status = p_status,
        preset = p_preset,
        wider_summary = coalesce(p_wider_summary, ''),
        show_critical_to_wider = show_critical,
        edited_at = now()
    where id = p_update;
  update update_details
    set inner_note = p_inner_note,
        latest_actions = coalesce(p_latest_actions, '[]'::jsonb)
    where update_id = p_update;

  if newest = p_update then
    update care_pages
      set current_status = p_status,
          show_critical_to_wider = show_critical,
          last_updated_at = case when late or status_changed then now() else last_updated_at end
      where id = existing.page_id;
  end if;

  insert into activity_log (page_id, actor, action, target)
  values (existing.page_id, auth.uid(), 'edited an update', p_preset);
end;
$$;

create or replace function set_update_hidden(p_update uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing updates%rowtype;
begin
  select * into existing from updates where id = p_update;
  if not found then
    raise exception 'That update isn''t on this page.';
  end if;
  if coalesce(app_member_role(existing.page_id), '') not in ('owner', 'mod') then
    raise exception 'You can''t change updates.';
  end if;
  update updates set hidden = p_hidden where id = p_update;
  insert into activity_log (page_id, actor, action, target)
  values (existing.page_id, auth.uid(),
          case when p_hidden then 'hid an update' else 'put an update back' end,
          existing.preset);
end;
$$;

create or replace function quick_check_in(p_page uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(app_member_role(p_page), '') not in ('owner', 'mod') then
    raise exception 'You can''t post on this page.';
  end if;
  if p_kind = 'still_in_surgery' then
    update care_pages
      set current_status = 'procedure', show_critical_to_wider = false, last_updated_at = now()
      where id = p_page;
    insert into activity_log (page_id, actor, action, target)
    values (p_page, auth.uid(), 'checked in', 'Still in surgery');
  elsif p_kind = 'no_change' then
    update care_pages set last_updated_at = now() where id = p_page;
    insert into activity_log (page_id, actor, action, target)
    values (p_page, auth.uid(), 'checked in', 'No change');
  else
    raise exception 'Choose a check-in.';
  end if;
end;
$$;

create or replace function set_pinned_note(p_page uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  note text := btrim(coalesce(p_note, ''));
begin
  if coalesce(app_member_role(p_page), '') not in ('owner', 'mod') then
    raise exception 'You can''t change the note.';
  end if;
  if char_length(note) > 280 then
    raise exception 'Keep the pinned note under 280 characters.';
  end if;
  update care_pages set pinned_note = note where id = p_page;
  insert into activity_log (page_id, actor, action, target)
  values (p_page, auth.uid(),
          case when note = '' then 'cleared the pinned note' else 'updated the pinned note' end,
          null);
end;
$$;

-- Tap a reaction to set it, tap the same one again to remove it.
create or replace function set_reaction(p_update uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target updates%rowtype;
  current_kind text;
begin
  if p_kind not in ('love', 'praying', 'strength', 'great_news', 'hugs') then
    raise exception 'Choose a reaction.';
  end if;
  select * into target from updates where id = p_update;
  if not found or target.hidden or app_member_role(target.page_id) is null then
    raise exception 'That update isn''t visible.';
  end if;
  select kind into current_kind from reactions where update_id = p_update and user_id = auth.uid();
  if current_kind = p_kind then
    delete from reactions where update_id = p_update and user_id = auth.uid();
  elsif current_kind is not null then
    update reactions set kind = p_kind, created_at = now()
      where update_id = p_update and user_id = auth.uid();
  else
    insert into reactions (update_id, user_id, kind) values (p_update, auth.uid(), p_kind);
  end if;
end;
$$;

-- The owner hands the page to one of the mods and becomes a mod.
create or replace function hand_off_ownership(p_page uuid, p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target members%rowtype;
begin
  if coalesce(app_member_role(p_page), '') <> 'owner' then
    raise exception 'Only the owner can hand this page off.';
  end if;
  select * into target from members where id = p_member and page_id = p_page;
  if not found or target.role <> 'mod' then
    raise exception 'Choose a mod to become the owner.';
  end if;
  update members set role = 'mod' where page_id = p_page and role = 'owner';
  update members set role = 'owner' where id = target.id;
  insert into activity_log (page_id, actor, action, target)
  values (p_page, auth.uid(), 'handed off ownership', target.display_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-only helpers (secret key). They deal in phone numbers, which
-- followers must never be able to look up.
-- ---------------------------------------------------------------------------

-- Supabase stores phone numbers without the leading plus.
create or replace function auth_user_id_for_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where phone = ltrim(p_phone, '+') limit 1
$$;

create or replace function page_member_for_phone(p_page uuid, p_phone text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from members m
  join auth.users u on u.id = m.user_id
  where m.page_id = p_page and u.phone = ltrim(p_phone, '+')
  limit 1
$$;

-- After a removal: end every sign-in for a person who is on no page any more.
create or replace function revoke_sessions_if_orphaned(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from members where user_id = p_user) then
    return;
  end if;
  delete from auth.sessions where user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Signed-in users read through row-level security and write through the
-- functions above, never straight into these tables.
revoke insert, update on updates from authenticated;
revoke insert, update on update_details from authenticated;
revoke insert, update, delete on reactions from authenticated;

-- Supabase hands new functions to anon by default. Take that back, then
-- give each function to exactly who needs it.
revoke execute on function
  app_member_role(uuid),
  create_care_page(text, text),
  add_member(uuid, uuid, text, text),
  remove_member(uuid, uuid),
  set_member_role(uuid, uuid, text),
  publish_update(uuid, text, text, text, text, jsonb, text, boolean),
  touch_page_from_update(),
  activity_fill_actor_name(),
  public_name(text),
  page_names(uuid, uuid[]),
  list_members(uuid),
  role_label(text),
  add_members(uuid, jsonb, text),
  edit_update(uuid, text, text, text, text, jsonb, boolean),
  set_update_hidden(uuid, boolean),
  quick_check_in(uuid, text),
  set_pinned_note(uuid, text),
  set_reaction(uuid, text),
  hand_off_ownership(uuid, uuid),
  auth_user_id_for_phone(text),
  page_member_for_phone(uuid, text),
  revoke_sessions_if_orphaned(uuid)
from public, anon, authenticated;

grant execute on function
  app_member_role(uuid),
  create_care_page(text, text),
  remove_member(uuid, uuid),
  set_member_role(uuid, uuid, text),
  publish_update(uuid, text, text, text, text, jsonb, text, boolean),
  page_names(uuid, uuid[]),
  list_members(uuid),
  add_members(uuid, jsonb, text),
  edit_update(uuid, text, text, text, text, jsonb, boolean),
  set_update_hidden(uuid, boolean),
  quick_check_in(uuid, text),
  set_pinned_note(uuid, text),
  set_reaction(uuid, text),
  hand_off_ownership(uuid, uuid)
to authenticated;

grant execute on function
  auth_user_id_for_phone(text),
  page_member_for_phone(uuid, text),
  revoke_sessions_if_orphaned(uuid)
to service_role;
