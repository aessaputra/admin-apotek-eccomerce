import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith("_add_customer_test_notification_rpc.sql"))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing add_customer_test_notification_rpc migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("customer test notification RPC migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("creates an authenticated RPC that inserts a customer-owned notification", () => {
    expect(normalizedSql).toContain("create or replace function public.create_test_notification()");
    expect(normalizedSql).toContain("security invoker");
    expect(normalizedSql).toContain("v_user_id uuid := auth.uid()");
    expect(normalizedSql).toContain("insert into public.notifications");
    expect(normalizedSql).toContain("'test_notification'");
    expect(normalizedSql).toContain("'ini adalah notifikasi tes dari aplikasi apotek ecommerce.'");
    expect(normalizedSql).toContain("and data = '{}'::jsonb");
    expect(normalizedSql).toContain("grant insert on public.notifications to authenticated");
    expect(normalizedSql).toContain(
      'create policy "users can insert own test notifications" on public.notifications for insert to authenticated with check'
    );
    expect(normalizedSql).toContain("source_event_key like ('mobile-test-' || (select auth.uid())::text || '-%')");
    expect(normalizedSql).toContain("grant execute on function public.create_test_notification() to authenticated");
    expect(normalizedSql).toContain("revoke all on function public.create_test_notification() from public, anon");
    expect(normalizedSql).not.toContain("security definer");
  });
});
