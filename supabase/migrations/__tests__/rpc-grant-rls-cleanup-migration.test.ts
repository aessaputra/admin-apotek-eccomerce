import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationSuffix = "_harden_public_rpc_grants_and_snap_lock_rls.sql";

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(migrationSuffix))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(`Missing migration with suffix ${migrationSuffix}`);
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("RPC grant and snap lock RLS cleanup migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("keeps intended authenticated RPC execution while removing unintended anon grants", () => {
    expect(normalizedSql).toContain(
      "claim_profile_push_token intentionally remains authenticated security definer"
    );
    expect(normalizedSql).toContain("accepted supabase advisor exception");
    expect(normalizedSql).toContain(
      "revoke all on function public.claim_profile_push_token(text, text, text, timestamptz) from public, anon, service_role"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated"
    );
    expect(normalizedSql).toContain(
      "revoke all on function public.admin_operational_metrics(text, date, date) from public, anon, service_role"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.admin_operational_metrics(text, date, date) to authenticated"
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to anon"
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.admin_operational_metrics(text, date, date) to anon"
    );
  });

  it("keeps internal cron and cleanup RPCs service-role only", () => {
    expect(normalizedSql).toContain(
      "revoke all on function public.cancel_expired_orders() from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.cancel_expired_orders() to service_role"
    );
    expect(normalizedSql).toContain(
      "revoke all on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) to service_role"
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.cancel_expired_orders() to anon"
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.cancel_expired_orders() to authenticated"
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) to anon"
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.list_cleanup_storage_objects(text, timestamptz, integer, integer) to authenticated"
    );
  });

  it("enables RLS and denies direct browser access to snap token locks", () => {
    expect(normalizedSql).toContain(
      "alter table public.snap_token_generation_locks enable row level security"
    );
    expect(normalizedSql).toContain(
      "drop policy if exists snap_token_generation_locks_deny_browser_access on public.snap_token_generation_locks"
    );
    expect(normalizedSql).toContain(
      "create policy snap_token_generation_locks_deny_browser_access on public.snap_token_generation_locks as restrictive for all to anon, authenticated using (false) with check (false)"
    );
    expect(normalizedSql).not.toContain(
      "revoke all on table public.snap_token_generation_locks from service_role"
    );
  });
});
