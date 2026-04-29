import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith("_add_admin_order_notifications.sql"))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing add_admin_order_notifications migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("admin order notifications migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("creates a locked private security-definer trigger producer", () => {
    expect(normalizedSql).toContain("create schema if not exists private");
    expect(normalizedSql).toContain("create or replace function private.notify_admins_of_new_order()");
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain("drop trigger if exists orders_admin_new_order_notifications_trigger on public.orders");
    expect(normalizedSql).toContain("create trigger orders_admin_new_order_notifications_trigger after insert on public.orders for each row execute function private.notify_admins_of_new_order()");
  });

  it("inserts one durable admin notification with deterministic idempotency", () => {
    expect(normalizedSql).toContain("insert into public.notifications");
    expect(normalizedSql).toContain("from public.profiles as admin_profile");
    expect(normalizedSql).toContain("where admin_profile.role = 'admin'");
    expect(normalizedSql).toContain("'new_order'");
    expect(normalizedSql).toContain("'new order received'");
    expect(normalizedSql).toContain("'open the order detail to review it'");
    expect(normalizedSql).toContain("'/orders/show/' || new.id::text");
    expect(normalizedSql).toContain("'high'");
    expect(normalizedSql).toContain("'admin:new-order:' || new.id::text");
    expect(normalizedSql).toContain("on conflict (user_id, source_event_key) where source_event_key is not null do nothing");
  });

  it("includes the admin dashboard payload contract", () => {
    expect(normalizedSql).toContain("jsonb_build_object");
    expect(normalizedSql).toContain("'audience', 'admin_dashboard'");
    expect(normalizedSql).toContain("'orderid', new.id");
    expect(normalizedSql).toContain("'customername', customer_profile.full_name");
    expect(normalizedSql).toContain("'orderstatus', new.status");
    expect(normalizedSql).toContain("'paymentstatus', new.payment_status");
    expect(normalizedSql).toContain("'createdat', new.created_at");
    expect(normalizedSql).toContain("'route', notification_route");
    expect(normalizedSql).toContain("left join public.profiles as customer_profile on customer_profile.id = new.user_id");
  });

  it("guards realtime publication membership idempotently", () => {
    expect(normalizedSql).toContain("from pg_catalog.pg_publication");
    expect(normalizedSql).toContain("where pubname = 'supabase_realtime'");
    expect(normalizedSql).toContain("from pg_catalog.pg_publication_tables");
    expect(normalizedSql).toContain("schemaname = 'public'");
    expect(normalizedSql).toContain("tablename = 'notifications'");
    expect(normalizedSql).toContain("alter publication supabase_realtime add table public.notifications");
  });

  it("does not include secrets or external delivery channels", () => {
    expect(normalizedSql).not.toMatch(/service_role|midtrans_server_key|expo_access_token/);
    expect(normalizedSql).not.toMatch(/email|sms|whatsapp/);
    expect(normalizedSql).not.toMatch(/fetch\s*\(|pg_net|http_post|send_push|push_notification/);
  });
});
