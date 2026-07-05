import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260705094931_add_stock_restoration_on_cancel.sql",
  ),
  "utf8",
);

const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

describe("stock restoration on cancel migration", () => {
  it("creates the reverse_order_item_stock_deduction function as security definer", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.reverse_order_item_stock_deduction(",
    );
    expect(normalizedSql).toContain("p_order_id uuid");
    expect(normalizedSql).toContain("p_product_id uuid");
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = public");
  });

  it("uses idempotent delete-returning pattern for stock restoration", () => {
    expect(normalizedSql).toContain(
      "delete from public.order_item_stock_deductions",
    );
    expect(normalizedSql).toContain("returning quantity into v_quantity");
    expect(normalizedSql).toContain("stock = stock + v_quantity");
  });

  it("restricts execution to service_role only", () => {
    expect(normalizedSql).toContain(
      "revoke all on function public.reverse_order_item_stock_deduction(uuid, uuid) from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant execute on function public.reverse_order_item_stock_deduction(uuid, uuid) to service_role",
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.reverse_order_item_stock_deduction(uuid, uuid) to anon",
    );
    expect(normalizedSql).not.toContain(
      "grant execute on function public.reverse_order_item_stock_deduction(uuid, uuid) to authenticated",
    );
  });

  it("wraps all changes in a transaction", () => {
    expect(normalizedSql).toMatch(/^begin;/);
    expect(normalizedSql).toMatch(/commit;\s*$/);
  });
});
