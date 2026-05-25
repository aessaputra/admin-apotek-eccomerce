import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_validate_midtrans_orphan_notification_currency.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing Midtrans orphan notification currency migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

const extractFunctionSql = (sql: string) => {
  const match = sql.match(
    /create or replace function public\.reconcile_midtrans_orphan_notifications[\s\S]*?\$\$;/i,
  );

  if (!match) {
    throw new Error("Missing reconcile_midtrans_orphan_notifications function");
  }

  return normalizeSql(match[0]);
};

describe("Midtrans orphan notification currency guard migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);
  const functionSql = extractFunctionSql(migrationSql);

  it("rejects missing, non-IDR, and mismatched notification currency before transition", () => {
    expect(functionSql).toContain("v_notification_currency text");
    expect(functionSql).toContain("v_expected_currency text");
    expect(functionSql).toContain("raw_notification->>'currency'");
    expect(functionSql).toContain("coalesce(rec.expected_currency, 'idr')");
    expect(functionSql).toContain("v_notification_currency is null");
    expect(functionSql).toContain("v_notification_currency <> 'idr'");
    expect(functionSql).toContain("v_notification_currency <> v_expected_currency");

    const currencyGuardIndex = functionSql.indexOf("v_notification_currency is null");
    const transitionIndex = functionSql.indexOf(
      "public.apply_midtrans_webhook_transition",
    );

    expect(currencyGuardIndex).toBeGreaterThan(-1);
    expect(transitionIndex).toBeGreaterThan(currencyGuardIndex);
  });

  it("preserves service-role-only intent for the orphan reconciliation RPC", () => {
    expect(functionSql).toContain("security definer");
    expect(functionSql).toContain("set search_path = ''");
    expect(functionSql).toContain("auth.role()");
    expect(functionSql).toContain("service_role required");
    expect(normalizedSql).toContain(
      "revoke all on function public.reconcile_midtrans_orphan_notifications(integer) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.reconcile_midtrans_orphan_notifications(integer) to service_role",
    );
  });
});
