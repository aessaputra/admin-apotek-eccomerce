import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

function findMigrationSql() {
  const migrationFile = readdirSync(migrationsDir)
    .filter(fileName => fileName.endsWith("_fix_order_backend_lint_contracts.sql"))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing fix_order_backend_lint_contracts migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
}

describe("order backend lint contracts migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("fixes cancel_expired_orders without reusing statement-local CTEs", () => {
    expect(normalizedSql).toContain("create or replace function public.cancel_expired_orders()");
    expect(normalizedSql).toContain("updated_orders as (");
    expect(normalizedSql).toContain("updated_payments as (");
    expect(normalizedSql).toContain("where p.order_id in (select id from updated_orders)");
    expect(normalizedSql).not.toContain("where order_id in (select id from expired_orders)");
  });

  it("keeps selected checkout RPC private and avoids invalid qualified coalesce", () => {
    expect(normalizedSql).toContain("create or replace function public.create_checkout_order_aggregate");
    expect(normalizedSql).toContain(
      "coalesce(pg_catalog.array_length(p_selected_cart_item_ids, 1), 0::integer) = 0",
    );
    expect(normalizedSql).not.toContain("pg_catalog.coalesce");
    expect(normalizedSql).toMatch(/grant execute on function public\.create_checkout_order_aggregate[\s\S]*to service_role/);
  });

  it("documents retained Midtrans webhook signature placeholders", () => {
    expect(normalizedSql).toContain("p_biteship_order_id text default null");
    expect(normalizedSql).toContain("p_waybill_number text default null");
    expect(normalizedSql).toContain("perform p_biteship_order_id, p_waybill_number");
    expect(normalizedSql).toContain("legacy signature placeholders retained for deployed rpc compatibility");
  });

  it("restores explicit order read-model contract columns", () => {
    expect(normalizedSql).toContain("create or replace view public.order_read_model");
    expect(normalizedSql).toContain("with (security_invoker = true)");
    expect(normalizedSql).not.toContain("base_order_projection.*");
    expect(normalizedSql).toContain("customer_order_bucket");
    expect(normalizedSql).toContain("o.customer_completed_by");
    expect(normalizedSql).toContain("o.customer_completion_source");
    expect(normalizedSql).toContain("when o.status = 'cancelled' then 'cancelled'::text");
  });
});
