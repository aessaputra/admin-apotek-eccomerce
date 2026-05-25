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

  it("keeps orphan reconciliation as a guarded safe no-op", () => {
    expect(functionSql).toContain("security definer");
    expect(functionSql).toContain("set search_path = ''");
    expect(functionSql).toContain("auth.role()");
    expect(functionSql).toContain("service_role required");
    expect(functionSql).toContain("v_processed integer := 0");
    expect(functionSql).toContain("return v_processed");
    expect(functionSql).not.toContain("join public.payments canonical_payment");
    expect(functionSql).not.toContain(
      "canonical_payment.midtrans_order_id = orphan_payment.midtrans_order_id",
    );
    expect(functionSql).not.toContain("public.apply_midtrans_webhook_transition");
  });

  it("rejects legacy order payment columns in the active reconciliation function", () => {
    const legacyOrderJoin = "join public.orders o on " +
      ["o", "midtrans_order_id"].join(".") +
      " = " +
      ["orphan_payment", "midtrans_order_id"].join(".");
    const legacyOrderMidtransColumn = ["orders", "midtrans_order_id"].join(".");
    const legacyOrderAliasMidtransColumn = ["o", "midtrans_order_id"].join(".");

    expect(functionSql).not.toContain(legacyOrderJoin);
    expect(functionSql).not.toContain(legacyOrderMidtransColumn);
    expect(functionSql).not.toContain(legacyOrderAliasMidtransColumn);
  });

  it("documents why true orphan notifications cannot be reconciled here", () => {
    expect(normalizedSql).toContain(
      "true orphan payments cannot be mapped to an order from midtrans_order_id after legacy orders.midtrans_order_id was dropped",
    );
    expect(normalizedSql).toContain(
      "attachment must happen in order/session persistence paths",
    );
  });

  it("preserves service-role-only grants for the orphan reconciliation RPC", () => {
    expect(normalizedSql).toContain(
      "revoke all on function public.reconcile_midtrans_orphan_notifications(integer) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.reconcile_midtrans_orphan_notifications(integer) to service_role",
    );
  });
});
