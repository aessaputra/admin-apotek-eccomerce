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

const selectedCheckoutRpcMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260430042418_selected_cart_checkout_rpc.sql",
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

function readSelectedCheckoutRpcMigrationSql() {
  return readFileSync(selectedCheckoutRpcMigrationPath, "utf8");
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

  it("replaces checkout RPC with the selected cart item signature", () => {
    const sql = readSelectedCheckoutRpcMigrationSql();
    const normalizedSql = sql.toLowerCase();

    expect(normalizedSql).toContain("drop function if exists public.create_checkout_order_aggregate");
    expect(normalizedSql).toContain("p_selected_cart_item_ids uuid[]");
    expect(normalizedSql).toMatch(
      /create or replace function public\.create_checkout_order_aggregate\([\s\S]*p_shipping_etd text,[\s\S]*p_selected_cart_item_ids uuid\[\],[\s\S]*p_checkout_idempotency_key text/,
    );
    expect(normalizedSql).toMatch(
      /comment on function public\.create_checkout_order_aggregate\([\s\S]*uuid\[\],[\s\S]*text[\s\S]*\) is/,
    );
  });

  it("validates selected cart item IDs before creating a new checkout aggregate", () => {
    const normalizedSql = readSelectedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("p_selected_cart_item_ids is null");
    expect(normalizedSql).toContain("array_length(p_selected_cart_item_ids, 1)");
    expect(normalizedSql).toContain("array_position(p_selected_cart_item_ids, null)");
    expect(normalizedSql).toContain("count(distinct selected.selected_id)");
    expect(normalizedSql).toContain("v_selected_count <> v_distinct_selected_count");
    expect(normalizedSql).toContain("v_selected_row_count <> v_selected_count");
    expect(normalizedSql).toContain("pilih minimal satu produk sebelum melanjutkan pembayaran");
    expect(normalizedSql).toContain("produk terpilih tidak valid");
  });

  it("locks and aggregates only selected cart rows in deterministic order", () => {
    const normalizedSql = readSelectedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("ci.id = any(p_selected_cart_item_ids)");
    expect(normalizedSql).toMatch(
      /from public\.cart_items ci\s+join public\.products p on p\.id = ci\.product_id\s+where ci\.cart_id = v_cart_id\s+and ci\.id = any\(p_selected_cart_item_ids\)\s+order by ci\.id asc\s+for update of ci, p/,
    );
    expect(normalizedSql).not.toMatch(
      /from public\.cart_items ci\s+join public\.products p on p\.id = ci\.product_id\s+where ci\.cart_id = v_cart_id\s+order by/,
    );
  });

  it("uses the selected-only aggregate for subtotal, item count, and payment gross amount", () => {
    const normalizedSql = readSelectedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("v_total_amount := v_total_amount + (v_line.price * v_line.quantity)");
    expect(normalizedSql).toContain("v_item_count := v_item_count + v_line.quantity");
    expect(normalizedSql).toMatch(/insert into public\.orders \([\s\S]*total_amount,[\s\S]*\)\s+values \([\s\S]*v_total_amount,/);
    expect(normalizedSql).toMatch(/insert into public\.payments \([\s\S]*gross_amount,[\s\S]*\)\s+values \([\s\S]*v_total_amount \+ p_shipping_price,/);
    expect(normalizedSql).toMatch(/return query[\s\S]*select[\s\S]*v_total_amount,[\s\S]*v_item_count,[\s\S]*p_checkout_idempotency_key/);
    expect(normalizedSql).not.toMatch(/select[\s\S]*sum\(ci\.quantity \* p\.price\)[\s\S]*from public\.cart_items ci/);
  });

  it("builds order_items only from the selected cart snapshot and never from the full cart", () => {
    const normalizedSql = readSelectedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("v_cart_snapshot := v_cart_snapshot || pg_catalog.jsonb_build_array");
    expect(normalizedSql).toContain("'source_cart_item_id', v_line.source_cart_item_id");
    expect(normalizedSql).toMatch(/insert into public\.order_items \([\s\S]*source_cart_item_id[\s\S]*\)\s+select[\s\S]*from pg_catalog\.jsonb_to_recordset\(v_cart_snapshot\)/);
    expect(normalizedSql).not.toMatch(/insert into public\.order_items[\s\S]*from public\.cart_items ci/);
  });

  it("rejects invalid selected rows while allowing invalid unselected cart rows to remain outside the aggregate", () => {
    const normalizedSql = readSelectedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toMatch(/select pg_catalog\.count\(\*\)::integer[\s\S]*from public\.cart_items ci[\s\S]*where ci\.cart_id = v_cart_id[\s\S]*and ci\.id = any\(p_selected_cart_item_ids\)/);
    expect(normalizedSql).toContain("if v_selected_row_count <> v_selected_count then");
    expect(normalizedSql).toContain("raise exception 'produk terpilih tidak valid. silakan perbarui pilihan checkout.'");
    expect(normalizedSql).toContain("if v_line.is_active = false then");
    expect(normalizedSql).toContain("if v_line.quantity > v_line.stock then");
    expect(normalizedSql).not.toMatch(/where ci\.cart_id = v_cart_id\s+order by ci\.id asc\s+for update of ci, p/);
  });

  it("persists selected cart provenance on order items without deleting cart rows", () => {
    const normalizedSql = readSelectedCheckoutRpcMigrationSql().toLowerCase();

    expect(normalizedSql).toContain("add column if not exists source_cart_item_id uuid null");
    expect(normalizedSql).toContain("order_items_source_cart_item_id_idx");
    expect(normalizedSql).toContain("ci.id as source_cart_item_id");
    expect(normalizedSql).toContain("'source_cart_item_id', v_line.source_cart_item_id");
    expect(normalizedSql).toMatch(
      /insert into public\.order_items \([\s\S]*product_sku_at_purchase,[\s\S]*source_cart_item_id[\s\S]*\)/,
    );
    expect(normalizedSql).toContain("snapshot.source_cart_item_id");
    expect(normalizedSql).toContain("source_cart_item_id uuid");
    expect(normalizedSql).not.toMatch(/delete\s+from\s+public\.cart_items/);
  });

  it("preserves SKU snapshots, idempotency lookup, and service-role grants", () => {
    const sql = readSelectedCheckoutRpcMigrationSql();
    const normalizedSql = sql.toLowerCase();

    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(sql).toContain("p.sku as product_sku");
    expect(sql).toContain("'product_sku_at_purchase', v_line.product_sku");
    expect(normalizedSql).toContain("where p.checkout_idempotency_key = p_checkout_idempotency_key");
    expect(normalizedSql).toContain("if v_existing_order_id is not null then");
    expect(normalizedSql).toContain("revoke all on function public.create_checkout_order_aggregate");
    expect(normalizedSql).toContain("from public, anon, authenticated");
    expect(normalizedSql).toContain("grant execute on function public.create_checkout_order_aggregate");
    expect(normalizedSql).toContain("to service_role");
    expect(normalizedSql).toMatch(/grant execute on function public\.create_checkout_order_aggregate\([\s\S]*uuid\[\],[\s\S]*text[\s\S]*\) to service_role/);
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
