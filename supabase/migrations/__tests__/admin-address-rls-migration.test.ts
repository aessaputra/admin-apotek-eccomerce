import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

function readMigrationSql(fileNameSuffix: string) {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(fileNameSuffix))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(`Missing ${fileNameSuffix} migration`);
  }

  return {
    fileName: migrationFile,
    sql: readFileSync(join(migrationsDir, migrationFile), "utf8"),
  };
}

describe("admin address RLS migration", () => {
  const broadMigration = readMigrationSql("_allow_admin_order_address_reads.sql");
  const narrowMigration = readMigrationSql("_narrow_admin_order_address_reads.sql");
  const normalizedNarrowSql = narrowMigration.sql.replace(/\s+/g, " ").toLowerCase();

  it("grants address reads only to authenticated admins for order-linked addresses", () => {
    expect(normalizedNarrowSql).toContain('drop policy if exists "admins can view all addresses"');
    expect(normalizedNarrowSql).toContain('create policy "admins can view order shipping addresses"');
    expect(normalizedNarrowSql).toContain("on public.addresses");
    expect(normalizedNarrowSql).toContain("for select");
    expect(normalizedNarrowSql).toContain("to authenticated");
    expect(normalizedNarrowSql).toContain("select private.is_admin()");
    expect(normalizedNarrowSql).toContain("exists ( select 1 from public.orders where orders.shipping_address_id = addresses.id )");
    expect(normalizedNarrowSql).not.toContain("to anon");
  });

  it("keeps the remote-applied broad policy historical and superseded by the narrow migration", () => {
    expect(broadMigration.fileName).toBe("20260507133623_allow_admin_order_address_reads.sql");
    expect(narrowMigration.fileName).toBe("20260507134745_narrow_admin_order_address_reads.sql");
    expect(broadMigration.fileName < narrowMigration.fileName).toBe(true);
    expect(normalizedNarrowSql).toContain('drop policy if exists "admins can view all addresses"');
  });
});
