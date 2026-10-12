import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension",
  timeout: 45_000,
  workers: 1,
  reporter: [["list"]],
  use: { headless: true, launchOptions: { channel: "chromium" } },
});
