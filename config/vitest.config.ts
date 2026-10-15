import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10000,
    maxWorkers: 1,
    fileParallelism: false,
    pool: "forks",
  },
});
