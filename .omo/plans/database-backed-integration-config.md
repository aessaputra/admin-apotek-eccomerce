# Database-Backed Integration Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `/start-work` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR
> **Summary**: Replace Midtrans, Biteship, shop integration, and Expo push business secrets/config loaded from Edge Function env with Supabase Vault + private metadata/audit tables + an authenticated admin gateway, while preserving payment/shipping security invariants.
> **Deliverables**:
> - Vault-backed config metadata/audit schema and service-role-only RPCs.
> - Runtime config helper with temporary migration fallback and final cutover checks.
> - Midtrans transaction-bound config versions and strict grace-key handling.
> - Biteship pre-settlement order config snapshots.
> - Settings tabs for masked config management and audit trail.
> - DB, Edge Function, UI, and cutover verification tests.
> **Effort**: XL
> **Parallel**: YES - 6 waves
> **Critical Path**: Task 1 → Tasks 2/3 → Tasks 4/6 → Tasks 5/7/8/10 → Task 11 → Task 12 → Final Verification

## Context
### Original Request
- “Selain secret bootstrap Supabase, jangan gunakan Supabase Edge Function secrets untuk Midtrans/Biteship/shop config.”
- Do not request/display real secret values; use placeholders only.
- Keep only Supabase bootstrap env such as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Edge Function env.
- Move Midtrans, Biteship, shop integration config, and `EXPO_ACCESS_TOKEN` into database/Vault-managed runtime config.
- Admin UI must create/rotate secrets, show masked values/metadata/audit only, and never show plaintext after save.
- Preserve Midtrans signature verification, status re-verification, idempotency, amount/currency validation, and side-effect safety.

### Interview Summary
- Secret storage: Supabase Vault.
- Vault access: private service-role-only `SECURITY DEFINER` RPCs; do not expose `vault` schema to browser/PostgREST; do not use direct `SUPABASE_DB_URL`.
- UI: tabs inside existing Settings page.
- Permissions: all current admins (`profiles.role === 'admin'`) can manage v1 config.
- Migration: DB/Vault first with temporary env fallback; final cutover removes Midtrans/Biteship/Expo fallback env reads.
- `EXPO_ACCESS_TOKEN`: include in v1.
- Biteship config: snapshot/version-link per order before settlement can trigger fulfillment.
- Midtrans: config versioned per transaction; old transactions use stored versions; grace key must be used consistently for signature and status verification.

### Metis Review (gaps addressed)
- Added explicit no-DB-write-before-valid-Midtrans-signature guardrail, including no fallback/runtime audit writes.
- Added transaction-bound Midtrans versioning for Snap, webhook, confirm, cancel, and reconciliation.
- Added Biteship snapshot lifecycle before fulfillment can run, with full origin/shipper/courier/version metadata.
- Added final cutover static grep for zero `MIDTRANS_*`, `BITESHIP_API_KEY`, and `EXPO_ACCESS_TOKEN` runtime env reads.
- Added admin gateway and RPC hardening: fixed `search_path`, revoked default execute, service-role-only plaintext routines, no browser Vault exposure.

## Work Objectives
### Core Objective
Implement a secure, audited, database/Vault-backed integration config system that removes final Edge Function env dependencies for Midtrans/Biteship/shop config and Expo push token while preserving existing payment and fulfillment behavior.

### Deliverables
- Supabase migration for private config metadata, audit logs, current version pointers, order config snapshots, grants/RLS, and service-only RPCs.
- `integration-config` Edge Function gateway for admin summary/read, non-secret updates, secret rotation, and audit list.
- Shared Edge Function runtime config helper with typed keys, version resolution, TTL cache, temporary env fallback, and no plaintext logging.
- Midtrans changes for version persistence, grace-key matching, status verification with matched/transaction-bound key, and no pre-signature DB writes.
- Biteship changes for request-time config loading, pre-settlement snapshots, and no module-load API-key dependency.
- Push function change to use Vault-backed optional Expo token.
- Settings UI tabs for masked config management and audit trail.
- Unit/integration tests and final no-env-read cutover checks.

### Definition of Done (verifiable conditions with commands)
- `pnpm test` passes.
- `pnpm build` passes.
- Static cutover checks return no final runtime env reads or aliases for provider secrets:
  ```bash
  grep -R "Deno\.env\.get(.*\(MIDTRANS_\|BITESHIP_API_KEY\|EXPO_ACCESS_TOKEN\)" "supabase/functions"
  grep -R "MIDTRANS_\|BITESHIP_API_KEY\|EXPO_ACCESS_TOKEN\|Deno\.env\.toObject" "supabase/functions"
  ```
  Expected after cutover task: no runtime source matches for provider-secret env names, aliases, or `Deno.env.toObject`; explicit test-fixture exceptions must live in test files and be documented in evidence.
- Browser/API responses from Settings config endpoints contain `masked_value`, metadata, and audit only; no plaintext provider secrets.
- Midtrans invalid signature returns `401` and creates no DB rows, including config audit rows.
- Missing required DB/Vault config after final cutover fails closed with retryable errors for payment/shipping paths.

