import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260507132500_fix_push_delivery_retry_state.sql"
  ),
  "utf8"
);

const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

describe("push delivery retry state repair migration", () => {
  it("keeps retryable receipt errors eligible for receipt polling", () => {
    expect(normalizedSql).toContain(
      "update public.notification_push_deliveries"
    );
    expect(normalizedSql).toContain("receipt_id = null");
    expect(normalizedSql).toContain("receipt_id is not null");
    expect(normalizedSql).toContain("delivered_at is null");
    expect(normalizedSql).toContain("failed_at is null");
    expect(normalizedSql).toContain("next_retry_at is not null");
    expect(normalizedSql).toContain(
      "coalesce(error_code, '') <> 'devicenotregistered'"
    );
  });

  it("removes retry schedules from terminal failures", () => {
    expect(normalizedSql).toContain("next_retry_at = null");
    expect(normalizedSql).toContain("failed_at is not null");
    expect(normalizedSql).toContain("next_retry_at is not null");
  });
});
