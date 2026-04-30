begin;

alter table public.profiles
  add column if not exists email text;

update public.profiles as p
set email = u.email
from auth.users as u
where p.id = u.id
  and p.email IS DISTINCT FROM u.email;

update public.profiles
set email = null
where email is not null
  and btrim(email) = '';

alter table public.profiles
  drop constraint if exists profiles_email_not_blank;

alter table public.profiles
  add constraint profiles_email_not_blank
    check (email is null or btrim(email) <> '');

comment on column public.profiles.email is
  'Mirrors auth.users.email for customer search/display without querying auth.users from client code. Current profile RLS remains self-or-admin: authenticated users can select only their own profile or admins can select via auth.uid() = id OR private.is_admin().';

create schema if not exists private;

create or replace function private.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  update public.profiles
  set
    email = new.email,
    updated_at = timezone('utc'::text, now())
  where id = new.id
    and email IS DISTINCT FROM new.email;

  return new;
end;
$$;

revoke all on function private.sync_profile_email_from_auth_user() from public, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_sync_profile_email_from_auth_user on auth.users;

create trigger trigger_sync_profile_email_from_auth_user
  AFTER INSERT OR UPDATE OF email ON auth.users
  for each row
  execute function private.sync_profile_email_from_auth_user();

commit;
