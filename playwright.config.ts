import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.DEMO_URL || "http://127.0.0.1:5173",
    headless: true,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    screenshot: "only-on-failure",
  },
  ...(!process.env.DEMO_URL
    ? {
        webServer: {
          command: "npm run dev",
          url: "http://127.0.0.1:5173/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
  reporter: [["list"], ["html", { open: "never" }]],
});
