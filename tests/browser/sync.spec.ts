import { loadDemo } from "./demo";
import { test, expect } from "@playwright/test";

test("host sync pauses both players, waits for every device, aligns and automatically resumes; guests cannot invoke it", async ({
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
    await host.getByRole("button", { name: "＋ Create a room" }).click();
    await loadDemo(host);
    await expect(host.locator("video")).toBeVisible();
    const code = new URL(host.url()).searchParams.get("room");
    await guest.goto("/?room=" + code);
    await guest.getByLabel("Display name").fill("Sync guest");
    await guest.getByRole("button", { name: "Join room →" }).click();
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await expect(
      guest.getByRole("button", { name: "Host controls sync" }),
    ).toBeDisabled();
    await guest.locator(".stage h1").click();
    await guest.keyboard.press("s");
    await expect(guest.locator("#sync-feedback")).toContainText(
      "Only the host",
    );
    await host.getByLabel("Seek playback").fill("22");
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(22, 1);
    await guest.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 22.12;
      v.playbackRate = 0.95;
      (window as any).holdReadiness = true;
      const getter = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "readyState",
      )!.get!;
      Object.defineProperty(v, "readyState", {
        configurable: true,
        get: () => ((window as any).holdReadiness ? 0 : getter.call(v)),
      });
    });
    await host.getByRole("button", { name: "Sync room" }).click();
    await expect(
      host.getByText("Room paused for synchronization", { exact: true }),
    ).toBeVisible();
    for (const page of [host, guest])
      expect(
        await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      ).toBe(true);
    await host.waitForTimeout(200);
    expect(
      await host.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    ).toBe(true);
    expect(
      await guest
        .locator("video")
        .evaluate((v: HTMLVideoElement) => v.playbackRate),
    ).toBe(1);
    await guest.evaluate(() => {
      (window as any).holdReadiness = false;
    });
    await expect(host.locator("#sync-feedback")).toContainText(
      "All 2 devices aligned",
      { timeout: 15000 },
    );
    for (const page of [host, guest])
      await expect
        .poll(() =>
          page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
        )
        .toBe(false);
    const rate = await guest
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.playbackRate);
    expect(rate).toBeGreaterThanOrEqual(0.95);
    expect(rate).toBeLessThanOrEqual(1.05);
    expect(
      await guest.evaluate(() =>
        (window as any).syncCommands.filter((c: any) =>
          ["play", "pause", "seek", "resync"].includes(c.type),
        ),
      ),
    ).toEqual([]);
    // An explicit cancellation must be handled while the long check is pending.
    await guest.evaluate(() => {
      (window as any).holdReadiness = true;
    });
    await host.getByRole("button", { name: "Sync room" }).click();
    await host.getByRole("button", { name: "Cancel sync" }).click();
    await expect(host.locator("#sync-feedback")).toContainText("cancelled", {
      timeout: 5000,
    });
    expect(
      await guest.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    ).toBe(true);
    await guest.evaluate(() => {
      (window as any).holdReadiness = false;
    });
    // Paused sync is also a synchronized start, rather than a guest local seek.
    await host.locator(".stage h1").click();
    await host.keyboard.press("s");
    await expect(host.locator("#sync-feedback")).toContainText(
      "All 2 devices aligned",
      { timeout: 15000 },
    );
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    // Guest autoplay permission remains local, distinct from host room sync.
    await guest.locator("video").evaluate((v: HTMLVideoElement) => {
      (window as any).originalPlay = v.play;
      v.play = () =>
        Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
    });
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Enable playback on this device" }),
    ).toBeVisible();
    await guest.locator("video").evaluate((v: HTMLVideoElement) => {
      v.play = (window as any).originalPlay;
    });
    await guest
      .getByRole("button", { name: "Enable playback on this device" })
      .click();
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(false);
    await expect(
      guest.getByRole("button", { name: "Enable playback on this device" }),
    ).toBeHidden();
  } finally {
    await a.close();
    await b.close();
  }
});

test("sync response timeout and offline state remain explicit", async ({
  browser,
}) => {
  const c = await browser.newContext();
  await c.routeWebSocket("**/socket.io/**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (!String(message).includes('["sync",')) server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const page = await c.newPage();
  try {
    await page.goto("/");
    await page.getByLabel("Display name").fill("Network check");
    await page.getByRole("button", { name: "＋ Create a room" }).click();
    await loadDemo(page);
    await page.getByRole("button", { name: "Sync room" }).click();
    await expect(
      page.getByRole("button", { name: "Syncing…", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("#sync-feedback")).toContainText(
      "room did not respond",
      { timeout: 20000 },
    );
    await expect(page.getByRole("button", { name: "Sync room" })).toBeEnabled();
    await c.setOffline(true);
    await expect(page.getByRole("button", { name: "Sync room" })).toBeDisabled({
      timeout: 20000,
    });
    await expect(page.locator(".connection")).toContainText("Reconnecting");
  } finally {
    await c.close();
  }
});

test("light and dark themes persist, use restrained controls and remain readable on phones", async ({
  browser,
}) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await c.newPage();
  try {
    await page.goto("/");
    if (
      await page
        .getByRole("button", { name: "Switch to light theme" })
        .isVisible()
    )
      await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByLabel("Display name").fill("Theme check");
    await page.getByRole("button", { name: "＋ Create a room" }).click();
    await loadDemo(page);
    await expect(page.locator("video")).toBeVisible();
    await expect(page.locator(".theme-toggle")).toHaveCSS(
      "border-radius",
      "3px",
    );
    for (const width of [320, 390, 844]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: "evidence/theme-light-phone.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.waitForTimeout(150);
    await page.screenshot({
      path: "evidence/theme-dark-phone.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({
      path: "evidence/theme-dark-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.waitForTimeout(150);
    await page.screenshot({
      path: "evidence/theme-light-desktop.png",
      fullPage: true,
    });
  } finally {
    await c.close();
  }
});
