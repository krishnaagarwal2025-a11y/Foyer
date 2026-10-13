import { test, expect } from "@playwright/test";
test("purple theme hierarchy and illustrated light mode fit desktop and phone", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Display name").fill("Theme preview");
  await page.getByLabel("Room code").fill("ABCDEF");
  const create = page.getByRole("button", { name: "＋ Create a room" });
  const join = page.getByRole("button", { name: "Join room →" });
  for (const theme of ["dark", "light"]) {
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", { name: `Switch to ${theme} theme` })
        .click();
    await expect(create).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(185, 138, 219)" : "rgb(109, 61, 145)",
    );
    await expect(join).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(48, 34, 56)" : "rgb(239, 230, 245)",
    );
    await expect(page.locator(".hero-copy h1")).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(213, 180, 240)" : "rgb(100, 55, 130)",
    );
    await expect(page.locator(".poster-scene")).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(23, 21, 38)" : "rgb(241, 231, 247)",
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `evidence/purple-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  }
});
test("real room request displays a rolling disc, errors clear it, and room navigation transitions", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.routeWebSocket("**/socket.io/**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (String(message).includes('["join",'))
        setTimeout(() => server.send(message), 1000);
      else server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByLabel("Display name").fill("Disc host");
    await page.getByLabel("Room code").fill("BADBAD");
    await page.getByRole("button", { name: "Join room →" }).click();
    await expect(page.locator(".disc-loader-screen")).toBeVisible();
    await expect(page.locator(".loading-disc")).toHaveCSS(
      "animation-name",
      "disc-roll",
    );
    await expect(page.locator(".welcome")).toHaveAttribute("inert", "");
    await page.waitForTimeout(150);
    await page.screenshot({ path: "evidence/rolling-disc-loading.png" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".loading-disc")).toHaveCSS(
      "animation-name",
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.getByRole("alert")).toContainText("Room not found");
    await expect(page.locator(".disc-loader-screen")).toHaveCount(0);
    await page.getByRole("button", { name: "＋ Create a room" }).click();
    await expect(page.getByText("Your screen is ready")).toBeVisible();
    await expect(page.locator(".disc-loader-screen")).toHaveCount(0);
    await page.getByRole("button", { name: "Discover", exact: true }).click();
    await expect(page.locator("#sidebar-discover")).toHaveCSS(
      "animation-name",
      "page-arrive",
    );
    await page.getByRole("button", { name: /^People/ }).click();
    await expect(page.locator("#sidebar-people")).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Room", exact: true }).click();
    await expect(page.locator("#sidebar-room")).toHaveCSS(
      "animation-name",
      "none",
    );
  } finally {
    await context.close();
  }
});
