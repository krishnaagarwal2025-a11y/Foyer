import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = path.join(root, "public", "extension");

test("Foyer Companion loads on a supported title and exposes a safe setup panel", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "foyer-extension-"));
  let context: BrowserContext | undefined;
  try {
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        channel: "chromium",
        ignoreDefaultArgs: ["--disable-extensions"],
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });
    } catch (error) {
      if (
        process.platform === "win32" &&
        /side-by-side|spawn UNKNOWN/i.test(String(error))
      )
        test.skip(
          true,
          "The Playwright Chrome for Testing binary cannot start because this Windows image lacks its side-by-side runtime; the branded Chrome installed here no longer accepts extension-loading flags.",
        );
      throw error;
    }
    const page = context.pages()[0] || (await context.newPage());
    await page.route("https://www.netflix.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>Foyer extension fixture</title><video controls style="width:640px;height:360px"></video>`,
      }),
    );
    await page.goto("https://www.netflix.com/watch/8123456789");
    await expect(page.locator("#foyer-companion")).toHaveCount(1, {
      timeout: 10000,
    });
    await page.getByRole("button", { name: "Toggle Foyer companion" }).click();
    await expect(
      page.getByText("COMPANION · EXPERIMENTAL"),
    ).toBeVisible();
    await expect(page.getByLabel("Foyer server")).toHaveValue(
      "http://localhost:3001",
    );
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByLabel("Room code")).toBeVisible();
    expect(await page.locator("#foyer-companion input[type=password]").count()).toBe(
      0,
    );
    await expect(
      page.getByText("never reads account credentials", { exact: false }),
    ).toBeVisible();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
