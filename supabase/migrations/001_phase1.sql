-- Bedside Updates, phase 1.
-- Inner-circle notes live only in update_details.
-- The wider-circle role has no select policy on that table, so a wider
-- account cannot read the medical note even if the app asks for it.
--
-- Phone numbers stay in Supabase Auth. This script does not copy them
-- onto follower-visible tables.
-- Run it in the Supabase SQL editor, or with the Supabase CLI, after
-- phone auth is enabled. Then run 002_app_functions.sql.

create extension if not exists pgcrypto;

create table if not exists care_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  patient_first_name text not null,
  current_status text not null default 'stable'
    check (current_status in ('improving', 'stable', 'declining', 'procedure', 'critical')),
  show_critical_to_wider boolean not null default false,
  last_updated_at timestamptz,
  pinned_note text not null default '',
  quiet_hours_start smallint not null default 22,
  quiet_hours_end smallint not null default 7,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (char_length(btrim(patient_first_name)) between 1 and 40),
  check (slug ~ '^[A-Za-z0-9_-]{8,24}$')
);

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references care_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner', 'mod', 'inner', 'wider')),
  texts_muted boolean not null default false,
  added_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (page_id, user_id),
  check (char_length(btrim(display_name)) between 1 and 40)
);

create unique index if not exists members_one_owner on members(page_id) where role = 'owner';

create table if not exists do_not_tell (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references care_pages(id) on delete cascade,
  phone_hash text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (page_id, phone_hash)
);

create table if not exists updates (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references care_pages(id) on delete cascade,
  status text not null check (status in ('improving', 'stable', 'declining', 'procedure', 'critical')),
  preset text,
  wider_summary text not null default '',
  show_critical_to_wider boolean not null default false,
  notify text not null default 'none' check (notify in ('everyone', 'inner', 'none')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden boolean not null default false
);

create table if not exists update_details (
  update_id uuid primary key references updates(id) on delete cascade,
  inner_note text not null,
  latest_actions jsonb not null default '[]'::jsonb,
  check (jsonb_typeof(latest_actions) = 'array')
);

comment on table update_details is
  'Inner-circle medical notes. Wider-circle members have no read policy.';

create table if not exists reactions (
  update_id uuid not null references updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('love', 'praying', 'strength', 'great_news', 'hugs')),
  created_at timestamptz not null default now(),
  primary key (update_id, user_id)
);

create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references care_pages(id) on delete cascade,
  name text not null,
  phone text not null,
  state text not null default 'pending' check (state in ('pending', 'approved', 'ignored')),
  created_at timestamptz not null default now()
);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references care_pages(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,
  target text,
  at timestamptz not null default now()
);

create index if not exists updates_page_created on updates(page_id, created_at desc);
create index if not exists members_user on members(user_id);

-- Looks up the caller's role without tripping row-level security recursion.
create or replace function app_member_role(p_page uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from members
  where page_id = p_page and user_id = auth.uid()
  limit 1
$$;

revoke all on function app_member_role(uuid) from public;
grant execute on function app_member_role(uuid) to authenticated;

alter table care_pages enable row level security;
alter table members enable row level security;
alter table do_not_tell enable row level security;
alter table updates enable row level security;
alter table update_details enable row level security;
alter table reactions enable row level security;
alter table access_requests enable row level security;
alter table activity_log enable row level security;

revoke all on care_pages, members, do_not_tell, updates, update_details, reactions, access_requests, activity_log
  from public, anon, authenticated;

grant select on care_pages, members, updates, reactions to authenticated;
grant select, insert, update on update_details to authenticated;
grant select on do_not_tell, access_requests, activity_log to authenticated;
grant insert, update on updates to authenticated;

create policy care_pages_select on care_pages
  for select to authenticated
  using (app_member_role(id) is not null and closed_at is null);

create policy care_pages_update on care_pages
  for update to authenticated
  using (app_member_role(id) in ('owner', 'mod'))
  with check (app_member_role(id) in ('owner', 'mod'));

-- Followers see only their own row. Mods see the whole list.
create policy members_select on members
  for select to authenticated
  using (user_id = auth.uid() or app_member_role(page_id) in ('owner', 'mod'));

create policy updates_select on updates
  for select to authenticated
  using (
    app_member_role(page_id) in ('owner', 'mod')
    or (hidden = false and app_member_role(page_id) in ('inner', 'wider'))
  );

create policy updates_insert on updates
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and app_member_role(page_id) in ('owner', 'mod')
  );

