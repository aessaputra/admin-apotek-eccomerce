import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

describe("Expired products auto-deactivation and pg_cron migration", () => {
  it("enables pg_cron extension in timestamped migration with extensions schema", () => {
    const sql = readFileSync(
      join(migrationsDir, "20260810130000_enable_pg_cron_extension.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("create extension if not exists pg_cron with schema extensions");
    expect(sql).toContain("grant usage on schema cron to postgres");
  });

  it("defines auto_deactivate_expired_products function and daily cron schedule", () => {
    const sql = readFileSync(
      join(migrationsDir, "20260809200000_add_expired_products_schema_and_cron.sql"),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("create or replace function public.auto_deactivate_expired_products()");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("cron.schedule(");
    expect(sql).toContain("'auto-deactivate-expired-products-daily'");
  });
});
