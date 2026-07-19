import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith("_enhance_order_notifications_trigger.sql"))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing enhance_order_notifications_trigger migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("enhance order notifications trigger migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("defines the updated trigger function notify_admins_of_new_order()", () => {
    expect(normalizedSql).toContain("create or replace function private.notify_admins_of_new_order()");
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain("coalesce(sum(quantity), 0) into v_item_count from public.order_items where order_id = new.id");
  });

  it("inserts new order notification including itemCount and totalAmount", () => {
    expect(normalizedSql).toContain("jsonb_build_object");
    expect(normalizedSql).toContain("'audience', 'admin_dashboard'");
    expect(normalizedSql).toContain("'orderid', new.id");
    expect(normalizedSql).toContain("'customername', customer_profile.full_name");
    expect(normalizedSql).toContain("'orderstatus', new.status");
    expect(normalizedSql).toContain("'paymentstatus', new.payment_status");
    expect(normalizedSql).toContain("'totalamount', new.total_amount");
    expect(normalizedSql).toContain("'itemcount', v_item_count");
  });

  it("drops the old trigger and creates constraint trigger that is deferred initially", () => {
    expect(normalizedSql).toContain("drop trigger if exists orders_admin_new_order_notifications_trigger on public.orders");
    expect(normalizedSql).toContain("create constraint trigger orders_admin_new_order_notifications_trigger after insert on public.orders deferrable initially deferred for each row execute function private.notify_admins_of_new_order()");
  });
});
