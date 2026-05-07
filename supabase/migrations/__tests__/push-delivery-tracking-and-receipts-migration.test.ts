import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_add_push_delivery_tracking_and_receipts.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error(
      "Missing add_push_delivery_tracking_and_receipts migration"
    );
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("push delivery tracking and receipts migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("creates profile push token storage with owner-scoped RLS", () => {
    expect(normalizedSql).toContain(
      "create table if not exists public.profile_push_tokens"
    );
    expect(normalizedSql).toContain(
      "user_id uuid not null references public.profiles(id) on delete cascade"
    );
    expect(normalizedSql).toContain("device_id text not null");
    expect(normalizedSql).toContain("expo_push_token text not null");
    expect(normalizedSql).toContain("platform text not null");
    expect(normalizedSql).toContain(
      "alter table public.profile_push_tokens enable row level security"
    );
    expect(normalizedSql).toContain(
      "create unique index if not exists profile_push_tokens_user_device_uidx"
    );
    expect(normalizedSql).toContain(
      "on public.profile_push_tokens (user_id, device_id)"
    );
    expect(normalizedSql).toContain(
      "create unique index if not exists profile_push_tokens_active_expo_push_token_uidx"
    );
    expect(normalizedSql).toContain(
      "on public.profile_push_tokens (expo_push_token) where revoked_at is null"
    );
    expect(normalizedSql).toContain(
      "for select to authenticated using ((select auth.uid()) = user_id)"
    );
    expect(normalizedSql).toContain(
      "for insert to authenticated with check ((select auth.uid()) = user_id)"
    );
    expect(normalizedSql).toContain(
      "for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)"
    );
    expect(normalizedSql).toContain(
      "for delete to authenticated using ((select auth.uid()) = user_id)"
    );
  });

  it("creates non-browser delivery persistence with retry and receipt metadata", () => {
    expect(normalizedSql).toContain(
      "create table if not exists public.notification_push_deliveries"
    );
    expect(normalizedSql).toContain(
      "notification_id uuid not null references public.notifications(id) on delete cascade"
    );
    expect(normalizedSql).toContain(
      "user_id uuid not null references public.profiles(id) on delete cascade"
    );
    expect(normalizedSql).toContain("ticket_id text");
    expect(normalizedSql).toContain("receipt_id text");
    expect(normalizedSql).toContain("attempt_count integer not null default 0");
    expect(normalizedSql).toContain("next_retry_at timestamptz");
    expect(normalizedSql).toContain("delivered_at timestamptz");
    expect(normalizedSql).toContain("failed_at timestamptz");
    expect(normalizedSql).toContain(
      "alter table public.notification_push_deliveries enable row level security"
    );
    expect(normalizedSql).toContain(
      "revoke all on public.notification_push_deliveries from anon, authenticated"
    );
    expect(normalizedSql).not.toMatch(
      /create policy [^;]* on public\.notification_push_deliveries/
    );
  });

  it("adds a guarded notification insert trigger that invokes the push function", () => {
    expect(normalizedSql).toContain(
      "create or replace function private.invoke_push_for_notification_insert()"
    );
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain(
      "new.data ->> 'audience' = 'admin_dashboard'"
    );
    expect(normalizedSql).toContain("from vault.decrypted_secrets");
    expect(normalizedSql).toContain("where name = 'project_url'");
    expect(normalizedSql).toContain("where name = 'service_role_key'");
    expect(normalizedSql).toContain("select net.http_post");
    expect(normalizedSql).toContain(
      "rtrim(v_project_url, '/') || '/functions/v1/push'"
    );
    expect(normalizedSql).toContain(
      "'authorization', 'bearer ' || v_service_role_key"
    );
    expect(normalizedSql).toContain("'type', 'insert'");
    expect(normalizedSql).toContain("'table', 'notifications'");
    expect(normalizedSql).toContain(
      "drop trigger if exists notifications_push_after_insert_trigger on public.notifications"
    );
    expect(normalizedSql).toContain(
      "create trigger notifications_push_after_insert_trigger after insert on public.notifications for each row execute function private.invoke_push_for_notification_insert()"
    );
  });

  it("schedules guarded Expo receipt polling through the push function", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.trigger_process_push_receipts("
    );
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain(
      "from public.notification_push_deliveries d"
    );
    expect(normalizedSql).toContain("d.ticket_id is not null");
    expect(normalizedSql).toContain("d.receipt_id is null");
    expect(normalizedSql).toContain("d.delivered_at is null");
    expect(normalizedSql).toContain("d.failed_at is null");
    expect(normalizedSql).toContain(
      "d.next_retry_at is null or d.next_retry_at <= timezone('utc'::text, now())"
    );
    expect(normalizedSql).toContain("where name = 'project_url'");
    expect(normalizedSql).toContain("where name = 'service_role_key'");
    expect(normalizedSql).toContain("'action', 'process_receipts'");
    expect(normalizedSql).toContain(
      "'limit', greatest(1, least(coalesce(p_limit, 100), 100))"
    );
    expect(normalizedSql).toContain(
      "revoke all on function public.trigger_process_push_receipts(integer) from public, anon, authenticated"
    );
    expect(normalizedSql).toContain(
      "where jobname = 'process-push-receipts-every-5-minutes'"
    );
    expect(normalizedSql).toContain(
      "perform cron.unschedule('process-push-receipts-every-5-minutes')"
    );
    expect(normalizedSql).toContain(
      "select cron.schedule( 'process-push-receipts-every-5-minutes', '*/5 * * * *'"
    );
    expect(normalizedSql).toContain(
      "select public.trigger_process_push_receipts(100)"
    );
  });
});
