-- create_care_page runs with search_path = public, but pgcrypto lives in the
-- extensions schema on Supabase, so the unqualified gen_random_bytes() call
-- failed. Schema-qualify it. Only that call changes.
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
