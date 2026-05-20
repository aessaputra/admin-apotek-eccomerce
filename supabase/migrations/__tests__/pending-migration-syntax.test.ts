import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const pendingMigrationFiles = [
  "20260519115350_integration_config_rollout_backfill.sql",
  "20260519184030_harden_integration_config_review_findings.sql",
];

describe("pending migration SQL syntax", () => {
  it.each(pendingMigrationFiles)(
    "does not schema-qualify NULLIF in %s",
    (migrationFile) => {
      const migrationSql = readFileSync(
        join(migrationsDir, migrationFile),
        "utf8",
      ).toLowerCase();

      expect(migrationSql).not.toContain("pg_catalog.nullif");
    },
  );
});
