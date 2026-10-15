import { mkdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(join(projectRoot, "evidence"), { recursive: true });
export default defineConfig({
  testDir: join(projectRoot, "tests/browser"),
  outputDir: join(projectRoot, "test-results"),
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.DEMO_URL || "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        ...(process.env.LOW_MEMORY === "1"
          ? [
              "--disable-gpu",
              "--renderer-process-limit=2",
              "--js-flags=--max-old-space-size=64 --max-semi-space-size=1",
            ]
          : []),
      ],
    },
    screenshot: "only-on-failure",
  },
  ...(!process.env.DEMO_URL
    ? {
        webServer: {
          command: "npm run dev",
          cwd: projectRoot,
          url: "http://127.0.0.1:5173/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: join(projectRoot, "playwright-report") },
    ],
  ],
});
