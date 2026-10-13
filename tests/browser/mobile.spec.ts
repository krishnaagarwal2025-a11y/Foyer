import { loadDemo } from "./demo";
import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

test("phone layouts fit at 320–430px and landscape while songs, sync and chat work", async ({
  browser,
  baseURL,
}) => {
  const a = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const b = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const host = await a.newPage(),
    guest = await b.newPage();
  const errors: string[] = [],
    layouts: unknown[] = [];
  for (const page of [host, guest])
    page.on("pageerror", (e) => errors.push(e.message));
  const fits = async (page: Page, label: string) => {
    const layout = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>(".app *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
        })
        .map((el) => ({ tag: el.tagName, class: el.className }))
        .slice(0, 8),
    }));
    layouts.push({ label, ...layout });
    expect(
      layout.document,
      `${label}: ${JSON.stringify(layout.overflowing)}`,
    ).toBeLessThanOrEqual(layout.viewport);
  };
  const enter = async (page: Page, name: string, code?: string) => {
    await page.goto(code ? `/?room=${code}` : "/");
    await page.getByLabel("Display name").fill(name);
    await page
      .getByRole("button", { name: code ? "Join room →" : "＋ Create a room" })
      .click();
    if (!code) await loadDemo(page);
    await expect(
      page.getByRole("heading", { name: "Cinema Color Journey", level: 1 }),
    ).toBeVisible();
    return new URL(page.url()).searchParams.get("room")!;
  };
  try {
    const code = await enter(host, "Phone host");
    await enter(guest, "Phone guest", code);
    await host.getByRole("button", { name: "♪ Listen", exact: true }).tap();
    await host.locator(".source-panel > summary").tap();
    for (const title of [
      "Phone melody one",
      "Phone melody two",
      "Phone melody three",
    ]) {
      await host.getByLabel("Custom media title").fill(title);
      // One original demo composition reloaded under different source revisions.
      await host
        .getByLabel("Custom media URL")
        .fill(
          new URL(
            `/media/evening-keys.wav?take=${encodeURIComponent(title)}`,
            baseURL,
          ).href,
        );
      await host.getByRole("button", { name: "Play audio", exact: true }).tap();
      for (const page of [host, guest]) {
        await expect(
          page.getByRole("heading", { name: title, level: 1 }),
        ).toBeVisible();
        await expect
          .poll(
            () =>
              page
                .locator("audio")
                .evaluate((v: HTMLAudioElement) => v.readyState),
            { timeout: 20000 },
          )
          .toBeGreaterThanOrEqual(2);
      }
      await host.getByRole("button", { name: "Play", exact: true }).tap();
      await expect
        .poll(() =>
          guest.locator("audio").evaluate((v: HTMLAudioElement) => v.paused),
        )
        .toBe(false);
    }
    await host.locator(".source-panel > summary").tap();
    await expect(
      guest.getByRole("button", { name: "Host controls sync" }),
    ).toBeDisabled();
    await host.getByRole("button", { name: "Sync room" }).tap();
    await expect(host.locator("#sync-feedback")).toContainText(
      "devices aligned",
    );
    await host.getByRole("button", { name: "Pause", exact: true }).tap();
    await host.getByRole("button", { name: "Room", exact: true }).tap();
    await host
      .getByLabel("Chat message")
      .fill("A phone listening room works 🎵");
    await host.getByRole("button", { name: "Send message" }).tap();
    await expect(guest.locator(".chat-messages")).toContainText(
      "A phone listening room works 🎵",
    );
    for (const width of [320, 360, 390, 430]) {
      await host.setViewportSize({ width, height: 844 });
      for (const view of ["Room", "Discover", "People"]) {
        await host
          .getByRole("button", {
            name: view === "People" ? /^People/ : view,
            exact: view !== "People",
          })
          .tap();
        await fits(host, `${width}px ${view}`);
      }
      await host.locator(".source-panel > summary").tap();
      await fits(host, `${width}px Add link`);
      expect(
        await host
          .getByLabel("Custom media URL")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("16px");
      await host.locator(".source-panel > summary").tap();
      const controls = await host
        .locator(".transport button, .reaction-bar button, .sidebar-nav button")
        .evaluateAll((elements) =>
          elements.map((el) => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
          }),
        );
      expect(controls.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
    }
    await host.setViewportSize({ width: 844, height: 390 });
    await fits(host, "844px landscape");
    await host.setViewportSize({ width: 390, height: 844 });
    await host.getByRole("button", { name: "Room", exact: true }).tap();
    await host.locator(".stage h1").scrollIntoViewIfNeeded();
    await host.screenshot({
      path: "evidence/phone-listening-room.png",
      fullPage: true,
    });
    await host.getByRole("button", { name: "Discover", exact: true }).tap();
    await host.screenshot({
      path: "evidence/phone-music-discovery.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
    writeFileSync(
      process.env.MOBILE_REPORT || "evidence/mobile-verification-local.json",
      JSON.stringify(
        {
          url: baseURL,
          checkedAt: new Date().toISOString(),
          passed: true,
          layouts,
          pageErrors: errors,
          conditions:
            "Two isolated Chromium contexts with mobile/touch emulation, autoplay allowed, actual bundled demo audio playback. Not a physical iPhone/Android or Safari test.",
          mediaLoadingTimeoutMs: 20000,
        },
        null,
        2,
      ),
    );
  } catch (failure) {
    console.error(
      "Phone media diagnostics",
      await Promise.all(
        [host, guest].map((page) =>
          page
            .locator("audio")
            .evaluate((v: HTMLAudioElement) => ({
              src: v.src,
              currentSrc: v.currentSrc,
              readyState: v.readyState,
              networkState: v.networkState,
              error: v.error?.message,
            }))
            .catch(() => null),
        ),
      ),
    );
    throw failure;
  } finally {
    await a.close();
    await b.close();
  }
});
