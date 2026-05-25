import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "supabase/functions/**/__fixtures__/**",
        "supabase/functions/**/__tests__/**",
        "supabase/functions/**/*.d.ts",
      ],
      include: ["supabase/functions/**/*.ts"],
      provider: "v8",
      reporter: ["text"],
      reportsDirectory: "./coverage/edge-functions",
      thresholds: {
        branches: 62,
        functions: 81,
        lines: 71,
        statements: 71,
      },
    },
    exclude: [...configDefaults.exclude, ".worktrees/**"],
    globals: true,
    environment: "jsdom",
    include: [...configDefaults.include, "scripts/edge-runtime-smoke.ts"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
