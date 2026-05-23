# Supabase Backend

**Purpose:** Backend surface for database schema, RLS, cron jobs, runtime integration config, and Deno Edge Functions.

## STRUCTURE

```text
supabase/
├── config.toml             # Local Supabase CLI/runtime/function config
├── functions/              # Deno Edge Functions; see functions/AGENTS.md
├── migrations/             # Timestamped SQL history; see migrations/AGENTS.md
├── INDEX_REVIEW_DECISIONS.md
└── MIGRATION_HISTORY_RECONCILIATION.md
```

## LOCAL CONFIG FACTS

- Project id: `admin-panel`
- Local ports: API `54321`, DB `54322`, Studio `54323`, Inbucket `54324`, analytics `54327`, inspector `8083`
- DB major version: `17`
- Exposed schemas: `public`, `graphql_public`
- Edge Runtime: enabled, Deno `2`, `per_worker` policy
- Seed is enabled for `./seed.sql`, but `supabase/seed.sql` is currently absent.
- All configured Edge Functions currently set `verify_jwt = false`; handlers must self-validate.

## COMMANDS

Run from repo root unless noted.

```bash
npx supabase --version
npx supabase start
npx supabase stop
npx supabase functions serve --env-file ./supabase/.env.local
npx supabase migration list --linked
npx supabase db push --dry-run --include-all
npx supabase db lint --linked
```

Deploy Edge Functions with API bundling when Docker path resolution is unreliable:

```bash
npx supabase --workdir "/home/coder/dev/pharma/admin-panel" functions deploy <function-name> --project-ref <project-ref> --use-api
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Change function behavior | `functions/<name>/index.ts` or adjacent `handler.ts` | See `functions/AGENTS.md` |
| Reuse function code | `functions/_shared/` | See `_shared/AGENTS.md`; redeploy importers |
| Change runtime config | `functions/integration-config/`, `_shared/runtime-config.ts`, `migrations/*integration_config*.sql` | Versioned DB/Vault config and audit trail |
| Change schema/RLS/RPC/cron | `migrations/*.sql` | See `migrations/AGENTS.md` |
| Review index decisions | `INDEX_REVIEW_DECISIONS.md` | Do not blindly drop advisor-reported indexes |
| Repair migration history | `MIGRATION_HISTORY_RECONCILIATION.md` | Read before resolving remote/local drift |

## SECURITY RULES

- Keep service-role keys, DB passwords, Vault secrets, Midtrans Server Key, Biteship API key, Expo tokens, and provider secrets out of source.
- Never move server secrets into `VITE_*` frontend env vars.
- Use Dashboard secrets or `supabase secrets set --env-file <file>` for production secrets; use `supabase secrets list` to verify remote presence without printing values.
- Local function secrets may live in uncommitted env files passed via `--env-file`; do not commit them.
- Functions with `verify_jwt = false` must implement their own auth, signature, or service-role validation.
- Provider runtime secrets should resolve through database-backed runtime config and Vault references. The only approved provider env grace path is the source-guarded `BITESHIP_API_KEY` fallback in `_shared/biteship.ts`.
- Payment/webhook code must preserve idempotency and avoid duplicate stock/cart/shipping side effects.
- Policy and grant changes must explicitly verify intended roles (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`).

## VALIDATION EXPECTATIONS

- For SQL: inspect current schema/advisors, create a new migration, run dry-run/lint where credentials permit.
- For runtime config SQL: add/update migration tests for private tables, service-role-only RPCs, Vault access, masking, and audit behavior.
- For Edge Functions: run targeted Vitest tests under `supabase/functions/**/__tests__/`; deploy every affected importer if `_shared` changes.
- For cross-app contracts: also run repo-level `pnpm build` and `pnpm test`.

## GOTCHAS

- `db push` may require remote Postgres credentials even when linked.
- Cron migrations should guard unschedule/create behavior when jobs may not exist yet.
- Remote history has required reconciliation before; do not rewrite old migrations casually.
- `.temp/` is Supabase CLI state and should stay out of version control.
- Source-guard tests intentionally reject direct provider env reads and `Deno.env.toObject()` dumps in migrated runtime paths.
