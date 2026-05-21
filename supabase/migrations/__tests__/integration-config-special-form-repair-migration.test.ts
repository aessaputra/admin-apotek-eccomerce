import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findRepairMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_fix_runtime_config_version_lookup.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing runtime config special-form repair migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8").toLowerCase();
};

describe("integration config special-form repair migration", () => {
  const migrationSql = findRepairMigrationSql();

  it("repairs every integration RPC flagged by remote DB lint", () => {
    expect(migrationSql).toContain("private.mask_integration_config_secret(text)");
    expect(migrationSql).toContain("private.rotate_integration_config_secret(text, text, uuid, text, text, text)");
    expect(migrationSql).toContain("private.update_integration_config_value(text, jsonb, uuid, text, text, text)");
    expect(migrationSql).toContain("private.list_integration_config_audit(text, integer)");
    expect(migrationSql).toContain("private.bind_midtrans_payment_config_versions(uuid, text, text, uuid, uuid, integer, uuid, integer, boolean)");
    expect(migrationSql).toContain("private.create_biteship_order_config_snapshot(uuid, uuid, text, text, numeric, numeric, text[], text, text, text, text, text, text, jsonb, text, uuid)");
    expect(migrationSql).toContain("private.persist_midtrans_payment_session(uuid, uuid, text, text, public.payment_status, public.payment_type, numeric, timestamp with time zone, text, text, timestamp with time zone, text, uuid, uuid, integer, uuid, integer, boolean)");
  });

  it("does not introduce schema-qualified SQL special forms in static SQL", () => {
    expect(migrationSql).not.toContain("pg_catalog.coalesce(");
    expect(migrationSql).not.toContain("pg_catalog.nullif(");
  });
});
