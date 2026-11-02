-- Bedside Updates: sign in with email instead of phone.
-- Run after 003_fix_create_care_page.sql.
--
-- Email addresses live in Supabase Auth (auth.users.email). Nothing here
-- copies them onto follower-visible tables.
--
-- Before using this, in the Supabase dashboard:
--   1. Authentication > Sign In / Providers: turn Email on. Turn Phone off.
--   2. Authentication > URL Configuration: add the site's address to Redirect
--      URLs, for example http://localhost:3000/** and your live address with
--      /** on the end. The emailed link goes to /auth/callback. If the address
--      isn't on this list, Supabase sends people to the Site URL instead.
--   The default "Magic link" email works as is: sign-in uses its link.

-- The mod-only people list now returns email instead of phone. The return
-- type changes, so the old function has to be dropped first.
drop function if exists list_members(uuid);

create or replace function list_members(p_page uuid)
returns table (id uuid, user_id uuid, display_name text, role text, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.user_id, m.display_name, m.role, u.email::text, m.created_at
  from members m
  join auth.users u on u.id = m.user_id
  where m.page_id = p_page
    and app_member_role(p_page) in ('owner', 'mod')
$$;

-- Server-only helpers (secret key). Supabase stores emails in lowercase.
create or replace function auth_user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1
$$;

create or replace function page_member_for_email(p_page uuid, p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from members m
  join auth.users u on u.id = m.user_id
  where m.page_id = p_page and lower(u.email) = lower(btrim(p_email))
  limit 1
$$;

-- The phone lookups are no longer used.
drop function if exists auth_user_id_for_phone(text);
drop function if exists page_member_for_phone(uuid, text);

-- Supabase hands new functions to anon by default. Take that back, then give
-- each function to exactly who needs it.
revoke execute on function
  list_members(uuid),
  auth_user_id_for_email(text),
  page_member_for_email(uuid, text)
from public, anon, authenticated;

grant execute on function list_members(uuid) to authenticated;

grant execute on function
  auth_user_id_for_email(text),
  page_member_for_email(uuid, text)
to service_role;
