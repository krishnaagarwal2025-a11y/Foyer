import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("two phone contexts stream compact audio on a slow HTTP connection without repeated stalls", async ({
  browser,
  baseURL,
}) => {
  const contexts = [],
    pages = [];
  const errors: string[] = [];
  const readings: any[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      contexts.push(context);
      await context.addInitScript(() => {
        const metric: any = ((window as any).phoneNetworkMetric = {
          room: null,
          offset: 0,
          waiting: 0,
          tracking: false,
        });
        window.addEventListener(
          "watchparty:state",
          (event) => (metric.room = (event as CustomEvent).detail.room),
        );
        window.addEventListener(
          "watchparty:clock",
          (event) => (metric.offset = (event as CustomEvent).detail.offset),
        );
        document.addEventListener(
          "waiting",
          (event) => {
            if (
              metric.tracking &&
              (event.target as HTMLElement)?.tagName === "AUDIO"
            )
              metric.waiting++;
          },
          true,
        );
      });
      const page = await context.newPage();
      pages.push(page);
      page.on("pageerror", (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      const code = i ? new URL(pages[0].url()).searchParams.get("room") : null;
      await page.goto(code ? `/?room=${code}` : "/");
      await page.getByLabel("Display name").fill(`Slow HTTP phone ${i + 1}`);
      if (!i)
        await page
          .getByRole("button", { name: "♪ Listen", exact: true })
          .click();
      await page
        .getByRole("button", { name: i ? "Join room →" : "＋ Create a room" })
        .click();
      // Warm the lazy player and discovery modules before measuring media.
      // Otherwise development JS competes with audio for the 100kbps budget.
      await expect(
        page.getByRole("heading", { name: "Find a song" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.locator("audio").evaluate((v: HTMLAudioElement) => v.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      expect(await page.locator("audio").getAttribute("src")).toBe(
        "/media/evening-keys.m4a",
      );
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 200,
        downloadThroughput: 12500,
        uploadThroughput: 6250,
      });
      const freshResponse = page.waitForResponse(
        (response) =>
          response.url().includes("network-probe=") &&
          response.request().resourceType() === "media",
      );
      await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
        const source = new URL(audio.src);
        source.searchParams.set("network-probe", crypto.randomUUID());
        audio.src = source.href;
        audio.load();
      });
      await Promise.all([
        freshResponse.then((response) => {
          expect([200, 206]).toContain(response.status());
          expect(response.fromServiceWorker()).toBe(false);
        }),
        expect
          .poll(
            () =>
              page
                .locator("audio")
                .evaluate((v: HTMLAudioElement) => v.readyState),
            { timeout: 20000 },
          )
          .toBeGreaterThanOrEqual(2),
      ]);
    }
    await pages[0].getByRole("button", { name: "Play", exact: true }).click();
    for (const page of pages)
      await expect
        .poll(
          () =>
            page
              .locator("audio")
              .evaluate(
                (v: HTMLAudioElement) => !v.paused && v.currentTime > 1,
              ),
          { timeout: 15000 },
        )
        .toBe(true);
    for (const page of pages)
      await page.evaluate(
        () => ((window as any).phoneNetworkMetric.tracking = true),
      );
    for (let n = 0; n < 5; n++) {
      await pages[0].waitForTimeout(2000);
      for (const page of pages) {
        const reading = await page.evaluate(() => {
          const v = document.querySelector<HTMLAudioElement>("audio")!,
            metric = (window as any).phoneNetworkMetric,
            r = metric.room;
          const expected = Math.min(
            r.media.duration,
            r.position +
              Math.max(
                0,
                performance.timeOrigin +
                  performance.now() +
                  metric.offset -
                  r.anchor,
              ) /
                1000,
          );
          return {
            position: v.currentTime,
            paused: v.paused,
            readyState: v.readyState,
            waitingEvents: metric.waiting,
            absoluteDriftMs: Math.abs(expected - v.currentTime) * 1000,
            mediaError: v.error?.message,
          };
        });
        readings.push(reading);
        expect(reading.paused).toBe(false);
        expect(reading.readyState).toBeGreaterThanOrEqual(2);
        expect(reading.waitingEvents).toBe(0);
        expect(reading.absoluteDriftMs).toBeLessThanOrEqual(500);
        expect(reading.mediaError).toBeUndefined();
      }
    }
    expect(errors).toEqual([]);
    writeFileSync(
      process.env.PHONE_NETWORK_REPORT || "evidence/phone-network-local.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          url: baseURL,
          passed: true,
          readings,
          pageErrors: errors,
          conditions:
            "Two isolated touch-emulated Chromium contexts, autoplay allowed, actual AAC local audio. After joining and warming the lazy player/discovery interface, HTTP requests are CDP-throttled to 100kbps download, 50kbps upload and 200ms latency. Cache is disabled and audio is reloaded with a unique query; an actual media HTTP response is required before measuring readiness. This isolates fresh media streaming rather than application startup; not proof of WebSocket latency, physical mobile/Safari or real cellular packet loss. Waiting events counted after playback reached one second; drift uses the app's four-timestamp server-clock estimate.",
        },
        null,
        2,
      ),
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
