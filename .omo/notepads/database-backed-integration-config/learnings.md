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

## 2026-05-18 Task 1 Verification Fix
- Atlas found a valid semantic gap: versions only supported `active`/`retired`, and rotation/update did not transition previous active versions.
- Fixed status semantics to allow `active`, `grace`, `retired`, `disabled`, and `superseded`; added a partial unique one-active-per-key index plus active/grace lookup index for later runtime config helper work.
- Secret rotation now transitions previous active versions to `grace`; non-secret updates transition previous active versions to `retired`; current runtime fetch still returns only the current pointer with `status = 'active'`.
- Added regression SQL-shape assertions for status vocabulary, one-active invariant, grace lookup support, and previous-active transitions; red run failed 2 assertions before SQL fix and green run passed 11 tests after.

## 2026-05-18 Task 1 Current Pointer Constraint Fix
- Current-version pointers must bind `version_id` to the same `(key_name, version_number)` row, not rely on separate independent FKs.
- Added a named target uniqueness constraint on `private.integration_config_versions(key_name, version_number, id)` so PostgreSQL can enforce the composite pointer FK.
- Regression test now asserts the exact composite FK shape and rejects the previous inline `version_id`-only FK pattern.

## Supabase runtime config research

### 2026-05-19T01:10:29Z
- Request classification: TYPE D research. Official docs checked first; Context7 library ID used: `/websites/supabase`.
- Edge Function bootstrap env: current Supabase docs list default function secrets including `SUPABASE_URL`, newer `SUPABASE_SECRET_KEYS`/`SUPABASE_PUBLISHABLE_KEYS`, and legacy `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`. Secret/service-role keys are safe only in Edge Functions/backends and bypass RLS; they must never be sent to browsers. Docs: https://supabase.com/docs/guides/functions/secrets and https://supabase.com/docs/guides/database/secure-data.
- Repo-compatible recommendation: keep only Supabase bootstrap env in functions (`SUPABASE_URL` plus existing `SUPABASE_SERVICE_ROLE_KEY`, or migrate later to named `SUPABASE_SECRET_KEYS` if desired). Move provider credentials (`MIDTRANS_*`, `BITESHIP_API_KEY`, `EXPO_ACCESS_TOKEN`) to DB/Vault runtime config. Do not use or recommend `SUPABASE_DB_URL` for this feature even though it is listed as a default function secret.
- Service-role clients: official docs show admin clients created with `SUPABASE_SECRET_KEYS['default']`; legacy examples still create service clients with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Supabase’s own repo has an Edge Function reading `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, creating a service client, and calling `.rpc(...)`: https://github.com/supabase/supabase/blob/4c148ea060801a01800567fb2da94f6acee15786/supabase/functions/search-embeddings/index.ts#L7-L9 and https://github.com/supabase/supabase/blob/4c148ea060801a01800567fb2da94f6acee15786/supabase/functions/search-embeddings/index.ts#L44-L82.
- Edge Function auth constraints: `verify_jwt` validates the `Authorization` header as a user JWT only; service-to-service calls with API keys or external signed webhooks should set `verify_jwt = false` and authenticate inside the handler (secret key header or provider signature). Docs: https://supabase.com/docs/guides/functions/auth and https://supabase.com/docs/guides/functions/auth-headers.
- Vault: `vault.decrypted_secrets` decrypts at query time and anyone granted access to the view can read plaintext. Protect that view with SQL privileges; do not expose `vault` to browser roles or PostgREST custom schemas. Docs: https://supabase.com/docs/guides/database/vault.
- RPC/private schema pattern: Supabase docs say functions can be called through `supabase.rpc(...)`; if `security definer` is used, `search_path` must be set (empty path recommended with fully-qualified references). Functions are executable by roles unless revoked; revoke from `public`/`anon`/`authenticated` and grant only intended roles. Docs: https://supabase.com/docs/guides/database/functions.
- Data API exposure: `public` is exposed by default; custom/private schemas are not API-reachable unless added to exposed schemas and granted. Keep plaintext helpers and Vault-reading implementation in a non-exposed `private` schema; expose only narrow public service-role wrappers if PostgREST RPC routing requires it. Docs: https://supabase.com/docs/guides/api/using-custom-schemas and https://supabase.com/docs/guides/api/securing-your-api.
- RLS/security-definer nuance: service keys bypass RLS, but Supabase notes a user-scoped client can still follow the signed-in user’s RLS context; use a dedicated service-role/admin client for runtime config RPCs. Security-definer helpers should not be created in exposed schemas. Docs: https://supabase.com/docs/guides/database/postgres/row-level-security.
- Constraints for Tasks 5/7/8/11/12: later function cutovers should fetch runtime config at request time or through a short TTL helper using a service-role client; no provider env reads at module load; no browser/admin UI path can call plaintext runtime RPCs; public webhooks must verify provider signatures before any DB mutation/audit; final grep should allow only Supabase bootstrap env and reject provider env reads; RPC grants and `search_path = ''` should be asserted in migration tests.

## 2026-05-19T01:23:06Z Task 6 Snapshot Origin Fix
- Added versioned non-secret runtime config keys for `biteship.origin_area_id`, `biteship.origin_latitude`, and `biteship.origin_longitude` in the Task 6 migration and typed runtime helper.
- `ensureBiteshipOrderConfigSnapshot` now builds all stored Biteship origin metadata from runtime config, not live `settings`; `config_version_ids` now covers origin area, latitude, longitude, postal code, enabled couriers, and shipper fields.
- Regression coverage: Biteship snapshot creation test uses rotated live settings that differ from runtime config and asserts the snapshot/RPC payload uses runtime origin values plus version metadata. Migration/runtime config tests assert the added key definitions.
- Verification passed: targeted Task 6 `pnpm test ...` command (42 tests) and `pnpm build`.

## 2026-05-19 Task 4 Binding Preservation Fix
- Atlas gap confirmed: cross-order/idempotent Snap reuse read `sourcePaymentSession` but did not pass its payment ID into the binding RPC, so a new target payment would bind active config instead of the source transaction's config metadata.
- Fixed `persistPaymentSession`/`bindMidtransPaymentConfigVersions` to accept optional `sourcePaymentId` and pass `p_source_payment_id` only for cross-payment reuse.
- Updated `create-snap-token` cross-order reuse to require a source payment session before persisting the target reused Snap token, preserving config metadata without raw Midtrans secret material.
- Updated `private/public.bind_midtrans_payment_config_versions` to copy source binding metadata when `p_source_payment_id` is provided, while preserving any existing target binding on `payment_id` conflicts.
- Added regression coverage for source-binding preservation after active config rotation semantics; targeted Task 4 tests now cover 9 assertions across helper and SQL-shape files.

## 2026-05-19 Task 4 Binding Resolution Fix
- Atlas found a second valid Task 4 semantic gap: `bind_midtrans_payment_config_versions` still selected active current Midtrans config before preserving/copying existing bindings, so reuse could fail if active config rows were missing.
- Restructured the private RPC branch order: return existing target binding first, copy source binding second, and query active current config only for genuinely new bindings with no target/source binding.
- SQL-shape regression now asserts target/source binding lookups happen before the active current config lookup and that source reuse has an explicit `if p_source_payment_id is not null then` branch.

## 2026-05-19T03:50:19Z Task 4 Fresh Snap Config Drift Fix
- Review gap confirmed: fresh Snap creation used a selected Midtrans key/mode for the outgoing request, then the binding RPC could independently resolve current active config later and persist different version metadata after rotation.
- Fixed fresh `create-snap-token` path to resolve active runtime entries for `midtrans.server_key` and `midtrans.is_production` once for the request path, use those exact values for the Snap endpoint/Auth header, and pass only their version IDs/numbers plus production-mode boolean into `persistPaymentSession`.
- Extended `bind_midtrans_payment_config_versions` wrappers with optional explicit version/mode parameters. Existing target bindings and source reuse bindings still short-circuit before active-current lookup; explicit metadata is used for fresh bindings; active-current lookup remains only as a legacy/genuinely-new fallback.
- Added server-side complete-set validation for explicit metadata and kept composite FK enforcement through the binding insert. No Midtrans plaintext secret is added to payments, binding tables, migration SQL, logs, tests, or notes.
- Verification passed: `pnpm test supabase/functions/create-snap-token/__tests__/payment-session.test.ts supabase/migrations/__tests__/midtrans-config-version-bindings-migration.test.ts` (2 files, 11 tests), LSP diagnostics on changed create-snap-token TS files, and `pnpm build`.

## 2026-05-19T04:20:00Z Task 6 Snapshot Metadata Validation Fix
- Code-quality review gap confirmed: Task 6 only required each `config_version_ids` key to map to an object, so `{}` or metadata without `version_id`/`version_number` could be accepted before Biteship order creation.
- Hardened both TypeScript snapshot completeness checks and the SQL create-snapshot RPC to require every non-secret Biteship snapshot key to include a non-empty string `version_id` and positive integer `version_number`.
- Regression coverage now includes malformed per-key metadata in `biteship-order.test.ts` and SQL-shape assertions for the per-key JSONB metadata checks in the Task 6 migration test; `biteship.api_key` remains excluded from snapshot metadata.

## 2026-05-19T09:55:45Z Task 5 Midtrans Runtime Config Migration
- Added a service-role-only Midtrans payment config binding lookup RPC so Edge Functions can resolve transaction-bound version metadata by `midtrans_order_id` without exposing or storing plaintext Midtrans keys.
- `_shared/midtrans.ts` now resolves bound runtime config first, then active/grace signature candidates for unbound webhook payloads; status and cancel calls take the resolved `isProduction` mode explicitly so grace-key signatures use the same key/mode for verification.
- `midtrans-webhook` now performs only read-only runtime/binding lookups before signature validation; invalid signatures and pre-signature config failures return before raw notification, payment, order, audit, or side-effect writes.
- Confirm, reconciliation, admin order cancellation, and customer unpaid cancellation paths now call Midtrans using transaction-bound runtime config when available and fail closed with safe unavailable errors if runtime config cannot be resolved.
- Regression coverage added for invalid-signature no-write, missing-config no-write, grace-key status authorization, bound-version preference, static provider-env removal in migrated functions, and service-role-only binding lookup SQL shape.

## 2026-05-19T10:03:15Z Task 5 Review Cleanup
- Removed unused Task 5 locals flagged by Atlas LSP diagnostics in `midtrans-webhook`, `confirm-midtrans-payment`, and `reconcile-pending-midtrans-payments` without changing Midtrans transition, signature, status verification, amount/currency, or side-effect behavior.
- Fresh verification after cleanup: LSP diagnostics clear on the three reviewed files, targeted Task 5 tests passed (7 files / 39 tests), and `pnpm build` passed.

## 2026-05-19T10:18:08Z Task 7 Biteship Runtime Config Migration
- Removed direct `BITESHIP_API_KEY` runtime reads from Biteship proxy, order-manager tracking sync, and webhook side-effect fulfillment paths; `biteship.api_key` now resolves through `_shared/runtime-config.ts` at request/use time with fallback disabled.
- Added shared Biteship runtime helpers for safe config failure and Authorization header normalization; fulfillment still passes the API key separately from immutable Task 6 order snapshots, and snapshot payload assertions ensure no key is serialized.
- Added regression coverage for no module-level Biteship API-key guard, runtime RPC lookup of `biteship.api_key`, Biteship Authorization header construction from a placeholder runtime value, safe missing-config failure, source-level provider env removal, and no key leakage in task persistence.
- Verification passed: targeted Biteship/order-manager-related tests (8 files / 83 tests), LSP diagnostics clear on changed files after adding the Deno npm-specifier annotation, and `pnpm build` passed.
