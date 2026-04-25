import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260424190434_snapshot_order_item_sku_in_checkout.sql",
);

const skuProtectionMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260424213041_protect_sku_columns_with_admin_views.sql",
);

const adminViewPrivilegeMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260424214122_restrict_admin_view_privileges.sql",
);

const hardenedCheckoutRpcMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260425064111_harden_sku_checkout_rpc.sql",
);

const securityInvokerAdminViewsMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260425065008_make_admin_sku_views_security_invoker.sql",
);

function readMigrationSql() {
  return readFileSync(migrationPath, "utf8");
}

function readSkuProtectionMigrationSql() {
  return readFileSync(skuProtectionMigrationPath, "utf8");
}

function readAdminViewPrivilegeMigrationSql() {
  return readFileSync(adminViewPrivilegeMigrationPath, "utf8");
}

function readHardenedCheckoutRpcMigrationSql() {
  return readFileSync(hardenedCheckoutRpcMigrationPath, "utf8");
}

function readSecurityInvokerAdminViewsMigrationSql() {
  return readFileSync(securityInvokerAdminViewsMigrationPath, "utf8");
}

describe("checkout order aggregate SQL", () => {
  it("snapshots the current product SKU into each order item", () => {
    const sql = readMigrationSql();

    expect(sql).toContain("p.sku as product_sku");
    expect(sql).toContain("'product_sku_at_purchase', v_line.product_sku");
    expect(sql).toContain("product_sku_at_purchase");
  });

  it("keeps product_id as the relational key and stores SKU as a text snapshot", () => {
    const sql = readMigrationSql();

    expect(sql).toContain("join public.products p on p.id = ci.product_id");
    expect(sql).toContain("product_id uuid");
    expect(sql).toContain("product_sku_at_purchase text");
  });

  it("does not update historical order item SKU snapshots after insert", () => {
    const sql = readMigrationSql().toLowerCase();

    expect(sql).not.toMatch(/update\s+public\.order_items[\s\S]*product_sku_at_purchase/);
    expect(sql).not.toMatch(/update\s+public\.products[\s\S]*product_sku_at_purchase/);
  });

  it("hardens checkout as a definer function while preserving SKU snapshots", () => {
    const sql = readHardenedCheckoutRpcMigrationSql();
    const normalizedSql = sql.toLowerCase();

    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(sql).toContain("p.sku as product_sku");
    expect(sql).toContain("'product_sku_at_purchase', v_line.product_sku");
    expect(normalizedSql).toContain("product_sku_at_purchase");
    expect(sql).toContain(
      "(select auth.role()) = 'service_role'",
    );
    expect(sql).toContain("or (select private.is_admin())");
    expect(sql).toContain("or p_user_id = (select auth.uid())");
  });

  it("keeps checkout RPC private to the server-side service role", () => {
    const normalizedSql = readHardenedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("revoke all on function public.create_checkout_order_aggregate");
    expect(normalizedSql).toContain("from public, anon, authenticated");
    expect(normalizedSql).toContain("grant execute on function public.create_checkout_order_aggregate");
    expect(normalizedSql).toContain("to service_role");
  });

  it("adds admin-only SKU read views and grants them only to authenticated users", () => {
    const normalizedSql = readSkuProtectionMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("create or replace view public.admin_products");
    expect(normalizedSql).toContain("create or replace view public.admin_order_items");
    expect(normalizedSql).toContain("with (security_barrier = true)");
    expect(normalizedSql).toContain("where (select private.is_admin())");
    expect(normalizedSql).toContain("grant select on table public.admin_products to authenticated");
    expect(normalizedSql).toContain("grant select on table public.admin_order_items to authenticated");
    expect(normalizedSql).not.toContain("grant select on table public.admin_products to anon");
    expect(normalizedSql).not.toContain("grant select on table public.admin_order_items to anon");
  });

  it("removes customer SKU column access without broad product SELECT grants", () => {
    const normalizedSql = readSkuProtectionMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("revoke select (sku) on table public.products from anon, authenticated");
    expect(normalizedSql).toContain(
      "revoke select (product_sku_at_purchase) on table public.order_items from anon, authenticated",
    );
    expect(normalizedSql).not.toMatch(/grant\s+select\s+on\s+(?:table\s+)?public\.products\s+to\s+(?:anon|authenticated)/);
    expect(normalizedSql).not.toMatch(/grant\s+select\s+on\s+(?:table\s+)?public\.order_items\s+to\s+(?:anon|authenticated)/);
  });

  it("restricts admin SKU views to authenticated SELECT only", () => {
    const normalizedSql = readAdminViewPrivilegeMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("revoke all on table public.admin_products from authenticated");
    expect(normalizedSql).toContain("grant select on table public.admin_products to authenticated");
    expect(normalizedSql).toContain("revoke all on table public.admin_order_items from authenticated");
    expect(normalizedSql).toContain("grant select on table public.admin_order_items to authenticated");
    expect(normalizedSql).toContain("revoke all on table public.admin_products from public, anon");
    expect(normalizedSql).toContain("revoke all on table public.admin_order_items from public, anon");
    expect(normalizedSql).not.toMatch(/grant\s+(?:insert|update|delete|truncate|references|trigger|all)\s+on\s+table\s+public\.admin_(?:products|order_items)\s+to\s+authenticated/);
  });

  it("moves admin SKU views to security-invoker wrappers over private gated functions", () => {
    const normalizedSql = readSecurityInvokerAdminViewsMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("create or replace function private.admin_products_for_current_user");
    expect(normalizedSql).toContain("create or replace function private.admin_order_items_for_current_user");
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain("where (select private.is_admin())");
    expect(normalizedSql).toContain("create or replace view public.admin_products");
    expect(normalizedSql).toContain("create or replace view public.admin_order_items");
    expect(normalizedSql).toContain("with (security_invoker = true, security_barrier = true)");
    expect(normalizedSql).toContain("from private.admin_products_for_current_user()");
    expect(normalizedSql).toContain("from private.admin_order_items_for_current_user()");
    expect(normalizedSql).toContain("price::numeric(12,2) as price");
    expect(normalizedSql).toContain("price_at_purchase::numeric(12,2) as price_at_purchase");
  });
});
