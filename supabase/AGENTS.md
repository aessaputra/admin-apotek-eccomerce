# AGENTS.md

## Overview

This `supabase/` subtree contains the backend surface for the pharmacy admin panel: Supabase CLI config, SQL migrations, and Edge Functions that integrate shipping, payment, and async webhook side effects.

The stack here is split across two execution environments:

- **Postgres migrations** in `supabase/migrations/*.sql`
- **Deno Edge Functions** in `supabase/functions/*`

When working in this directory, prefer small, explicit changes. Database and function changes often have production side effects.

## Structure

```text
supabase/
├── config.toml                 # Local Supabase CLI configuration
├── functions/
│   ├── _shared/                # Shared Deno utilities/types used by multiple functions
│   ├── ban-customer/
│   ├── biteship/               # Shipping tracking and Biteship integration
│   ├── cleanup-orphan-storage/
│   ├── create-snap-token/      # Midtrans Snap token creation
│   ├── midtrans-webhook/       # Payment webhook handling
│   ├── order-manager/          # Order state transitions
│   └── process-webhook-side-effects/
└── migrations/                 # Timestamped SQL migrations applied in order
```

## Where to Look

| Task | Location | Notes |
|---|---|---|
| Change shipping API behavior | `functions/biteship/index.ts` + `functions/_shared/biteship.ts` | Biteship integration logic is split between entrypoint and shared helpers |
| Change Midtrans webhook handling | `functions/midtrans-webhook/index.ts` + `functions/_shared/midtrans.ts` | Keep webhook idempotency and side effects in sync |
| Change async webhook follow-up processing | `functions/process-webhook-side-effects/index.ts` + `functions/_shared/webhook-side-effects.ts` | Paired with cron-driven DB function and task table |
| Change order transitions | `functions/order-manager/index.ts` | Used for order status management |
| Change orphaned storage cleanup logic | `functions/cleanup-orphan-storage/index.ts` | Used for storage cleanup and reconciliation flows |
| Add shared Deno helper or types | `functions/_shared/` | Prefer shared modules over duplicating code across functions |
| Add or change schema | `migrations/*.sql` | Use a new timestamped migration; do not edit applied history casually |
| Change local Supabase runtime config | `config.toml` | Local ports, DB version, seed behavior, API schemas |

## Development Commands

Run from the repository root unless noted.

```bash
# Check Supabase CLI
npx supabase --version

# Start local Supabase stack
npx supabase start

# Stop local Supabase stack
npx supabase stop

# Serve Edge Functions locally
npx supabase functions serve --env-file ./supabase/.env.local

# List migration history for the linked project
npx supabase migration list --linked

# Preview pending migrations
npx supabase db push --dry-run --linked --include-all
```

## Edge Function Workflow

- Each function lives in its own directory with `index.ts` as the entrypoint.
- Shared code belongs in `functions/_shared/` when used by more than one function.
- Keep secrets out of source. Functions should read runtime secrets from Supabase secrets or server environment, never from client files.
- Preserve existing separation between request parsing, provider integration, and shared helper logic.

### Deploying Functions

Use the repository root as the Supabase workdir.

```bash
npx supabase --workdir "/home/coder/dev/pharma/admin-panel" functions deploy <function-name> --project-ref <project-ref> --use-api
```

In this environment, `--use-api` is safer than Docker bundling because Docker-based bundling may fail to resolve the local repo path even when the function files exist.

If a shared helper changes, redeploy every function that imports it, not just one function.

## Migration Workflow

- Migration filenames are timestamp-prefixed and ordered lexicographically.
- Create a **new** migration for schema changes. Do not rewrite old migration files unless you are intentionally repairing local history and understand the impact.
- Prefer idempotent SQL where practical: `if exists`, `if not exists`, guarded `drop`, and explicit comments.
- Validate assumptions against the current remote schema before pushing, especially for policies, constraints, and cron jobs.

### Migration Commands

```bash
# Create a new migration
npx supabase migration new <descriptive_name>

# Check linked migration history
npx supabase migration list --linked

# Preview migrations before applying
npx supabase db push --dry-run --include-all

# Apply pending migrations to the linked project
npx supabase db push --include-all
```

### Migration Gotchas

- `db push` may require remote Postgres credentials even when the project is linked.
- If CLI push is blocked by missing DB password or diverged history, use Supabase automation carefully to inspect schema state first, then repair history deliberately.
- Cron-related migrations should guard unschedule behavior when the target job may not exist yet.
- Policy-heavy migrations can fail if remote schema already contains partially applied policy names; inspect `pg_policies` before retrying blindly.

## Local Config Notes

Key defaults from `config.toml`:

- API port: `54321`
- DB port: `54322`
- Studio port: `54323`
- Inbucket port: `54324`
- DB major version: `17`
- Seed enabled: `true`
- Exposed API schemas: `public`, `graphql_public`

Keep `.temp/` out of version control. The `.gitignore` entry is `.temp`, and it is CLI state, not source.

## Security Rules

- Never commit service-role keys, DB passwords, or Vault secrets.
- Never move secrets into frontend env vars such as `VITE_*`.
- Treat webhook and payment code as sensitive paths: preserve idempotency and avoid duplicate side effects.
- When changing SQL policies, verify the intended roles (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`, etc.) explicitly.

## Validation Expectations

After changing files under `supabase/`:

- Re-read the changed SQL or function entrypoints for correctness.
- For migrations, run at least `npx supabase migration list --linked` and `npx supabase db push --dry-run --include-all` when relevant.
- For Edge Functions, deploy or serve/test the affected functions if the task includes operational rollout.
- If function code changes also affect the TypeScript frontend or shared app contracts, run the repo-level validation command:

```bash
pnpm build
```

## Project-Specific Notes

- `midtrans-webhook`, `order-manager`, and `process-webhook-side-effects` are logically connected. Changes in one often require checking the others.
- The project already uses cron-based database jobs for order expiration and webhook side-effect processing.
- Recent migration history in this project required explicit repair to realign remote history with local files. Be cautious when the remote schema appears newer than local migration metadata.
