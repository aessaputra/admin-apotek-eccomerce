import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const readMigrationSql = (migrationFileName: string) =>
  readFileSync(join(migrationsDir, migrationFileName), "utf8");

const findMigrationFile = (suffix: string) => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(suffix))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(`Missing ${suffix} migration`);
  }

  return migrationFile;
};

describe("customer test notification RPC migration", () => {
  const initialMigrationFile = findMigrationFile(
    "_add_customer_test_notification_rpc.sql"
  );
  const noPersistMigrationFile = findMigrationFile(
    "_disable_legacy_test_notification_persistence.sql"
  );
  const initialMigrationSql = readMigrationSql(initialMigrationFile);
  const noPersistMigrationSql = readMigrationSql(noPersistMigrationFile);
  const normalizedInitialSql = initialMigrationSql
    .replace(/\s+/g, " ")
    .toLowerCase();
  const normalizedNoPersistSql = noPersistMigrationSql
    .replace(/\s+/g, " ")
    .toLowerCase();

  it("keeps the original applied RPC migration intact", () => {
    expect(initialMigrationFile).toBe(
      "20260509090000_add_customer_test_notification_rpc.sql"
    );
    expect(normalizedInitialSql).toContain(
      "create or replace function public.create_test_notification()"
    );
    expect(normalizedInitialSql).toContain("returns public.notifications");
    expect(normalizedInitialSql).toContain("security invoker");
    expect(normalizedInitialSql).toContain("insert into public.notifications");
    expect(normalizedInitialSql).toContain(
      "grant execute on function public.create_test_notification() to authenticated"
    );
  });

  it("adds a later migration that turns the legacy RPC into an authenticated no-op", () => {
    expect(noPersistMigrationFile).toBe(
      "20260509131539_disable_legacy_test_notification_persistence.sql"
    );
    expect(noPersistMigrationFile > initialMigrationFile).toBe(true);
    expect(normalizedNoPersistSql).toContain(
      "create or replace function public.create_test_notification()"
    );
    expect(normalizedNoPersistSql).toContain("returns public.notifications");
    expect(normalizedNoPersistSql).toContain("security invoker");
    expect(normalizedNoPersistSql).toContain("v_user_id uuid := auth.uid()");
    expect(normalizedNoPersistSql).toContain(
      "return null::public.notifications"
    );
    expect(normalizedNoPersistSql).toContain(
      "grant execute on function public.create_test_notification() to authenticated"
    );
    expect(normalizedNoPersistSql).toContain(
      "revoke all on function public.create_test_notification() from public, anon"
    );
    expect(normalizedNoPersistSql).not.toContain(
      "insert into public.notifications"
    );
    expect(normalizedNoPersistSql).not.toContain(
      "notification_push_deliveries"
    );
    expect(normalizedNoPersistSql).not.toContain("security definer");
  });

  it("removes the legacy direct insert grant and test notification insert policy", () => {
    expect(normalizedInitialSql).toContain(
      "grant insert on public.notifications to authenticated"
    );
    expect(normalizedInitialSql).toContain(
      'create policy "users can insert own test notifications" on public.notifications for insert to authenticated with check'
    );

    expect(normalizedNoPersistSql).toContain(
      'drop policy if exists "users can insert own test notifications" on public.notifications'
    );
    expect(normalizedNoPersistSql).toContain(
      "revoke insert on public.notifications from authenticated"
    );
    expect(normalizedNoPersistSql).not.toContain(
      "grant insert on public.notifications to authenticated"
    );
    expect(normalizedNoPersistSql).not.toContain("create policy");
  });
});
