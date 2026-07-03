import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_fix_order_items_constraints.sql"),
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing order_items constraints migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("order_items constraints migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = normalizeSql(migrationSql);

  it("adds a positive quantity check", () => {
    expect(normalizedSql).toContain(
      "add constraint order_items_quantity_positive_chk",
    );
    expect(normalizedSql).toContain("check (quantity > 0)");
  });

  it("cleans orphaned source_cart_item_id values before adding the FK", () => {
    expect(normalizedSql).toContain(
      "set source_cart_item_id = null",
    );
    expect(normalizedSql).toContain(
      "not exists ( select 1 from public.cart_items ci",
    );
  });

  it("adds the missing foreign key on source_cart_item_id with ON DELETE SET NULL", () => {
    expect(normalizedSql).toContain(
      "add constraint order_items_source_cart_item_id_fkey",
    );
    expect(normalizedSql).toContain(
      "foreign key (source_cart_item_id)",
    );
    expect(normalizedSql).toContain(
      "references public.cart_items(id)",
    );
    expect(normalizedSql).toContain("on delete set null");
  });

  it("guards against duplicate constraints", () => {
    expect(normalizedSql).toContain(
      "if not exists ( select 1 from pg_constraint",
    );
  });

  it("documents the constraints", () => {
    expect(normalizedSql).toContain(
      "comment on constraint order_items_quantity_positive_chk",
    );
    expect(normalizedSql).toContain(
      "comment on constraint order_items_source_cart_item_id_fkey",
    );
  });
});
