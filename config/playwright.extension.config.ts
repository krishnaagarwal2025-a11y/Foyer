import { mkdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(join(projectRoot, "evidence"), { recursive: true });

export default defineConfig({
  testDir: join(projectRoot, "tests/extension"),
  outputDir: join(projectRoot, "test-results/extension"),
  timeout: 45_000,
  workers: 1,
  reporter: [["list"]],
  use: { headless: true, launchOptions: { channel: "chromium" } },
});
