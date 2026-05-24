import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const functionsRoot = join(process.cwd(), "supabase/functions");
const allowedProviderEnvFallbacks = new Set<string>();
const skippedRepositoryDirectories = new Set([
  ".git",
  ".omo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".temp",
]);

const legacyEnvCleanupCandidates = [
  "SHOP_SHIPPER_NAME",
  "SHOP_SHIPPER_PHONE",
  "SHOP_ADDRESS",
  "SHOP_ORGANIZATION",
  "SHOP_SHIPPER_EMAIL",
  "BITESHIP_ORIGIN_POSTAL_CODE",
  "BITESHIP_COURIERS",
  "CORS_ORIGIN",
] as const;

const protectedSupabaseBootstrapNames = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "SB_PUBLISHABLE_KEY",
] as const;

function listRuntimeSources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      if (entry === "__tests__") {
        return [];
      }

      return listRuntimeSources(absolutePath);
    }

    if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) {
      return [];
    }

    return [absolutePath];
  });
}

function listRepositoryFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (skippedRepositoryDirectories.has(entry)) {
      return [];
    }

    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return listRepositoryFiles(absolutePath);
    }

    return [absolutePath];
  });
}

function isSetupGuidanceFile(absolutePath: string): boolean {
  const relativePath = relative(repoRoot, absolutePath);

  return relativePath === ".env.example" ||
    relativePath.endsWith(".md") ||
    relativePath.endsWith(".txt") ||
    relativePath.endsWith(".env.sample") ||
    relativePath.endsWith(".env.template");
}

function isAllowedLegacyCleanupMention(line: string): boolean {
  return /\b(obsolete|cleanup candidate|cleanup target|legacy cleanup)\b/i.test(line);
}

function findLegacyEnvNameMentions(source: string, names: readonly string[]) {
  const lines = source.split(/\r?\n/);

  return lines.flatMap((line, index) =>
    names
      .filter((name) => new RegExp(`\\b${name}\\b`).test(line))
      .map((name) => ({ line, lineNumber: index + 1, name }))
  );
}

describe("provider environment cutover source guard", () => {
  it("rejects all provider env fallbacks, aliases, reads, and environment object dumps in runtime source", () => {
    const forbiddenPatterns = [
      /\bMIDTRANS_[A-Z0-9_]*\b/,
      /\bBITESHIP_API_KEY\b/,
      /\bEXPO_ACCESS_TOKEN\b/,
      /Deno\.env\.toObject\s*\(/,
      ...legacyEnvCleanupCandidates.map((name) => new RegExp(`\\b${name}\\b`)),
    ];
    const violations = listRuntimeSources(functionsRoot).flatMap((absolutePath) => {
      const source = readFileSync(absolutePath, "utf8");
      const relativePath = relative(repoRoot, absolutePath);

      return forbiddenPatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relativePath}: ${pattern.source}`);
    }).filter((violation) => !allowedProviderEnvFallbacks.has(violation));

    expect(violations).toEqual([]);
  });

  it("rejects active setup guidance for legacy cleanup candidate env names", () => {
    const violations = listRepositoryFiles(repoRoot)
      .filter(isSetupGuidanceFile)
      .flatMap((absolutePath) => {
        const source = readFileSync(absolutePath, "utf8");
        const relativePath = relative(repoRoot, absolutePath);

        return findLegacyEnvNameMentions(source, legacyEnvCleanupCandidates)
          .filter(({ line }) => !isAllowedLegacyCleanupMention(line))
          .map(({ lineNumber, name }) => `${relativePath}:${lineNumber}: ${name}`);
      });

    expect(violations).toEqual([]);
  });

  it("allows historical cleanup notes and tests only when legacy names are labelled as obsolete or cleanup candidates", () => {
    expect(isAllowedLegacyCleanupMention("obsolete SHOP_SHIPPER_NAME migration note")).toBe(true);
    expect(isAllowedLegacyCleanupMention("cleanup candidate BITESHIP_COURIERS source guard test")).toBe(true);
    expect(isAllowedLegacyCleanupMention("Set SHOP_SHIPPER_NAME in local env")).toBe(false);
    expect(isAllowedLegacyCleanupMention("Configure CORS_ORIGIN before deploy")).toBe(false);
  });

  it("does not classify protected Supabase bootstrap names as legacy cleanup candidates", () => {
    const protectedCleanupTargets = protectedSupabaseBootstrapNames.filter((name) =>
      legacyEnvCleanupCandidates.includes(
        name as typeof legacyEnvCleanupCandidates[number],
      )
    );

    expect(protectedCleanupTargets).toEqual([]);
  });
});
