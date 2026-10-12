import { test, expect } from "@playwright/test";

test("manual sync corrects modest paused drift, retries blocked playback, and never controls the room", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await b.addInitScript(() => {
    (window as any).syncCommands = [];
    window.addEventListener("watchparty:command", (e) =>
      (window as any).syncCommands.push((e as CustomEvent).detail.command),
    );
  });
  const host = await a.newPage(),
    guest = await b.newPage();
  try {
    await host.goto("/");
    await host.getByLabel("Display name").fill("Sync host");
    await expect(
      host.getByRole("button", { name: "＋ Create a room" }),
    ).toBeEnabled();
    await host.getByRole("button", { name: "＋ Create a room" }).click();
    await expect(host.locator("video")).toBeVisible();
    const code = new URL(host.url()).searchParams.get("room");
    await guest.goto("/?room=" + code);
    await guest.getByLabel("Display name").fill("Sync guest");
    await expect(
      guest.getByRole("button", { name: "Join room →" }),
    ).toBeEnabled();
    await guest.getByRole("button", { name: "Join room →" }).click();
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await host.getByLabel("Seek playback").fill("22");
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(22, 1);
    await guest.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 22.1;
      v.playbackRate = 0.95;
    });
    await guest.getByRole("button", { name: "Sync me now" }).click();
    await expect(guest.locator("#sync-feedback")).toContainText(
      "Synced to the room",
    );
    const paused = await guest
      .locator("video")
      .evaluate((v: HTMLVideoElement) => ({
        position: v.currentTime,
        rate: v.playbackRate,
        paused: v.paused,
      }));
    expect(Math.abs(paused.position - 22)).toBeLessThan(0.03);
    expect(paused.rate).toBe(1);
    expect(paused.paused).toBe(true);
    await guest.locator("video").evaluate((v: HTMLVideoElement) => {
      (window as any).originalSyncPlay = v.play;
      v.play = () =>
        Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
    });
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Click to sync and play" }),
    ).toBeVisible();
    await guest.evaluate(() => {
      window.addEventListener(
        "click",
        () => {
          document.querySelector("video")!.play = (
            window as any
          ).originalSyncPlay;
        },
        { once: true, capture: true },
      );
    });
    await guest.getByRole("button", { name: "Sync me now" }).click();
    await expect(guest.locator("#sync-feedback")).toContainText(
      "Synced to the room",
    );
    await expect(
      guest.getByRole("button", { name: "Click to sync and play" }),
    ).toHaveCount(0);
    expect(
      await guest.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    ).toBe(false);
    expect(
      await guest.evaluate(() =>
        (window as any).syncCommands.filter((c: any) =>
          ["play", "pause", "seek"].includes(c.type),
        ),
      ),
    ).toEqual([]);
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await guest
      .getByRole("heading", { name: "Cinema Color Journey", level: 1 })
      .click();
    await guest.keyboard.press("s");
    await expect(guest.locator("#sync-feedback")).toContainText(
      "Synced to the room",
    );
    // Chat is the default; discovery and participants no longer stack beneath it.
    await expect(guest.getByLabel("Chat message")).toBeVisible();
    await expect(guest.getByLabel("Search movies")).toBeHidden();
    await expect(guest.getByLabel("Custom media URL")).toBeHidden();
    await guest.getByRole("button", { name: "Discover", exact: true }).click();
    await expect(guest.getByLabel("Search movies")).toBeVisible();
    await expect(guest.getByLabel("Chat message")).toBeHidden();
    await guest.getByRole("button", { name: /^People/ }).click();
    await expect(guest.locator(".participant").first()).toBeVisible();
    await guest.getByRole("button", { name: "Room", exact: true }).click();
    await expect(guest.getByLabel("Chat message")).toBeVisible();
    await guest.setViewportSize({ width: 390, height: 844 });
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: "evidence/room-clear-mobile.png",
      fullPage: true,
    });
    await host.screenshot({
      path: "evidence/room-clear-desktop.png",
      fullPage: true,
    });
  } finally {
    await a.close();
    await b.close();
  }
});

test("sync timeout and offline state are visible without claiming success", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.routeWebSocket("**/socket.io/**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (!String(message).includes('["sync",')) server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByLabel("Display name").fill("Network check");
    await expect(
      page.getByRole("button", { name: "＋ Create a room" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "＋ Create a room" }).click();
    await expect(page.locator("video")).toBeVisible();
    await page.getByRole("button", { name: "Sync me now" }).click();
    await expect(
      page.getByRole("button", { name: "Syncing…", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("#sync-feedback")).toContainText(
      "room did not respond",
      { timeout: 7000 },
    );
    await expect(
      page.getByRole("button", { name: "Sync me now" }),
    ).toBeEnabled();
    await context.setOffline(true);
    await expect(
      page.getByRole("button", { name: "Sync me now" }),
    ).toBeDisabled({ timeout: 20000 });
    await expect(page.locator(".connection")).toContainText("Reconnecting");
  } finally {
    await context.close();
  }
});