create policy updates_update on updates
  for update to authenticated
  using (app_member_role(page_id) in ('owner', 'mod'))
  with check (app_member_role(page_id) in ('owner', 'mod'));

-- Wider circle is intentionally absent. There is no delete policy:
-- mods hide updates, they do not remove them.
create policy update_details_select on update_details
  for select to authenticated
  using (
    exists (
      select 1 from updates u
      where u.id = update_details.update_id
        and app_member_role(u.page_id) in ('owner', 'mod', 'inner')
        and (u.hidden = false or app_member_role(u.page_id) in ('owner', 'mod'))
    )
  );

create policy update_details_insert on update_details
  for insert to authenticated
  with check (
    exists (
      select 1 from updates u
      where u.id = update_id
        and app_member_role(u.page_id) in ('owner', 'mod')
    )
  );

create policy update_details_update on update_details
  for update to authenticated
  using (
    exists (
      select 1 from updates u
      where u.id = update_details.update_id
        and app_member_role(u.page_id) in ('owner', 'mod')
    )
  )
  with check (
    exists (
      select 1 from updates u
      where u.id = update_id
        and app_member_role(u.page_id) in ('owner', 'mod')
    )
  );

create policy reactions_select on reactions
  for select to authenticated
  using (
    exists (
      select 1 from updates u
      where u.id = reactions.update_id
        and app_member_role(u.page_id) is not null
        and (u.hidden = false or app_member_role(u.page_id) in ('owner', 'mod'))
    )
  );

create policy reactions_insert on reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from updates u
      where u.id = update_id
        and u.hidden = false
        and app_member_role(u.page_id) is not null
    )
  );

create policy reactions_update on reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy reactions_delete on reactions
  for delete to authenticated
  using (user_id = auth.uid());

grant delete on reactions to authenticated;

create policy do_not_tell_select on do_not_tell
  for select to authenticated
  using (app_member_role(page_id) in ('owner', 'mod'));

create policy access_requests_select on access_requests
  for select to authenticated
  using (app_member_role(page_id) in ('owner', 'mod'));

create policy activity_select on activity_log
  for select to authenticated
  using (app_member_role(page_id) = 'owner');

