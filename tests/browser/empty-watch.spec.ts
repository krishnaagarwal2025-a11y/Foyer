import { test, expect } from "@playwright/test";
import { loadDemo } from "./demo";
test("Watch starts empty and an optional video can be selected", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Display name").fill("Empty screen host");
  await page.getByRole("button", { name: "＋ Create a room" }).click();
  await expect(page.getByText("Your screen is ready")).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Sync room", exact: true }),
  ).toBeDisabled();
  await loadDemo(page);
  await expect(page.locator(".stage h1")).toHaveText("Cinema Color Journey");
});
