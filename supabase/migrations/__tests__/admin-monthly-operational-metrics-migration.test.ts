import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith("_add_admin_monthly_operational_metrics.sql"))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing add_admin_monthly_operational_metrics migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("admin monthly operational metrics migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("creates the read-only security-invoker aggregate view", () => {
    expect(normalizedSql).toContain("create or replace view public.admin_monthly_operational_metrics");
    expect(normalizedSql).toContain("with (security_invoker = true)");
    expect(normalizedSql).toContain("from public.order_read_model orm");
    expect(normalizedSql).not.toContain("security definer");
    expect(normalizedSql).not.toMatch(/grant\s+/);
    expect(normalizedSql).not.toMatch(/select\s+\*/);
  });

  it("exposes the dashboard contract columns explicitly", () => {
    expect(normalizedSql).toContain("as month_start");
    expect(normalizedSql).toContain("as order_count");
    expect(normalizedSql).toContain("as paid_order_count");
    expect(normalizedSql).toContain("as completed_order_count");
    expect(normalizedSql).toContain("as revenue");
  });

  it("uses Asia/Jakarta order-created month buckets", () => {
    expect(normalizedSql).toContain(
      "date_trunc('month', timezone('asia/jakarta', orm.created_at))::date as month_start",
    );
    expect(normalizedSql).toContain(
      "group by date_trunc('month', timezone('asia/jakarta', orm.created_at))::date",
    );
    expect(normalizedSql).toContain(
      "order by date_trunc('month', timezone('asia/jakarta', orm.created_at))::date desc",
    );
  });

  it("keeps paid, completed, and revenue semantics tied to settlement", () => {
    expect(normalizedSql).toContain(
      "count(distinct orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status)::bigint as paid_order_count",
    );
    expect(normalizedSql).toContain(
      "count(distinct orm.id) filter (where orm.payment_status = 'settlement'::public.payment_status and orm.status = 'delivered')::bigint as completed_order_count",
    );
    expect(normalizedSql).toContain(
      "coalesce(sum(orm.total_amount) filter (where orm.payment_status = 'settlement'::public.payment_status), 0)::numeric as revenue",
    );
  });

  it("documents the reporting contract on the view", () => {
    expect(normalizedSql).toContain("comment on view public.admin_monthly_operational_metrics is");
    expect(normalizedSql).toContain("asia/jakarta");
    expect(normalizedSql).toContain("revenue counts settlement payments only");
    expect(normalizedSql).toContain("completed orders count delivered settlement orders");
  });
});
