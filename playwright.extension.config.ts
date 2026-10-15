import { mkdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";
mkdirSync("evidence", { recursive: true });

export default defineConfig({
  testDir: "./tests/extension",
  timeout: 45_000,
  workers: 1,
  reporter: [["list"]],
  use: { headless: true, launchOptions: { channel: "chromium" } },
});
