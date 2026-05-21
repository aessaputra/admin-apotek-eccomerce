import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findTimestamptzReturnMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_fix_integration_config_timestamptz_returns.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing integration config timestamptz return migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8").toLowerCase();
};

describe("integration config timestamptz return migration", () => {
  const migrationSql = findTimestamptzReturnMigrationSql();

  it("repairs timestamp return expressions flagged by DB lint", () => {
    expect(migrationSql).toContain("private.rotate_integration_config_secret(text, text, uuid, text, text, text)");
    expect(migrationSql).toContain("private.update_integration_config_value(text, jsonb, uuid, text, text, text)");
    expect(migrationSql).toContain("pg_catalog.now()");
  });

  it("does not keep the timestamp-without-time-zone return expression in static SQL", () => {
    expect(migrationSql).not.toContain("pg_catalog.timezone('utc'::text, pg_catalog.now())");
  });
});
