begin;

create or replace function public.claim_profile_push_token(
  p_device_id text,
  p_expo_push_token text,
  p_platform text,
  p_last_seen_at timestamptz default pg_catalog.timezone('utc'::text, pg_catalog.now())
)
returns public.profile_push_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_device_id text := nullif(pg_catalog.btrim(p_device_id), '');
  v_expo_push_token text := nullif(pg_catalog.btrim(p_expo_push_token), '');
  v_platform text := nullif(pg_catalog.btrim(p_platform), '');
  v_last_seen_at timestamptz := coalesce(
    p_last_seen_at,
    pg_catalog.timezone('utc'::text, pg_catalog.now())
  );
  v_token_row public.profile_push_tokens;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  if v_device_id is null then
    raise exception 'device_id is required.' using errcode = '22023';
  end if;

  if v_expo_push_token is null then
    raise exception 'expo_push_token is required.' using errcode = '22023';
  end if;

  if v_platform is null then
    raise exception 'platform is required.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_expo_push_token, 0));

  update public.profile_push_tokens
  set
    revoked_at = v_last_seen_at,
    last_seen_at = v_last_seen_at
  where expo_push_token = v_expo_push_token
    and revoked_at is null
    and (user_id <> v_user_id or device_id <> v_device_id);

  insert into public.profile_push_tokens (
    user_id,
    device_id,
    expo_push_token,
    platform,
    last_seen_at,
    revoked_at
  )
  values (
    v_user_id,
    v_device_id,
    v_expo_push_token,
    v_platform,
    v_last_seen_at,
    null
  )
  on conflict (user_id, device_id)
  do update set
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    last_seen_at = excluded.last_seen_at,
    revoked_at = null
  returning * into v_token_row;

  return v_token_row;
end;
$$;

revoke all on function public.claim_profile_push_token(text, text, text, timestamptz) from public;
grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated;

commit;
