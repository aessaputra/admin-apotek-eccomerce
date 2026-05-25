import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(
  process.cwd(),
  ".github",
  "workflows",
  "edge-functions.yml",
);

function extractTriggerPathBlock(source: string, triggerName: "pull_request" | "push") {
  const triggerMatch = source.match(new RegExp(`^  ${triggerName}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|^permissions:)`, "m"));

  if (!triggerMatch) {
    throw new Error(`Missing ${triggerName} trigger`);
  }

  const triggerLines = triggerMatch[1].split("\n");
  const pathsStartIndex = triggerLines.findIndex((line) => line === "    paths:");

  if (pathsStartIndex === -1) {
    throw new Error(`Missing ${triggerName} paths block`);
  }

  return triggerLines
    .slice(pathsStartIndex + 1)
    .filter((line) => line.startsWith("      - "))
    .join("\n");
}

describe("Edge Function validation workflow paths", () => {
  const workflowSource = readFileSync(workflowPath, "utf8");

  it.each(["pull_request", "push"] as const)(
    "runs for Supabase migration changes on %s",
    (triggerName) => {
      expect(extractTriggerPathBlock(workflowSource, triggerName)).toContain(
        '- "supabase/migrations/**"',
      );
    },
  );
});
