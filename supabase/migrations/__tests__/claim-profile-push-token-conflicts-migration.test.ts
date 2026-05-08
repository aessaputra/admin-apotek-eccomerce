import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_claim_profile_push_token_conflicts.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing claim profile push token conflicts migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("claim profile push token conflicts migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("claims active Expo tokens through a security definer RPC", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.claim_profile_push_token"
    );
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain("v_user_id uuid := auth.uid()");
    expect(normalizedSql).toContain(
      "perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_expo_push_token, 0))"
    );
    expect(normalizedSql).toContain(
      "where expo_push_token = v_expo_push_token and revoked_at is null and (user_id <> v_user_id or device_id <> v_device_id)"
    );
    expect(normalizedSql).toContain("on conflict (user_id, device_id)");
    expect(normalizedSql).toContain(
      "grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated"
    );
  });
});
