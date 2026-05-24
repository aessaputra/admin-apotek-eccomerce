import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findBooleanValueKindMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_fix_integration_config_boolean_value_kind.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing integration config boolean value-kind migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8").toLowerCase();
};

describe("integration config boolean value-kind migration", () => {
  const migrationSql = findBooleanValueKindMigrationSql();

  it("repairs update_integration_config_value with a non-fallthrough boolean branch", () => {
    expect(migrationSql).toContain("create or replace function private.update_integration_config_value");
    expect(migrationSql).toContain("security definer");
    expect(migrationSql).toContain("set search_path = ''");
    expect(migrationSql).toContain("auth.role()) <> 'service_role'");
    expect(migrationSql).toContain("if v_key.value_kind = 'boolean' then");
    expect(migrationSql).toContain("pg_catalog.jsonb_typeof(p_value) <> 'boolean'");
    expect(migrationSql).toContain("config key % requires a boolean value");
    expect(migrationSql).toContain("elsif v_key.value_kind = 'text' then");
    expect(migrationSql).toContain("elsif v_key.value_kind = 'text_array' then");
    expect(migrationSql).toContain("unsupported config value kind: %");
  });

  it("does not preserve the old boolean validation fallthrough shape", () => {
    expect(migrationSql).not.toContain(
      "if v_key.value_kind = 'boolean' and pg_catalog.jsonb_typeof(p_value) <> 'boolean' then"
    );
  });
});