-- Writes that change membership go through these functions so a follower
-- cannot insert themselves or promote their own row.
create or replace function create_care_page(p_patient_first_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  new_slug text;
  tries int := 0;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  if p_patient_first_name is null or char_length(btrim(p_patient_first_name)) not between 1 and 40 then
    raise exception 'enter a first name';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 40 then
    raise exception 'enter your name';
  end if;
  loop
    tries := tries + 1;
    new_slug := substr(regexp_replace(encode(extensions.gen_random_bytes(12), 'base64'), '[^a-zA-Z0-9]', '', 'g'), 1, 12);
    exit when char_length(new_slug) >= 8 and not exists (select 1 from care_pages where slug = new_slug);
    if tries > 5 then
      raise exception 'could not create a page';
    end if;
  end loop;
  insert into care_pages (id, slug, patient_first_name)
  values (new_id, new_slug, btrim(p_patient_first_name));
  insert into members (page_id, user_id, display_name, role)
  values (new_id, auth.uid(), btrim(p_display_name), 'owner');
  insert into activity_log (page_id, actor, action, target)
  values (new_id, auth.uid(), 'started this page', btrim(p_patient_first_name));
  return new_id;
end;
$$;

create or replace function add_member(p_page uuid, p_user uuid, p_name text, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := app_member_role(p_page);
begin
  if p_role not in ('mod', 'inner', 'wider') then
    raise exception 'invalid role';
  end if;
  if actor_role = 'owner' then
    null;
  elsif actor_role = 'mod' and p_role in ('inner', 'wider') then
    null;
  else
    raise exception 'not allowed';
  end if;
  insert into members (page_id, user_id, display_name, role, added_by)
  values (p_page, p_user, btrim(p_name), p_role, auth.uid());
  insert into activity_log (page_id, actor, action, target)
  values (p_page, auth.uid(), 'added someone', btrim(p_name) || ', ' || p_role);
end;
$$;

create or replace function remove_member(p_page uuid, p_member uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := app_member_role(p_page);
  target members%rowtype;
begin
  select * into target from members where id = p_member and page_id = p_page;
  if not found then
    raise exception 'not on this page';
  end if;
  if target.role = 'owner' then
    raise exception 'the owner stays';
  end if;
  if actor_role = 'mod' and target.role <> 'mod' and target.role in ('inner', 'wider') then
    null;
  elsif actor_role = 'owner' then
    null;
  else
    raise exception 'not allowed';
  end if;
  delete from members where id = target.id;
  insert into activity_log (page_id, actor, action, target)
  values (p_page, auth.uid(), 'removed someone', target.display_name);
  -- Membership is checked on every request, so access ends right here.
  -- The server then calls revoke_sessions_if_orphaned (see 002) to end
  -- the person's sign-ins when they have no other page.
  return target.user_id;
end;
$$;

create or replace function set_member_role(p_page uuid, p_member uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text := app_member_role(p_page);
  target members%rowtype;
begin
  if p_role not in ('mod', 'inner', 'wider') then
    raise exception 'invalid role';
  end if;
  select * into target from members where id = p_member and page_id = p_page;
  if not found or target.role = 'owner' then
    raise exception 'not allowed';
  end if;
  if actor_role = 'owner' then
    null;
  elsif actor_role = 'mod' and target.role in ('inner', 'wider') and p_role in ('inner', 'wider') then
    null;
  else
    raise exception 'not allowed';
  end if;
  update members set role = p_role where id = target.id;
  insert into activity_log (page_id, actor, action, target)
  values (p_page, auth.uid(), 'changed a tier', target.display_name || ', ' || p_role);
end;
$$;

create or replace function publish_update(
  p_page uuid,
  p_status text,
  p_preset text,
  p_wider_summary text,
  p_inner_note text,
  p_latest_actions jsonb,
  p_notify text,
  p_show_critical boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  -- coalesce: a non-member has a null role, and "null not in (...)" is null,
  -- which would let the check pass.
  if coalesce(app_member_role(p_page), '') not in ('owner', 'mod') then
    raise exception 'not allowed';
  end if;
  if p_status not in ('improving', 'stable', 'declining', 'procedure', 'critical') then
    raise exception 'choose a status';
  end if;
  if p_notify not in ('everyone', 'inner', 'none') then
    raise exception 'choose who should be texted';
  end if;
  insert into updates (id, page_id, status, preset, wider_summary, show_critical_to_wider, notify, created_by)
  values (
    new_id, p_page, p_status, p_preset, coalesce(p_wider_summary, ''),
    p_status = 'critical' and coalesce(p_show_critical, false),
    p_notify, auth.uid()
  );
  insert into update_details (update_id, inner_note, latest_actions)
  values (new_id, p_inner_note, coalesce(p_latest_actions, '[]'::jsonb));
  insert into activity_log (page_id, actor, action, target)
  values (p_page, auth.uid(), 'posted an update', p_preset);
  return new_id;
end;
$$;

create or replace function touch_page_from_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update care_pages
    set current_status = new.status,
        show_critical_to_wider = new.show_critical_to_wider,
        last_updated_at = now()
  where id = new.page_id;
  return new;
end;
$$;

drop trigger if exists updates_touch_page on updates;
create trigger updates_touch_page
  after insert on updates
  for each row execute function touch_page_from_update();

revoke all on function create_care_page(text, text) from public;
revoke all on function add_member(uuid, uuid, text, text) from public;
revoke all on function remove_member(uuid, uuid) from public;
revoke all on function set_member_role(uuid, uuid, text) from public;
revoke all on function publish_update(uuid, text, text, text, text, jsonb, text, boolean) from public;
grant execute on function create_care_page(text, text) to authenticated;
grant execute on function add_member(uuid, uuid, text, text) to authenticated;
grant execute on function remove_member(uuid, uuid) to authenticated;
grant execute on function set_member_role(uuid, uuid, text) to authenticated;
grant execute on function publish_update(uuid, text, text, text, text, jsonb, text, boolean) to authenticated;
