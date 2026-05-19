import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

describe("push runtime config source migration", () => {
  it("removes direct Expo provider env reads from the push runtime path", () => {
    const source = readSource("supabase/functions/push/handler.ts");

    expect(source).not.toContain('env.get("EXPO_ACCESS_TOKEN")');
    expect(source).not.toContain('Deno.env.get("EXPO_ACCESS_TOKEN")');
  });

  it("uses the shared runtime config helper for optional Expo access token lookups", () => {
    const source = readSource("supabase/functions/push/handler.ts");

    expect(source).toContain("CONFIG_KEYS.pushExpoAccessToken");
    expect(source).toContain("createRuntimeConfigProvider");
    expect(source).toContain("getOptionalConfig");
    expect(source).not.toContain("getRequiredConfig(CONFIG_KEYS.pushExpoAccessToken");
  });
});
