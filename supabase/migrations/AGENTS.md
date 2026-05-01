# Supabase Migrations

**Purpose:** Ordered SQL history for schema, RLS, grants, RPCs, cron jobs, storage policies, reporting views, and operational hardening.

## STRUCTURE

```text
supabase/migrations/
├── YYYYMMDDHHMMSS_descriptive_name.sql
└── __tests__/                 # Vitest SQL assertion tests for selected migrations
```

## WORKFLOW

- Create a new timestamped migration for every schema/RLS/grant/RPC/cron change.
- Do not edit applied migrations unless deliberately repairing local history with remote-state evidence.
- Prefer guarded SQL: `if exists`, `if not exists`, named constraints/policies, explicit comments.
- For policy/grant changes, verify role intent for `anon`, `authenticated`, `service_role`, and admin internals.
- For cron/http jobs, check Vault secret names and guard missing/duplicate schedules.

## COMMANDS

```bash
npx supabase migration new <descriptive_name>
npx supabase migration list --linked
npx supabase db push --dry-run --include-all
npx supabase db lint --linked
```

Use Supabase SQL/schema inspection when CLI credentials or migration history block local dry-run.

## TESTING

- Migration tests live in `supabase/migrations/__tests__/` and assert SQL safety/shape.
- Add tests for high-risk migrations: RLS, grants, cron scheduling, payment/order RPCs, notification jobs, storage policies.
- Run `pnpm test` after adding or modifying migration tests.

## DOMAIN RULES

- Internal `SECURITY DEFINER` RPCs used by Edge Functions should not be executable by direct browser roles unless explicitly intended.
- Checkout/payment RPCs must preserve service-role execution paths and caller ownership/admin checks.
- Storage policy migrations must align with managed prefixes in `_shared/cleanup-orphan-storage.ts` and frontend upload paths.
- Index cleanup must follow `supabase/INDEX_REVIEW_DECISIONS.md`; advisor output alone is insufficient.
- `20260417174713_normalize_order_payment_shipment_schema.sql` is important historical context for the current order/payment/shipment read model and reconciliation functions.

## ANTI-PATTERNS

- **NEVER** drop RLS policies/grants without checking replacement access for admin app, mobile/customer app, cron, and service-role functions.
- **NEVER** hard-code generated UUIDs in data migrations unless they are stable business identifiers.
- **NEVER** expose webhook task, stock deduction, or idempotency internals to `anon`/`authenticated` roles.
- **NEVER** assume remote schema matches local migration metadata after a failed/partial deploy.
