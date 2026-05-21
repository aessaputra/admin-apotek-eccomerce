import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const requiredConfigKeys = [
  "biteship.enabled_couriers",
  "biteship.origin_postal_code",
  "biteship.origin_area_id",
  "biteship.origin_latitude",
  "biteship.origin_longitude",
  "shop.shipper_name",
  "shop.shipper_phone",
  "shop.shipper_email",
  "shop.address",
  "shop.organization",
];

const findBackfillMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_backfill_biteship_runtime_config_from_settings.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing Biteship runtime config settings backfill migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("Biteship runtime config settings backfill migration", () => {
  const migrationSql = findBackfillMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("backfills active current non-secret config versions for every required Biteship and shop key from settings", () => {
    expect(normalizedSql).toContain("from public.settings");
    expect(normalizedSql).toContain("where id = 1");
    expect(normalizedSql).toContain("insert into private.integration_config_versions");
    expect(normalizedSql).toContain("insert into private.integration_config_current_versions");
    expect(normalizedSql).toContain("status");
    expect(normalizedSql).toContain("'active'");
    expect(normalizedSql).toContain("created_source");
    expect(normalizedSql).toContain("'settings_backfill'");

    for (const keyName of requiredConfigKeys) {
      expect(normalizedSql).toContain(`'${keyName}'`);
    }
  });

  it("normalizes settings values into valid non-secret JSON values before insertion", () => {
    expect(normalizedSql).toContain("nullif(btrim(");
    expect(normalizedSql).toContain("jsonb_build_array");
    expect(normalizedSql).toContain("regexp_split_to_table");
    expect(normalizedSql).toContain("jsonb_agg");
    expect(normalizedSql).toContain("to_jsonb(");
    expect(normalizedSql).toContain("origin_postal_code ~ '^[1-9][0-9]{4}$'");
    expect(normalizedSql).toContain("origin_latitude between -90 and 90");
    expect(normalizedSql).toContain("origin_longitude between -180 and 180");
    expect(normalizedSql).toContain("shipper_email ~*");
  });

  it("does not insert or reference plaintext Biteship secrets", () => {
    expect(normalizedSql).not.toContain("biteship.api_key");
    expect(normalizedSql).not.toContain("biteship_api_key");
    expect(normalizedSql).not.toContain("vault.decrypted_secrets");
    expect(normalizedSql).not.toContain("vault.create_secret");
    expect(normalizedSql).not.toMatch(/biteship_(live|test)\.[a-z0-9_\-]+/);
    expect(normalizedSql).not.toMatch(/(secret_value|plaintext|decrypted_secret|api_key)\s+(text|varchar|jsonb)/);
  });

  it("is guarded and does not overwrite existing current versions", () => {
    expect(normalizedSql).toContain("left join private.integration_config_current_versions");
    expect(normalizedSql).toContain("current_versions.key_name is null");
    expect(normalizedSql).toContain("coalesce(max(existing_versions.version_number), 0) + 1");
    expect(normalizedSql).toContain("on conflict (key_name, version_number) do nothing");
    expect(normalizedSql).toContain("on conflict (key_name) do nothing");
    expect(normalizedSql).not.toContain("do update");
  });

  it("uses existing private config tables and safe audit metadata without changing RLS or grants", () => {
    expect(normalizedSql).toContain("private.integration_config_keys");
    expect(normalizedSql).toContain("private.integration_config_versions");
    expect(normalizedSql).toContain("private.integration_config_current_versions");
    expect(normalizedSql).toContain("private.integration_config_audit_logs");
    expect(normalizedSql).toContain("'value_updated'");
    expect(normalizedSql).toContain("'settings_backfill'");
    expect(normalizedSql).toContain("jsonb_build_object");
    expect(normalizedSql).not.toContain("alter table");
    expect(normalizedSql).not.toContain("grant ");
    expect(normalizedSql).not.toContain("revoke ");
    expect(normalizedSql).not.toContain("create policy");
    expect(normalizedSql).not.toContain("drop policy");
  });
});
