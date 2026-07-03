import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_harden_public_views_and_push_token_rpc.sql"),
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing harden_public_views_and_push_token_rpc migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("harden public views and push-token RPC migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("sets security_invoker on the six public read-model/reporting views", () => {
    for (const viewName of [
      "public.order_read_model",
      "public.admin_monthly_operational_metrics",
      "public.report_customer_sales",
      "public.report_daily_sales",
      "public.report_product_sales",
      "public.report_sold_products",
    ]) {
      expect(normalizedSql).toContain(`alter view ${viewName} set (security_invoker = true)`);
    }
  });

  it("documents every hardened view", () => {
    for (const viewName of [
      "public.order_read_model",
      "public.admin_monthly_operational_metrics",
      "public.report_customer_sales",
      "public.report_daily_sales",
      "public.report_product_sales",
      "public.report_sold_products",
    ]) {
      expect(normalizedSql).toContain(`comment on view ${viewName} is`);
      expect(normalizedSql).toContain(`security_invoker`);
    }
  });

  it("moves privileged push-token logic to a private SECURITY DEFINER core", () => {
    expect(normalizedSql).toContain(
      "create or replace function private.claim_profile_push_token_core(",
    );
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path to ''");
    expect(normalizedSql).toContain(
      "pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_expo_push_token, 0))",
    );
  });

  it("exposes a public SECURITY INVOKER wrapper for claim_profile_push_token", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.claim_profile_push_token(",
    );
    expect(normalizedSql).toContain("security invoker");
    expect(normalizedSql).toContain(
      "return private.claim_profile_push_token_core(",
    );
  });

  it("keeps input validation in the public wrapper", () => {
    expect(normalizedSql).toContain("authentication required.");
    expect(normalizedSql).toContain("device_id is required.");
    expect(normalizedSql).toContain("expo_push_token is required.");
    expect(normalizedSql).toContain("platform is required.");
    expect(normalizedSql).toContain(
      "expo_push_token must use expopushtoken[...] or exponentpushtoken[...] format.",
    );
  });

  it("locks down grants on the public wrapper and private core", () => {
    expect(normalizedSql).toContain(
      "revoke all on function public.claim_profile_push_token(text, text, text, timestamp with time zone) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.claim_profile_push_token(text, text, text, timestamp with time zone) to authenticated",
    );
    expect(normalizedSql).toContain(
      "revoke all on function private.claim_profile_push_token_core(uuid, text, text, text, timestamp with time zone) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function private.claim_profile_push_token_core(uuid, text, text, text, timestamp with time zone) to authenticated",
    );
  });
});
