## 2026-05-18 Start Work
- Active plan: `.omo/plans/database-backed-integration-config.md`.
- Core invariant: no provider plaintext secrets in app tables, admin UI, network responses, logs, migrations, or tests.
- Supabase subtree rules: create new timestamped migrations with `npx supabase migration new`; never edit applied migrations; verify grants for anon/authenticated/service_role.
- Edge function subtree rules: public webhooks must validate provider signatures before DB mutation; never persist raw Midtrans notification before signature validation.

## 2026-05-18 Task 1 Exploration
- Supabase CLI is available via `npx supabase --version`; observed version `2.100.0`.
- Migration test should be `supabase/migrations/__tests__/database-backed-integration-config-migration.test.ts` and follow existing SQL string-shape tests.
- Strong references for Task 1:
  - `supabase/migrations/20260425064111_harden_sku_checkout_rpc.sql` for service-role-only `SECURITY DEFINER` RPC + revokes/grants.
  - `supabase/migrations/20260430090441_harden_internal_rpc_execute_privileges.sql` for internal RPC hardening.
  - `supabase/migrations/20260409120000_schedule_pending_midtrans_reconciliation.sql` for Vault read pattern in service-side SQL.
  - `supabase/migrations/20260507090000_add_push_delivery_tracking_and_receipts.sql` for private schema, partial unique active-token index, RLS, Vault reads, revokes.
  - `supabase/migrations/20260403110000_create_home_banners.sql` for active-version partial unique constraints.
- Tests should assert private schema/table creation, no plaintext secret columns, service-role-only plaintext RPC execution, fixed `search_path`, revoke from `public/anon/authenticated`, Vault access only inside locked routines, audit metadata only, and Biteship order snapshot table.

## 2026-05-18 Task 1 Supabase Vault Guidance
- Official guidance: `vault.decrypted_secrets` exposes plaintext; anyone with access can read decrypted values. Keep Vault reads behind private hardened functions only.
- Use `SECURITY DEFINER` only for Vault/plaintext access because elevated privileges are required; place helpers in non-exposed `private` schema, not `public`.
- Every `SECURITY DEFINER` function should use `set search_path = ''` and fully-qualified references such as `vault.decrypted_secrets` and `private.*`.
- Functions are executable by default unless revoked; revoke from `public`, `anon`, and `authenticated`, then grant plaintext runtime routines only to `service_role`.
- Do not grant direct select on `vault.decrypted_secrets` to app roles and do not expose `vault` via PostgREST/custom schemas.

## 2026-05-18 Task 1 Implementation
- Created migration `supabase/migrations/20260518180321_database_backed_integration_config.sql` via `npx supabase migration new database_backed_integration_config`.
- Added private metadata/version/current/audit/snapshot tables with no app-table plaintext secret columns; secret versions store `vault_secret_id`, masked value, and fingerprint metadata only.
- Added private service-role-only `SECURITY DEFINER` routines for runtime lookup, secret rotation, non-secret update, summary, and audit list; only runtime lookup reads `vault.decrypted_secrets`.
- Added public service-role-only wrappers so later Edge Functions can call RPCs through Supabase API without exposing the private or vault schemas in PostgREST.
- Added SQL-shape test `supabase/migrations/__tests__/database-backed-integration-config-migration.test.ts`; red run failed on missing migration, green run passed 9 tests.
- Full verification passed: `pnpm test` 68 files/670 tests and `pnpm build`; `npx supabase migration list --local` could not connect because local Postgres was not running.
