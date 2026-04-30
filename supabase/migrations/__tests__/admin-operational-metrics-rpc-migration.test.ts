import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = findLatestMigrationFile("_add_admin_operational_metrics_rpc.sql");

  if (!migrationFile) {
    throw new Error("Missing add_admin_operational_metrics_rpc migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

const findLatestMigrationFile = (suffix: string) => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(suffix))
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(`Missing migration with suffix ${suffix}`);
  }

  return migrationFile;
};

describe("admin operational metrics RPC migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("creates an admin-only security-invoker aggregate RPC", () => {
    expect(normalizedSql).toContain("create or replace function public.admin_operational_metrics");
    expect(normalizedSql).toContain("security invoker");
    expect(normalizedSql).toContain("if not (select private.is_admin()) then return");
    expect(normalizedSql).not.toContain("security definer");
  });

  it("supports the expected dashboard granularities", () => {
    expect(normalizedSql).toContain("not in ('day', 'week', 'month', 'year')");
    expect(normalizedSql).toContain("when 'day' then interval '1 day'");
    expect(normalizedSql).toContain("when 'week' then interval '1 week'");
    expect(normalizedSql).toContain("when 'month' then interval '1 month'");
    expect(normalizedSql).toContain("else interval '1 year'");
  });

  it("zero-fills buckets and keeps Jakarta order-created semantics", () => {
    expect(normalizedSql).toContain("pg_catalog.generate_series");
    expect(normalizedSql).toContain("left join metrics using (bucket_start)");
    expect(normalizedSql).toContain("timezone('asia/jakarta', orm.created_at)");
    expect(normalizedSql).toContain("from public.order_read_model orm");
  });

  it("keeps settlement semantics and restricts execute grants", () => {
    expect(normalizedSql).toContain("where orm.payment_status = 'settlement'::public.payment_status");
    expect(normalizedSql).toContain("and orm.status = 'delivered'");
    expect(normalizedSql).toContain("revoke all on function public.admin_operational_metrics(text, date, date) from public");
    expect(normalizedSql).toContain("grant execute on function public.admin_operational_metrics(text, date, date) to authenticated");
  });
});

describe("admin operational metrics range cap migration", () => {
  const migrationSql = readFileSync(
    join(migrationsDir, findLatestMigrationFile("_cap_admin_operational_metrics_range.sql")),
    "utf8",
  );
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("replaces the RPC with a server-side bucket cap", () => {
    expect(normalizedSql).toContain("create or replace function public.admin_operational_metrics");
    expect(normalizedSql).toContain("max_bucket_count constant integer := 500");
    expect(normalizedSql).toContain("if bucket_count > max_bucket_count then");
    expect(normalizedSql).toContain("operational metrics range is too large");
  });

  it("calculates bucket count for each supported granularity", () => {
    expect(normalizedSql).toContain("when 'day' then (last_bucket_start - first_bucket_start) + 1");
    expect(normalizedSql).toContain("when 'week' then ((last_bucket_start - first_bucket_start) / 7) + 1");
    expect(normalizedSql).toContain("extract(month from last_bucket_start)");
    expect(normalizedSql).toContain("extract(year from last_bucket_start)::integer - extract(year from first_bucket_start)::integer + 1");
  });
});
