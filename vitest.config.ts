import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".worktrees/**"],
    globals: true,
    environment: "jsdom",
  },
});
