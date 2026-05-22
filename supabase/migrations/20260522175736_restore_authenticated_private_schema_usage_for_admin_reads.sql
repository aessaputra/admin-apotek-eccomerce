begin;

-- Authenticated admin reads call public wrappers that depend on private.is_admin()
-- or private admin-gated read functions. The private schema remains outside the
-- Supabase exposed schemas; this grant only permits qualified references from
-- intended authenticated paths and does not grant table access.
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

comment on schema private is
  'Internal application schema outside the Supabase exposed schemas. Authenticated receives USAGE only so public admin read wrappers can call explicit private admin-gated functions; private tables remain revoked from browser roles.';

commit;
