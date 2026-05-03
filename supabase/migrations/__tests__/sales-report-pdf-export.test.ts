import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith("_add_sales_report_pdf_export_rpc.sql"))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing add_sales_report_pdf_export_rpc migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("sales report PDF export migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("creates a date-bounded admin RPC that returns the four PDF sections", () => {
    expect(normalizedSql).toContain("create or replace function public.admin_sales_report_pdf_export(");
    expect(normalizedSql).toContain("returns jsonb");
    expect(normalizedSql).toContain("p_start_date date");
    expect(normalizedSql).toContain("p_end_date date");
    expect(normalizedSql).toContain("jsonb_build_object(");
    expect(normalizedSql).toContain("dailysalessummary");
    expect(normalizedSql).toContain("soldproducts");
    expect(normalizedSql).toContain("bestsellingproducts");
    expect(normalizedSql).toContain("largestcustomers");
  });

  it("filters orders before aggregating product and customer sections", () => {
    expect(normalizedSql).toContain("from public.order_read_model orm");
    expect(normalizedSql).toContain("where orm.payment_status = 'settlement'::public.payment_status");
    expect(normalizedSql).toContain("and orm.created_at::date between p_start_date and p_end_date");
    expect(normalizedSql).toContain("from filtered_orders fo");
    expect(normalizedSql).toContain("join public.order_items oi on oi.order_id = fo.id");
    expect(normalizedSql).toContain("join public.profiles u on u.id = fo.user_id");
    expect(normalizedSql).not.toContain("from public.report_product_sales");
    expect(normalizedSql).not.toContain("from public.report_customer_sales");
  });

  it("keeps the RPC admin-gated and narrowly granted", () => {
    expect(normalizedSql).toContain("where profiles.id = auth.uid()");
    expect(normalizedSql).toContain("profiles.role = 'admin'");
    expect(normalizedSql).toContain("raise exception 'insufficient privileges to export sales report'");
    expect(normalizedSql).toContain("revoke all on function public.admin_sales_report_pdf_export(date, date) from public");
    expect(normalizedSql).toContain("revoke all on function public.admin_sales_report_pdf_export(date, date) from anon");
    expect(normalizedSql).toContain("grant execute on function public.admin_sales_report_pdf_export(date, date) to authenticated");
    expect(normalizedSql).not.toContain("security definer");
  });
});
