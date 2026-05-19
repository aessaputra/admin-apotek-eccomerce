import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const findRolloutMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_integration_config_rollout_backfill.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing integration config rollout backfill migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("integration config rollout migration", () => {
  const migrationSql = findRolloutMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("documents placeholder-only operator secret loading guidance", () => {
    expect(normalizedSql).toContain("your_midtrans_server_key_placeholder");
    expect(normalizedSql).toContain("your_biteship_api_key_placeholder");
    expect(normalizedSql).toContain("supabase secrets set --env-file");
    expect(normalizedSql).toContain("vault.create_secret");
    expect(normalizedSql).not.toMatch(/midtrans_(server|client)_key\s*=\s*['\"][^'\"]+/);
    expect(normalizedSql).not.toMatch(/biteship_(api_)?key\s*=\s*['\"][^'\"]+/);
  });

  it("creates service-role-only rollout status tracking without plaintext secret columns", () => {
    expect(normalizedSql).toContain(
      "create table if not exists private.integration_config_rollout_status",
    );
    expect(normalizedSql).toContain("provider text not null");
    expect(normalizedSql).toContain("target_type text not null");
    expect(normalizedSql).toContain("status text not null");
    expect(normalizedSql).toContain("safe_metadata jsonb not null default '{}'::jsonb");
    expect(normalizedSql).toContain(
      "constraint integration_config_rollout_status_state_check",
    );
    expect(normalizedSql).toContain(
      "revoke all on table private.integration_config_rollout_status from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant select, insert, update on table private.integration_config_rollout_status to service_role",
    );
    expect(normalizedSql).not.toMatch(/(secret_value|plaintext|decrypted_secret|api_key|server_key|access_token)\s+(text|varchar|jsonb)/);
  });

  it("binds legacy pending Midtrans payments or records retryable status when active config is unavailable", () => {
    expect(normalizedSql).toContain("legacy_midtrans_candidates");
    expect(normalizedSql).toContain("from public.payments as p");
    expect(normalizedSql).toContain("where p.midtrans_order_id is not null");
    expect(normalizedSql).toContain("p.status in ('pending'::public.payment_status, 'authorize'::public.payment_status)");
    expect(normalizedSql).toContain("binding_source");
    expect(normalizedSql).toContain("'legacy_rollout_backfill'");
    expect(normalizedSql).toContain("'retryable_missing_midtrans_config'");
    expect(normalizedSql).toContain("left join private.midtrans_payment_config_bindings as existing_binding");
    expect(normalizedSql).not.toContain("vault.decrypted_secrets");
  });

  it("backfills Biteship snapshots where current non-secret config is complete and marks retryable gaps", () => {
    expect(normalizedSql).toContain("legacy_biteship_candidates");
    expect(normalizedSql).toContain("insert into private.order_integration_config_snapshots");
    expect(normalizedSql).toContain("'legacy_rollout_backfill'");
    expect(normalizedSql).toContain("'retryable_missing_biteship_snapshot_inputs'");
    expect(normalizedSql).toContain("'biteship.origin_postal_code'");
    expect(normalizedSql).toContain("'biteship.origin_area_id'");
    expect(normalizedSql).toContain("'biteship.origin_latitude'");
    expect(normalizedSql).toContain("'biteship.origin_longitude'");
    expect(normalizedSql).toContain("'shop.organization'");
    expect(normalizedSql).not.toContain("biteship.api_key");
    expect(normalizedSql).not.toContain("vault.decrypted_secrets");
  });
});
