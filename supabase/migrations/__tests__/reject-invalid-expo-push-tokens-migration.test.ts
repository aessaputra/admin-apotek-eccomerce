import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const findMigrationSql = () => {
  const migrationFile = readdirSync(migrationsDir)
    .filter((fileName) =>
      fileName.endsWith("_reject_invalid_expo_push_tokens.sql")
    )
    .sort()
    .at(-1);

  if (!migrationFile) {
    throw new Error("Missing reject invalid Expo push tokens migration");
  }

  return readFileSync(join(migrationsDir, migrationFile), "utf8");
};

describe("reject invalid Expo push tokens migration", () => {
  const migrationSql = findMigrationSql();
  const normalizedSql = migrationSql.replace(/\s+/g, " ").toLowerCase();

  it("cleans invalid active token rows and legacy profile mirrors", () => {
    expect(normalizedSql).toContain("update public.profile_push_tokens");
    expect(normalizedSql).toContain("where revoked_at is null");
    expect(normalizedSql).toContain(
      "expo_push_token !~ '^(expopushtoken|exponentpushtoken)\\[[^\\]]+\\]$'"
    );
    expect(normalizedSql).toContain("update public.profiles");
    expect(normalizedSql).toContain("expo_push_token = null");
  });

  it("adds guarded token format constraints", () => {
    expect(normalizedSql).toContain(
      "drop constraint if exists profile_push_tokens_active_expo_push_token_format_chk"
    );
    expect(normalizedSql).toContain(
      "add constraint profile_push_tokens_active_expo_push_token_format_chk"
    );
    expect(normalizedSql).toContain(
      "revoked_at is not null or expo_push_token ~"
    );
    expect(normalizedSql).toContain(
      "profile_push_tokens_active_expo_push_token_format_chk check"
    );
    expect(normalizedSql).toContain(
      "drop constraint if exists profiles_expo_push_token_format_chk"
    );
    expect(normalizedSql).toContain(
      "add constraint profiles_expo_push_token_format_chk"
    );
    expect(normalizedSql).toContain(
      "expo_push_token is null or pg_catalog.btrim(expo_push_token) ~"
    );
    expect(normalizedSql).toContain("not valid");
  });

  it("replaces the authenticated RPC with server-side Expo token validation", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.claim_profile_push_token"
    );
    expect(normalizedSql).toContain("security definer");
    expect(normalizedSql).toContain("set search_path = ''");
    expect(normalizedSql).toContain(
      "if v_expo_push_token !~ '^(expopushtoken|exponentpushtoken)\\[[^\\]]+\\]$' then"
    );
    expect(normalizedSql).toContain("using errcode = '22023'");
    expect(normalizedSql).toContain(
      "grant execute on function public.claim_profile_push_token(text, text, text, timestamptz) to authenticated"
    );
  });
});