### Must Have
- Supabase Vault for secret values.
- Private metadata/audit tables with no plaintext columns.
- Service-role-only plaintext RPCs and admin gateway verification of `profiles.role === 'admin'`.
- Midtrans transaction-bound config versions for old transactions.
- Grace-key matched status verification.
- Biteship snapshot before fulfillment eligibility.
- Temporary migration fallback only; final fallback removal.

### Must NOT Have
- No plaintext secret display in admin UI, network responses, audit logs, function logs, migrations, or tests.
- No `vault` schema exposure to browser/PostgREST.
- No direct browser access to service-role/plaintext routines.
- No direct `SUPABASE_DB_URL` dependency for this feature.
- No weakening of Midtrans signature, status re-verification, idempotency, amount/currency validation, or side-effect sequencing.
- No moving `SUPABASE_SERVICE_ROLE_KEY` into database.
- No customer frontend contract changes unless explicitly documented and tested.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after for existing codebase, with targeted regression tests before/alongside each implementation task where practical; framework is Vitest via `pnpm test`.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.omo/evidence/task-{N}-{slug}.{ext}`.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Shared dependencies are Wave 1.

Wave 1a: Task 1 (schema/RPC) — establishes DB/RPC contract.
Wave 1b: Task 2 (gateway), Task 3 (runtime helper) — parallel after Task 1.
Wave 2: Task 4 (Midtrans schema binding), Task 6 (Biteship snapshots), Task 9 (UI scaffolding) — parallel after foundation APIs.
Wave 3: Task 5 (Midtrans function migration), Task 7 (Biteship function migration), Task 8 (Push migration), Task 10 (UI audit/rotation tests).
Wave 4: Task 11 (migration/backfill/fallback rollout).
Wave 5: Task 12 (final cutover/static checks).
Wave 6: Final Verification Wave.

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|---|---|---|
| 1. Schema/RPC foundation | none | 2,3,4,6,11 |
| 2. Admin gateway | 1 | 9,10 |
| 3. Runtime config helper | 1 | 5,7,8,12 |
| 4. Midtrans version persistence | 1,3 | 5,11 |
| 5. Midtrans runtime migration | 3,4 | 12 |
| 6. Biteship snapshot lifecycle | 1,3 | 7,11 |
| 7. Biteship runtime migration | 3,6 | 12 |
| 8. Push token runtime migration | 3 | 12 |
| 9. Settings UI config tabs | 2 | 10 |
| 10. UI tests/audit UX | 2,9 | 12 |
| 11. Migration/backfill/fallback rollout | 1,4,6 | 12 |
| 12. Final cutover/no-env verification | 5,7,8,10,11 | Final Verification |

### Agent Dispatch Summary
| Wave | Task Count | Categories |
|---|---:|---|
| 1a | 1 | `unspecified-high` |
| 1b | 2 | `unspecified-high` |
| 2 | 3 | `unspecified-high`, `visual-engineering` |
| 3 | 4 | `unspecified-high`, `quick`, `visual-engineering` |
| 4 | 1 | `deep` |
| 5 | 1 | `unspecified-high` |
| 6 | 4 review agents | `oracle`, `unspecified-high`, `deep` |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Build private schema, metadata/audit tables, and service-only RPC foundation

  **What to do**: Create a Supabase migration using `supabase migration new database_backed_integration_config` (do not invent timestamp). Enable/validate Vault availability. Create private schema tables for config keys, versions, current pointers, audit logs, and Biteship order snapshots. Add constraints/indexes. Add hardened service-role-only `SECURITY DEFINER` RPCs for runtime config fetch, secret rotation, non-secret updates, summary, and audit list. Revoke direct table access and default function execute from `public`, `anon`, and `authenticated`; grant only required service-role execution. Seed known config keys.
  **Must NOT do**: Do not store plaintext secrets in app tables. Do not expose `vault` schema. Do not create browser-callable plaintext RPCs. Do not put real secret values in migrations.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: security-sensitive migration and Postgres grants.
  - Skills: `supabase`, `database-schema-designer`, `supabase-postgres-best-practices` - needed for RLS/grants/RPC hardening.
  - Omitted: `frontend-design` - no UI in this task.

  **Parallelization**: Can Parallel: NO | Wave 1a | Blocks: 2,3,4,6,11 | Blocked By: none

  **References**:
  - Rule: `supabase/migrations/AGENTS.md` - migration/RLS/grant/cron rules.
  - Pattern: `supabase/migrations/20260409120000_schedule_pending_midtrans_reconciliation.sql:13-53` - existing Vault secret usage pattern for cron bootstrap.
  - Pattern: `supabase/migrations/20260408110000_schedule_webhook_side_effect_processor.sql:13-51` - service-role Vault cron pattern.
  - Existing settings schema: `supabase/migrations/20260401113000_add_enabled_couriers_to_settings.sql` and `supabase/migrations/20260402084000_normalize_settings_origin_shipping_columns.sql` - current shipping/shop config precedent.
  - Supabase docs finding: Vault is preferred; security definer functions need fixed `search_path` and revoked default execute.

  **Acceptance Criteria**:
  - [ ] New migration exists under `supabase/migrations/` and contains no real secret values.
  - [ ] Tables have no plaintext secret column.
  - [ ] `anon` and normal `authenticated` cannot select private config tables or execute plaintext runtime RPCs.
  - [ ] One active version per config key is enforced.
  - [ ] Audit rows contain only masked values/fingerprints/metadata.
  - [ ] Targeted SQL/Vitest tests verify grants and constraints, then `pnpm test` passes.

  **QA Scenarios**:
  ```
  Scenario: Browser roles cannot read secrets
    Tool: Bash
    Steps: Run targeted DB/RPC tests that attempt metadata/plaintext access as anon and authenticated roles.
    Expected: SELECT/EXECUTE attempts fail or return sanitized metadata only; no plaintext value appears.
    Evidence: .omo/evidence/task-1-schema-rpc-security.txt

  Scenario: Service role can rotate placeholder secret atomically
    Tool: Bash
    Steps: Run targeted test using placeholder `test_midtrans_key_placeholder` through service rotate routine.
    Expected: Vault secret ID, masked value, version row, current pointer, and audit row are created atomically; plaintext appears nowhere in returned summary/audit.
    Evidence: .omo/evidence/task-1-schema-rpc-rotate.txt
  ```

  **Commit**: YES | Message: `feat(config): add integration config schema` | Files: `supabase/migrations/*database_backed_integration_config*.sql`, related tests

- [x] 2. Create `integration-config` Edge Function admin gateway

  **What to do**: Add `supabase/functions/integration-config/index.ts` (or equivalent) with CORS handling, authenticated user JWT verification, server-side admin role check (`profiles.role === 'admin'`), and actions: list summary, rotate secret, update non-secret config, list audit logs. Use service role only inside function. Return masked metadata only. Add `verify_jwt = false` config only if following existing custom auth pattern, and enforce custom checks internally.
  **Must NOT do**: Do not return plaintext secret values. Do not trust client-side Refine auth state. Do not allow non-admin writes.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: privileged gateway with auth/security edge cases.
  - Skills: `supabase`, `supabase-edge-functions` - Edge Function auth and service-role patterns.
  - Omitted: `Webhook Automation` - no payment state changes in this task.

  **Parallelization**: Can Parallel: YES | Wave 1b | Blocks: 9,10 | Blocked By: 1

  **References**:
  - Auth pattern: `supabase/functions/biteship/index.ts:35-44` - Supabase URL/JWT issuer setup.
  - Service-role pattern: `supabase/functions/process-webhook-side-effects/index.ts:27-31` - service-role protected function.
  - Push service-role/user auth: `supabase/functions/push/handler.ts:186-190`, `946-1003`.
  - CORS: `supabase/functions/_shared/cors.ts:1-17`.
  - Config: `supabase/config.toml:377-414` - custom `verify_jwt = false` declarations.

  **Acceptance Criteria**:
  - [ ] Admin JWT can list summary, rotate placeholder secret, update non-secret config, and list audit.
  - [ ] Non-admin JWT receives `403`.
  - [ ] Missing/invalid JWT receives `401`.
  - [ ] Responses contain no plaintext provider secret.
  - [ ] Gateway tests cover CORS preflight, auth, role, validation, and no-plaintext responses.

  **QA Scenarios**:
  ```
  Scenario: Admin rotates placeholder Biteship key
    Tool: Bash
    Steps: Run gateway test with mocked admin JWT and placeholder secret body.
    Expected: HTTP 200/201 returns key, masked_value, version, status, updated_by, updated_at; plaintext placeholder absent.
    Evidence: .omo/evidence/task-2-gateway-admin-rotate.txt

  Scenario: Non-admin cannot rotate secret
    Tool: Bash
    Steps: Run gateway test with mocked non-admin profile role.
    Expected: HTTP 403; no Vault write, version row, or audit row for the attempted rotation.
    Evidence: .omo/evidence/task-2-gateway-non-admin.txt
  ```

  **Commit**: YES | Message: `feat(config): add admin config gateway` | Files: `supabase/functions/integration-config/**`, `supabase/config.toml`, gateway tests

- [x] 3. Add shared runtime config helper with versioned lookup and temporary fallback support

  **What to do**: Create `supabase/functions/_shared/runtime-config.ts` with typed config keys, returned shapes, mask/fingerprint helpers, TTL cache, service-role RPC calls, version-specific lookup, active/grace lookup, and temporary env fallback helpers. Add structured error classes/codes: `CONFIG_MISSING`, `CONFIG_INVALID`, `CONFIG_UNAVAILABLE`, `CONFIG_FALLBACK_USED`. Ensure fallback logging/auditing can be disabled in pre-signature webhook context.
  **Must NOT do**: Do not log plaintext. Do not read provider envs at module load. Do not write DB audit before Midtrans signature validation.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: shared helper affects all integrations.
  - Skills: `supabase`, `supabase-edge-functions`, `clean-code` - typed helper and error boundaries.
  - Omitted: `refine-dev` - no UI.

  **Parallelization**: Can Parallel: YES | Wave 1b | Blocks: 4,5,6,7,8,12 | Blocked By: 1

  **References**:
  - Supabase admin bootstrap: `supabase/functions/_shared/supabase.ts:9-16`.
  - Midtrans helper style: `supabase/functions/_shared/midtrans.ts:182-227`.
  - Biteship settings loader: `supabase/functions/_shared/biteship.ts:501-533`.
  - Webhook-side-effects async trigger env usage: `supabase/functions/_shared/webhook-side-effects.ts:836-853`.

  **Acceptance Criteria**:
  - [ ] Helper can fetch active, grace, and explicit version configs through service-role RPC.
  - [ ] Helper supports temporary fallback for migration but can be configured to fail closed.
  - [ ] Helper has no module-load provider env reads.
  - [ ] Tests prove no plaintext appears in serialized errors/log-safe objects.

  **QA Scenarios**:
  ```
  Scenario: Active config cache hit
    Tool: Bash
    Steps: Run runtime-config tests that fetch active placeholder config twice within TTL.
    Expected: First call queries RPC; second call uses cache; both return typed values without logging plaintext.
    Evidence: .omo/evidence/task-3-runtime-cache.txt

  Scenario: Missing required config fails closed
    Tool: Bash
    Steps: Run runtime-config test with no active `midtrans.server_key` and fallback disabled.
    Expected: Throws/returns `CONFIG_MISSING`; no plaintext and no DB write in pre-signature mode.
    Evidence: .omo/evidence/task-3-runtime-missing.txt
  ```

  **Commit**: YES | Message: `feat(config): add runtime config helper` | Files: `supabase/functions/_shared/runtime-config.ts`, helper tests

- [x] 4. Persist Midtrans config versions on payment transactions

  **What to do**: Add migration columns or related table to bind each Midtrans transaction/order/payment to the exact `midtrans.server_key` version and `midtrans.is_production` version/mode used when `create-snap-token` creates or reuses a Snap token. Backfill legacy pending transactions with a migration-time active/fallback placeholder binding where safe. Update tests for read/write model impacts if needed.
  **Must NOT do**: Do not force old transactions to use newest active key. Do not store raw server key in order/payment tables.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: payment schema and migration correctness.
  - Skills: `Webhook Automation`, `supabase`, `database-schema-designer` - payment invariants and schema design.
  - Omitted: `frontend-design` - backend-only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5,11 | Blocked By: 1,3

  **References**:
  - Snap creation: `supabase/functions/create-snap-token/index.ts:362-384`.
  - Midtrans status/cancel env mode: `supabase/functions/_shared/midtrans.ts:182-227`.
  - Payment/order schema context: `supabase/migrations/20260417174713_normalize_order_payment_shipment_schema.sql`.
  - Midtrans tests: `supabase/functions/_shared/__tests__/midtrans.test.ts`.

  **Acceptance Criteria**:
  - [ ] Every new/reused Snap token has transaction-bound config version metadata.
  - [ ] Legacy pending transactions have deterministic binding strategy documented in migration comments/tests.
  - [ ] No raw Midtrans server key is stored outside Vault.
  - [ ] Tests cover create, reuse, and legacy binding paths.

  **QA Scenarios**:
  ```
  Scenario: New Snap token stores active config versions
    Tool: Bash
    Steps: Run create-snap-token test with active placeholder config versions.
    Expected: Order/payment row records server-key version ID and production-mode version ID used for Snap.
    Evidence: .omo/evidence/task-4-midtrans-version-new.txt

  Scenario: Reused Snap token keeps original config versions
    Tool: Bash
    Steps: Run reuse-token test after rotating active config.
    Expected: Existing token is reused and original config version IDs remain unchanged.
    Evidence: .omo/evidence/task-4-midtrans-version-reuse.txt
  ```

  **Commit**: YES | Message: `feat(midtrans): bind transactions to config versions` | Files: Midtrans migration, create Snap token tests

- [ ] 5. Migrate Midtrans functions to transaction-bound runtime config

  **What to do**: Update `create-snap-token`, `midtrans-webhook`, `confirm-midtrans-payment`, `reconcile-pending-midtrans-payments`, `order-manager`, and `_shared/midtrans.ts` to use runtime config helper. New Snap uses active key/env only. Webhook uses transaction-bound key/env when safely resolvable; otherwise tries active + grace for signature without DB writes. If grace matches, status verification uses the same matched key. Confirm/cancel/reconciliation use transaction-bound config. Preserve existing state transition and amount/currency logic.
  **Must NOT do**: Do not write raw notifications, fallback audit, runtime_error audit, or any DB row before a valid Midtrans signature. Do not use active key for old transaction status verification if a transaction-bound version exists.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: security-critical payment pipeline.
  - Skills: `Webhook Automation`, `supabase-edge-functions`, `systematic-debugging` - Midtrans invariants and failure modes.
  - Omitted: `refine-dev` - no UI.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 3,4

  **References**:
  - Webhook critical path: `supabase/functions/midtrans-webhook/index.ts:291-476`.
  - Signature key read: `supabase/functions/midtrans-webhook/index.ts:303-315`.
  - Snap endpoint/key read: `supabase/functions/create-snap-token/index.ts:362-384`.
  - Confirm status check: `supabase/functions/confirm-midtrans-payment/index.ts:147-158`.
  - Reconciliation status check: `supabase/functions/reconcile-pending-midtrans-payments/index.ts:157-186`.
  - Order manager cancel/verify: `supabase/functions/order-manager/index.ts:305-317`.
  - Shared helpers: `supabase/functions/_shared/midtrans.ts:163`, `182-227`.

  **Acceptance Criteria**:
  - [ ] Invalid webhook signature returns `401` and creates no DB rows.
  - [ ] Missing config before signature validation returns `503` and creates no DB rows.
  - [ ] Grace-key signature match uses same key for Midtrans status verification.
  - [ ] Confirm/cancel/reconciliation use transaction-bound config versions.
  - [ ] Existing amount/currency/idempotency/side-effect tests still pass.

  **QA Scenarios**:
  ```
  Scenario: Invalid signature creates no DB writes
    Tool: Bash
    Steps: Run midtrans-webhook test with invalid signature and spies for raw notification/audit inserts.
    Expected: HTTP 401; no raw notification, config audit, runtime_error, payment, order, or side-effect rows are written.
    Evidence: .omo/evidence/task-5-midtrans-invalid-no-write.txt

  Scenario: Old transaction signed by grace key verifies status with grace key
    Tool: Bash
    Steps: Run webhook test for transaction bound to old key in grace status while active key differs.
    Expected: Signature matches grace key; status API Authorization uses grace key; transition proceeds only after amount/currency validation.
    Evidence: .omo/evidence/task-5-midtrans-grace-status.txt
  ```

  **Commit**: YES | Message: `feat(midtrans): load config from Vault-backed runtime` | Files: Midtrans functions/shared helpers/tests

- [x] 6. Create Biteship pre-settlement snapshot lifecycle

  **What to do**: Add or update logic so Biteship config snapshot is created before settlement can trigger fulfillment. Snapshot must include `origin_area_id`, `origin_latitude`, `origin_longitude`, origin postal code, courier/service selections, shipper name/phone/email/address/organization, and config version IDs. Ensure settlement side effects require an existing valid snapshot or create it atomically before queuing fulfillment, but never wait until Biteship API order creation.
  **Must NOT do**: Do not let old orders read latest active origin/shipper/courier config after rotation. Do not store Biteship API key in snapshot.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: order lifecycle and fulfillment correctness.
  - Skills: `Webhook Automation`, `supabase`, `database-schema-designer` - settlement side effects and snapshot schema.
  - Omitted: `refine-dev` - backend-only.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7,11 | Blocked By: 1,3

  **References**:
  - Settings reader: `supabase/functions/_shared/biteship.ts:501-533`.
  - Required shipper config: `supabase/functions/_shared/biteship.ts:371-399`.
  - Order payload builder: `supabase/functions/_shared/biteship.ts:652-727`.
  - Settlement side effects: `supabase/functions/_shared/webhook-side-effects.ts:513`, `667-778`.
  - Order flow tests: `supabase/functions/_shared/__tests__/webhook-side-effects.test.ts`, `order-flow-rules.test.ts`.

  **Acceptance Criteria**:
  - [ ] Snapshot is created before fulfillment side-effect task can call Biteship order creation.
  - [ ] Snapshot contains all required origin, shipper, courier/service, and version ID fields.
  - [ ] Rotating Biteship config does not mutate existing order fulfillment behavior.
  - [ ] Missing/partial snapshot blocks fulfillment with retryable task status.

  **QA Scenarios**:
  ```
  Scenario: Settlement requires complete snapshot
    Tool: Bash
    Steps: Run side-effect test for settlement with missing origin_area_id or shipper phone in snapshot.
    Expected: Fulfillment is not sent to Biteship; task is marked retryable/config error with no partial external order.
    Evidence: .omo/evidence/task-6-biteship-snapshot-required.txt

  Scenario: Rotated config does not alter old order
    Tool: Bash
    Steps: Create snapshot with courier/origin A, rotate active config to B, run fulfillment for old order.
    Expected: Biteship payload uses snapshot A and stored config version IDs.
    Evidence: .omo/evidence/task-6-biteship-snapshot-immutable.txt
  ```

  **Commit**: YES | Message: `feat(biteship): snapshot fulfillment config per order` | Files: snapshot migration/helpers/tests

- [ ] 7. Migrate Biteship runtime to request-time Vault-backed config

  **What to do**: Refactor `biteship/index.ts`, `order-manager/index.ts`, `_shared/biteship.ts`, and `_shared/webhook-side-effects.ts` to load `biteship.api_key` from runtime config helper at request/use time. Remove module-load `BITESHIP_API_KEY` dependency in runtime path. Use Biteship snapshots for order creation payloads. Use active config only for new authenticated rate lookup/proxy requests that are not tied to an existing order/shipment snapshot.
  **Must NOT do**: Do not keep final module-level API key reads. Do not use latest active config for old fulfillment snapshots. Do not expose Biteship API key to browser responses.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: shipping proxy and fulfillment side effects.
  - Skills: `supabase-edge-functions`, `clean-code` - refactor module-load env reads safely.
  - Omitted: `Webhook Automation` optional - only needed if touching settlement trigger sequencing.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 3,6

  **References**:
  - Biteship module init/key read: `supabase/functions/biteship/index.ts:35-40`.
  - Biteship proxy auth header: `supabase/functions/biteship/index.ts:496-524`, `699-712`.
  - Order manager tracking key read: `supabase/functions/order-manager/index.ts:845-850`.
  - Webhook fulfillment key read: `supabase/functions/_shared/webhook-side-effects.ts:667-778`.

  **Acceptance Criteria**:
  - [ ] `biteship/index.ts` imports without `BITESHIP_API_KEY` env present.
  - [ ] Biteship API calls load key at request/use time from runtime helper.
  - [ ] Missing API key fails closed with safe error and no plaintext logging.
  - [ ] Existing Biteship rates/order/tracking tests pass.

  **QA Scenarios**:
  ```
  Scenario: No module-load API-key crash
    Tool: Bash
    Steps: Run Biteship function import/unit test with `BITESHIP_API_KEY` unset.
    Expected: Module imports successfully; request requiring key fails only at request-time with config error.
    Evidence: .omo/evidence/task-7-biteship-no-module-env.txt

  Scenario: Tracking sync uses Vault-backed key
    Tool: Bash
    Steps: Run order-manager sync_tracking test with runtime helper returning placeholder key.
    Expected: Biteship Authorization header is built from runtime config; response/logs do not include key.
    Evidence: .omo/evidence/task-7-biteship-runtime-key.txt
  ```

  **Commit**: YES | Message: `feat(biteship): load api key from runtime config` | Files: Biteship functions/shared helpers/tests

- [ ] 8. Migrate Expo push token to Vault-backed runtime config

  **What to do**: Update push handler to load optional `push.expo_access_token` from runtime config helper instead of `Deno.env.get('EXPO_ACCESS_TOKEN')`. Keep token optional if existing behavior allows unauthenticated Expo requests; document/test exact missing-token behavior. Ensure send and receipt paths use same runtime source.
  **Must NOT do**: Do not make token required unless tests and config key definition mark it required. Do not log token.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: localized token source change with tests.
  - Skills: `supabase-edge-functions` - Edge runtime config.
  - Omitted: `Webhook Automation` - unrelated to payment webhooks.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 3

  **References**:
  - Expo token send read: `supabase/functions/push/handler.ts:812-820`.
  - Expo token receipts read: `supabase/functions/push/handler.ts:664-675`.
  - Push auth tests: `supabase/functions/push/__tests__/index.test.ts`.

  **Acceptance Criteria**:
  - [ ] Push send and receipt paths use runtime config helper.
  - [ ] Missing token optional behavior is explicitly tested.
  - [ ] No `EXPO_ACCESS_TOKEN` runtime env read remains after final cutover task.
  - [ ] Push tests pass.

  **QA Scenarios**:
  ```
  Scenario: Push uses Vault-backed token
    Tool: Bash
    Steps: Run push handler test with runtime helper returning placeholder Expo token.
    Expected: Expo Authorization header is set from helper; response/log output excludes token.
    Evidence: .omo/evidence/task-8-push-runtime-token.txt

  Scenario: Optional token absent
    Tool: Bash
    Steps: Run push handler test with no active push token.
    Expected: Existing optional behavior is preserved and tested; no env fallback is used after cutover.
    Evidence: .omo/evidence/task-8-push-token-absent.txt
  ```

  **Commit**: YES | Message: `feat(push): load expo token from runtime config` | Files: `supabase/functions/push/**`, push tests

- [ ] 9. Add Settings tabs for integration config management

  **What to do**: Extend `src/pages/settings/index.tsx` with tabs/sections for Midtrans, Biteship, Shop/Shipper, Push, CORS, and Audit Trail. Use Ant Design/Refine existing settings patterns. Add API client wrapper for `integration-config` Edge Function calls. Display masked secrets, status, active version, last updated, updated by, last runtime read, and validation errors. Secret rotate inputs are empty-only and require confirmation phrase plus reason. Add i18n keys.
  **Must NOT do**: Do not use Refine direct table CRUD for plaintext or private tables. Do not prefill secret inputs. Do not add a separate visible resource/menu item.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: admin UI forms, tabs, validation, masked secret UX.
  - Skills: `refine-dev`, `frontend-design`, `ux-copy` - Refine/AntD Settings UI and safe microcopy.
  - Omitted: `Webhook Automation` - no webhook logic.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 2

  **References**:
  - Settings form pattern: `src/pages/settings/index.tsx:155-178`, `195-357`, `359-385`.
  - i18n provider: `src/App.tsx:68-81`.
  - Locale settings keys: `src/locales/id/common.json:820-903`, `src/locales/en/common.json:820-903`.
  - Resource route tests if App changes: `src/__tests__/App.test.tsx:124-139`.

  **Acceptance Criteria**:
  - [ ] Settings page contains integration config tabs with masked metadata and audit trail.
  - [ ] Secret fields are blank on render and only submit new values through gateway.
  - [ ] Rotate confirmation requires reason and explicit confirmation.
  - [ ] Indonesian and English locale keys are in parity.
  - [ ] UI tests prove no plaintext is rendered.

  **QA Scenarios**:
  ```
  Scenario: Settings renders masked Midtrans secret only
    Tool: Bash
    Steps: Run settings form test with gateway summary containing masked value and a separate fake plaintext sentinel.
    Expected: Masked value is visible; plaintext sentinel is absent from DOM.
    Evidence: .omo/evidence/task-9-settings-masked.txt

  Scenario: Rotate modal requires reason and confirmation
    Tool: Bash
    Steps: Run UI test opening rotate modal and submitting without reason/confirmation.
    Expected: Localized validation errors appear and gateway is not called.
    Evidence: .omo/evidence/task-9-settings-rotate-validation.txt
  ```

  **Commit**: YES | Message: `feat(settings): add integration config tabs` | Files: `src/pages/settings/index.tsx`, UI helpers, locale files, UI tests

- [ ] 10. Complete admin UI gateway tests and audit trail behavior

  **What to do**: Add/extend Vitest tests for settings integration config tabs, audit trail rendering, gateway client error handling, and admin/non-admin UX. Ensure audit rows show action, key, old/new masked values, actor/source, reason, timestamp, request ID. Ensure network mock responses containing plaintext sentinel are not rendered.
  **Must NOT do**: Do not add plaintext reveal/download UX. Do not skip locale parity.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI interaction and accessibility-style tests.
  - Skills: `refine-dev`, `testing-strategy` - existing Refine test patterns.
  - Omitted: `supabase-edge-functions` - gateway itself covered elsewhere.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 2,9

  **References**:
  - Settings tests: `src/pages/__tests__/forms.test.tsx:677-693`.
  - List/page test patterns: `src/pages/__tests__/lists.test.tsx:47-77`, `505-560`.
  - Data provider tests if client wrapper touches provider: `src/providers/__tests__/data.test.ts:133-181`, `490-508`.
  - Locale parity: `src/locales/__tests__/common-keys.test.ts`.

  **Acceptance Criteria**:
  - [ ] Tests cover summary loading, rotate success/failure, audit rendering, validation, and no plaintext rendering.
  - [ ] Locale parity test passes.
  - [ ] `pnpm test` passes for frontend suite.

  **QA Scenarios**:
  ```
  Scenario: Audit trail hides plaintext
    Tool: Bash
    Steps: Run audit UI test with audit rows containing masked fields and an injected plaintext sentinel in unrelated mock data.
    Expected: Only masked fields render; plaintext sentinel absent.
    Evidence: .omo/evidence/task-10-audit-no-plaintext.txt

  Scenario: Gateway validation error localized
    Tool: Bash
    Steps: Run UI test with gateway returning validation error for invalid courier list.
    Expected: Localized Indonesian/English error copy is available and rendered in active locale.
    Evidence: .omo/evidence/task-10-ui-validation-i18n.txt
  ```

  **Commit**: YES | Message: `test(settings): cover integration config management` | Files: Settings tests, locale tests, helpers

- [ ] 11. Implement phased migration, legacy binding, and fallback observability

  **What to do**: Implement rollout mechanics: seed config definitions, one-time placeholder-safe secret loading guidance/tests, legacy pending order Midtrans binding, Biteship snapshot backfill where possible, DB/Vault-first temporary env fallback, and fallback observability that never writes DB before Midtrans signature validation. Add comments/docs in migration or plan-adjacent evidence explaining how operators load real secrets without committing/printing them.
  **Must NOT do**: Do not put real secret values in SQL, docs, tests, shell commands, or evidence. Do not silently fall back without safe post-signature observability where allowed.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: migration sequencing, legacy data, fallback safety.
  - Skills: `supabase`, `Webhook Automation`, `testing-strategy` - rollout and payment safety.
  - Omitted: `frontend-design` - no UI.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 12 | Blocked By: 1,4,6

  **References**:
  - Cron/Vault patterns: `supabase/migrations/20260409120000_schedule_pending_midtrans_reconciliation.sql:13-53`, `20260417174713_normalize_order_payment_shipment_schema.sql:501-541`.
  - Midtrans reconciliation: `supabase/functions/reconcile-pending-midtrans-payments/index.ts:35-40`, `157-186`.
  - Webhook no-write requirement: `supabase/functions/midtrans-webhook/index.ts:291-330`.

  **Acceptance Criteria**:
  - [ ] Migration phase supports DB/Vault-first with temporary env fallback for Midtrans/Biteship/Expo.
  - [ ] Final target path can disable fallback and fail closed.
  - [ ] Legacy Midtrans transactions and Biteship pending orders have deterministic handling.
  - [ ] Fallback observability never causes pre-signature DB writes in webhook path.
  - [ ] Operator guidance uses placeholders only.

  **QA Scenarios**:
  ```
  Scenario: Legacy Midtrans transaction binds to safe version
    Tool: Bash
    Steps: Run migration/backfill test with pending order created before config versions exist.
    Expected: Order receives deterministic version binding or explicit retryable migration status; no raw secret stored.
    Evidence: .omo/evidence/task-11-legacy-midtrans-binding.txt

  Scenario: Pre-signature missing config has no DB audit write
    Tool: Bash
    Steps: Run webhook test with config unavailable and invalid/unverifiable signature.
    Expected: HTTP 503; safe log only; no audit/raw notification/runtime_error row.
    Evidence: .omo/evidence/task-11-pre-signature-no-audit.txt
  ```

  **Commit**: YES | Message: `feat(config): add migration fallback and legacy bindings` | Files: migrations, runtime helper, tests, placeholder-only operator notes if needed

- [ ] 12. Remove final provider env fallback and prove cutover

  **What to do**: Remove final runtime fallback reads for `MIDTRANS_*`, `BITESHIP_API_KEY`, and `EXPO_ACCESS_TOKEN` after all runtime helpers are wired and tests pass. Keep only Supabase bootstrap env. Add static tests or scriptable checks that fail on provider env reads, aliases, multiline wrappers, or `Deno.env.toObject()` in runtime source. Run full test/build. Confirm `biteship/index.ts` no longer reads `BITESHIP_API_KEY` at module load.
  **Must NOT do**: Do not leave fallback code in happy paths. Do not remove `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: final security cutover across all functions.
  - Skills: `supabase-edge-functions`, `verification-before-completion` - final proof and no-env checks.
  - Omitted: `frontend-design` - no UI.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: Final Verification | Blocked By: 5,7,8,10,11

  **References**:
  - Current env usage inventory from exploration.
  - `supabase/functions/biteship/index.ts:35-40` - module-load Biteship key read to eliminate.
  - `package.json:48-54` - `pnpm test` and `pnpm build` scripts.

  **Acceptance Criteria**:
  - [ ] Static grep/check returns zero runtime source reads, aliases, or environment object dumps for `MIDTRANS_*`, `BITESHIP_API_KEY`, and `EXPO_ACCESS_TOKEN`.
  - [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain as bootstrap env only.
  - [ ] `pnpm test` passes.
  - [ ] `pnpm build` passes.
  - [ ] Evidence files include static grep output and test/build output.

  **QA Scenarios**:
  ```
  Scenario: No final provider env reads
    Tool: Bash
    Steps: Run both `grep -R "Deno\.env\.get(.*\(MIDTRANS_\|BITESHIP_API_KEY\|EXPO_ACCESS_TOKEN\)" "supabase/functions"` and `grep -R "MIDTRANS_\|BITESHIP_API_KEY\|EXPO_ACCESS_TOKEN\|Deno\.env\.toObject" "supabase/functions"`.
    Expected: No runtime source matches remain; any test-fixture matches are documented as allowed exceptions in evidence.
    Evidence: .omo/evidence/task-12-no-provider-env-reads.txt

  Scenario: Full local verification
    Tool: Bash
    Steps: Run `pnpm test` then `pnpm build`.
    Expected: Both commands exit 0.
    Evidence: .omo/evidence/task-12-test-build.txt
  ```

  **Commit**: YES | Message: `chore(config): remove provider env fallbacks` | Files: runtime functions/helpers/tests

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle
  - Verify every confirmed design decision and mandatory revision is implemented.
  - Evidence: `.omo/evidence/f1-plan-compliance.md`.
- [ ] F2. Code Quality Review — unspecified-high
  - Review schema/RPC/function/UI code for maintainability, type safety, and project conventions.
  - Evidence: `.omo/evidence/f2-code-quality.md`.
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
  - Exercise Settings config tabs, rotate modal with placeholder secret, audit trail, and no plaintext in browser responses.
  - Evidence: `.omo/evidence/f3-manual-qa.md` plus screenshots if Playwright is available.
- [ ] F4. Scope Fidelity Check — deep
  - Verify no scope creep: no generic secret manager, no super-admin RBAC expansion, no plaintext reveal UX, no customer frontend contract changes unless documented.
  - Evidence: `.omo/evidence/f4-scope-fidelity.md`.

## Commit Strategy
- Commit after each task with the message specified in the task.
- Do not commit real secrets, `.env`, or generated evidence containing secret values.
- If hooks/tests fail, fix before committing the task.
- Final commit sequence should show schema → gateway/helper → integration migrations → UI → cutover.

## Success Criteria
- Admin can manage Midtrans/Biteship/Push/shop config from Settings without seeing plaintext secrets.
- Runtime functions use Vault-backed config after cutover and no final provider env fallback remains.
- Midtrans old/new transactions remain verifiable through transaction-bound config versions.
- Biteship fulfillment uses immutable per-order snapshots.
- Audit trail records safe metadata for admin config changes.
- Full tests/build and static no-env verification pass.
