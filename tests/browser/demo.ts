import { expect, type Page } from "@playwright/test";
export async function loadDemo(page: Page) {
  await page.getByRole("button", { name: /^Discover/ }).click();
  await page
    .locator(".movie")
    .filter({ hasText: "Cinema Color Journey" })
    .getByRole("button", { name: "Watch", exact: true })
    .click();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await expect(page.locator("video")).toBeVisible();
}
