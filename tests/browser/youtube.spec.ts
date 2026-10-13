import { loadDemo } from "./demo";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createApplication } from "../../server/app";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Deterministic asynchronous IFrame API fixture. This checks Foyer's integration
// and feedback-loop handling, not YouTube's network/DRM/embed availability.
async function installYouTube(context: BrowserContext) {
  await context.addInitScript(() => {
    const fixture: any = ((window as any).youtubeFixture = {
      instances: [],
      commands: [],
      blocked: false,
      deferredMethods: false,
      playDelayMs: 500,
      seekDelayMs: 200,
      deferSeekPosition: false,
    });
    window.addEventListener("watchparty:command", (event) =>
      fixture.commands.push((event as CustomEvent).detail.command),
    );
    (window as any).YT = {
      Player: class {
        state = 5;
        position = 0;
        anchor = performance.now();
        plays = 0;
        seeks = 0;
        destroyed = false;
        muted: boolean | undefined;
        timer: ReturnType<typeof setTimeout> | undefined;
        iframe = document.createElement("iframe");
        constructor(
          el: HTMLElement,
          public options: any,
        ) {
          fixture.instances.push(this);
          this.iframe.title = "YouTube API fixture";
          this.iframe.srcdoc =
            "<body style='background:#16121f;color:white'>Asynchronous YouTube player fixture</body>";
          el.replaceWith(this.iframe);
          // The real API installs volume methods only after iframe readiness.
          // Cached SDK loading makes this race more likely on song changes.
          const mute = this.mute.bind(this),
            unMute = this.unMute.bind(this);
          if (fixture.deferredMethods) {
            (this as any).mute = undefined;
            (this as any).unMute = undefined;
          }
          setTimeout(
            () => {
              this.mute = mute;
              this.unMute = unMute;
              options.events.onReady({ target: this });
            },
            fixture.deferredMethods ? 250 : 20,
          );
        }
        emit(state: number) {
          this.position = this.getCurrentTime();
          this.anchor = performance.now();
          this.state = state;
          this.options.events.onStateChange({ data: state });
        }
        playVideo() {
          this.plays++;
          if (fixture.blocked) {
            setTimeout(() => this.options.events.onAutoplayBlocked(), 20);
            return;
          }
          clearTimeout(this.timer);
          this.emit(3);
          this.timer = setTimeout(() => this.emit(1), fixture.playDelayMs);
        }
        pauseVideo() {
          clearTimeout(this.timer);
          this.emit(2);
        }
        seekTo(time: number) {
          this.seeks++;
          const resume = this.state === 1;
          if (!fixture.deferSeekPosition) {
            this.position = time;
            this.anchor = performance.now();
          }
          this.emit(3);
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            if (fixture.deferSeekPosition) {
              this.position = time;
              this.anchor = performance.now();
            }
            this.emit(resume ? 1 : 2);
          }, fixture.seekDelayMs);
        }
        getCurrentTime() {
          return (
            this.position +
            (this.state === 1 ? (performance.now() - this.anchor) / 1000 : 0)
          );
        }
        getDuration() {
          if (this.destroyed)
            throw Error("Discarded player accessed after song change");
          return 255;
        }
        getPlayerState() {
          return this.state;
        }
        mute() {
          this.muted = true;
        }
        unMute() {
          this.muted = false;
        }
        destroy() {
          this.destroyed = true;
          clearTimeout(this.timer);
          this.iframe.remove();
        }
      },
    };
  });
}
async function enter(page: Page, name: string, code?: string) {
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
}
const fixtureState = (page: Page) =>
  page.evaluate(() => {
    const f = (window as any).youtubeFixture,
      p = f.instances.at(-1);
    return {
      state: p?.state,
      plays: p?.plays,
      seeks: p?.seeks,
      count: f.instances.length,
      position: p?.getCurrentTime(),
      commands: f.commands.filter((c: any) =>
        ["play", "pause", "seek"].includes(c.type),
      ),
    };
  });

test("host sync holds the local pause while the authoritative pause crosses the network", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await installYouTube(context);
  await context.routeWebSocket("**/socket.io/**", (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (String(message).includes('["sync",'))
        setTimeout(() => server.send(message), 500);
      else server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  const host = await context.newPage();
  try {
    await enter(host, "Pause hold host");
    await host.locator(".source-panel > summary").click();
    await host.getByLabel("Custom media title").fill("Pause hold fixture");
    await host
      .getByLabel("Custom media URL")
      .fill("https://www.youtube.com/watch?v=abcdefghijk");
    await host.getByRole("button", { name: "Load video", exact: true }).click();
    await expect(host.getByTitle("YouTube API fixture")).toBeVisible();
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await fixtureState(host)).state).toBe(1);
    const before = (await fixtureState(host)).plays;
    await host.getByRole("button", { name: "Sync room" }).click();
    await host.waitForTimeout(300);
    expect((await fixtureState(host)).plays).toBe(before);
    expect((await fixtureState(host)).state).toBe(2);
    await expect(host.locator("#sync-feedback")).toContainText(
      "All 1 devices aligned",
      { timeout: 18000 },
    );
    await expect.poll(async () => (await fixtureState(host)).state).toBe(1);
    expect((await fixtureState(host)).plays).toBe(before + 1);
  } finally {
    await context.close();
  }
});

test("concurrent room checks do not cancel an in-flight paused provider seek", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  for (const context of [a, b]) {
    await installYouTube(context);
    await context.addInitScript(() => {
      (window as any).youtubeFixture.deferSeekPosition = true;
      (window as any).youtubeFixture.seekDelayMs = 600;
    });
  }
  const host = await a.newPage(),
    guest = await b.newPage();
  try {
    const code = await enter(host, "Paused-seek host");
    await enter(guest, "Paused-seek guest", code);
    await host.locator(".source-panel > summary").click();
    await host.getByLabel("Custom media title").fill("Deferred paused seek");
    await host
      .getByLabel("Custom media URL")
      .fill("https://www.youtube.com/watch?v=abcdefghijk");
    await host.getByRole("button", { name: "Load video", exact: true }).click();
    for (const page of [host, guest])
      await expect(page.getByTitle("YouTube API fixture")).toBeVisible();
    await guest.evaluate(() => {
      const player = (window as any).youtubeFixture.instances.at(-1);
      player.position = 5;
      player.anchor = performance.now();
      player.emit(2);
    });
    await host.getByRole("button", { name: "Sync room" }).click();
    await expect(host.locator("#sync-feedback")).toContainText(
      "All 2 devices aligned",
      { timeout: 18000 },
    );
    for (const page of [host, guest])
      await expect.poll(async () => (await fixtureState(page)).state).toBe(1);
    expect((await fixtureState(guest)).commands).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test("slow phone playback is not labelled autoplay-blocked and automatic correction gives buffering time to settle", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await installYouTube(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await enter(page, "Slow phone");
    await page.evaluate(() => {
      (window as any).youtubeFixture.playDelayMs = 10000;
      (window as any).youtubeFixture.seekDelayMs = 1200;
    });
    await page.locator(".source-panel > summary").click();
    await page.getByLabel("Custom media title").fill("Slow connection fixture");
    await page
      .getByLabel("Custom media URL")
      .fill("https://www.youtube.com/watch?v=abcdefghijk");
    await page.getByRole("button", { name: "Load video", exact: true }).click();
    await expect(page.getByTitle("YouTube API fixture")).toBeVisible();
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForTimeout(8500);
    await expect(
      page.getByRole("button", { name: "Enable playback on this device" }),
    ).not.toBeVisible();
    expect((await fixtureState(page)).plays).toBe(1);
    await expect
      .poll(async () => (await fixtureState(page)).seeks, { timeout: 12000 })
      .toBe(1);
    await page.waitForTimeout(2900);
    expect((await fixtureState(page)).seeks).toBe(1);
    expect((await fixtureState(page)).state).toBe(1);
    // Host intent must not be delayed by the automatic-correction cooldown.
    await page.getByLabel("Seek playback").fill("40");
    await expect
      .poll(async () => (await fixtureState(page)).seeks, { timeout: 2000 })
      .toBe(2);
    await expect.poll(async () => (await fixtureState(page)).state).toBe(1);
    await page.getByRole("button", { name: "Sync room" }).click();
    await expect(page.locator("#sync-feedback")).toContainText(
      "All 1 devices aligned",
      { timeout: 18000 },
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: "evidence/phone-buffer-recovery.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});

test("YouTube buffering settles, native host actions synchronize, retry rebuilds and Music links join Listen", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  await installYouTube(a);
  await installYouTube(b);
  const host = await a.newPage(),
    guest = await b.newPage();
  try {
    const code = await enter(host, "YouTube host");
    await enter(guest, "YouTube guest", code);
    await host.getByRole("button", { name: "Discover", exact: true }).click();
    await host.setViewportSize({ width: 714, height: 659 });
    const layout = await host.evaluate(() => ({
      playerBottom: document.querySelector(".player")!.getBoundingClientRect()
        .bottom,
      discoveryTop: document
        .querySelector(".sidebar .discovery")!
        .getBoundingClientRect().top,
    }));
    expect(layout.discoveryTop).toBeGreaterThan(layout.playerBottom);
    expect(
      await host.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await host.screenshot({
      path: "evidence/room-tablet-layout.png",
      fullPage: true,
    });
    await host.setViewportSize({ width: 1280, height: 720 });
    await host.locator(".source-panel > summary").click();
    await host.getByLabel("Custom media title").fill("Song fixture");
    await host
      .getByLabel("Custom media URL")
      .fill("https://www.youtube.com/watch?v=abcdefghijk");
    await host.getByRole("button", { name: "Load video", exact: true }).click();
    await expect(host.getByTitle("YouTube API fixture")).toBeVisible();
    const bounds = await host.evaluate(() => ({
      player: document.querySelector(".player")!.getBoundingClientRect().width,
      iframe: document
        .querySelector(".provider-frame iframe")!
        .getBoundingClientRect().width,
    }));
    expect(Math.abs(bounds.player - bounds.iframe)).toBeLessThan(3);
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await fixtureState(guest)).state).toBe(1);
    expect((await fixtureState(host)).plays).toBe(1);
    expect(
      (await fixtureState(host)).commands.filter((c: any) => c.type === "play"),
    ).toHaveLength(1);
    expect((await fixtureState(guest)).commands).toHaveLength(0);
    await host.evaluate(() =>
      (window as any).youtubeFixture.instances.at(-1).emit(2),
    );
    await expect(
      host.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await expect.poll(async () => (await fixtureState(guest)).state).toBe(2);
    await expect.poll(async () => (await fixtureState(host)).state).toBe(2);
    // Pausing also reconciles the paused timeline through a 200-ms fixture seek.
    // Native controls are acted on after that pending correction has settled.
    await host.waitForTimeout(350);
    await host.evaluate(() =>
      (window as any).youtubeFixture.instances.at(-1).emit(1),
    );
    await expect(
      host.getByRole("button", { name: "Pause", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(async () => ({
        host: await fixtureState(host),
        guest: await fixtureState(guest),
      }))
      .toMatchObject({ guest: { state: 1 } });
    // Native seeks are recognized after the programmatic transition guard.
    await host.waitForTimeout(1600);
    await host.evaluate(() => {
      const player = (window as any).youtubeFixture.instances.at(-1);
      player.position = 20;
      player.anchor = performance.now();
    });
    await expect
      .poll(
        async () =>
          (await fixtureState(host)).commands.filter(
            (c: any) => c.type === "seek",
          ).length,
      )
      .toBe(1);
    await expect
      .poll(async () =>
        Math.abs(
          (await fixtureState(host)).position -
            (await fixtureState(guest)).position,
        ),
      )
      .toBeLessThan(0.5);
    await guest.reload();
    await guest
      .getByRole("button", { name: "Join room →", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Song fixture", level: 1 }),
    ).toBeVisible();
    await expect.poll(async () => (await fixtureState(guest)).state).toBe(1);
    await expect
      .poll(async () =>
        Math.abs(
          (await fixtureState(host)).position -
            (await fixtureState(guest)).position,
        ),
      )
      .toBeLessThan(0.5);
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await fixtureState(host)).state).toBe(2);
    await host.evaluate(() => {
      (window as any).youtubeFixture.blocked = true;
    });
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect(
      host.getByRole("button", { name: "Enable playback on this device" }),
    ).toBeVisible();
    await host.evaluate(() => {
      (window as any).youtubeFixture.blocked = false;
    });
    await host
      .getByRole("button", { name: "Enable playback on this device" })
      .click();
    await expect(
      host.getByRole("button", { name: "Enable playback on this device" }),
    ).toBeHidden();
    await host.getByRole("button", { name: "Sync room" }).click();
    await expect.poll(async () => (await fixtureState(host)).state).toBe(1);
    await expect(host.locator("#sync-feedback")).toContainText(
      "devices aligned",
    );
    // A provider error leaves retry visible; retry must destroy/recreate the iframe.
    await host.evaluate(() =>
      (window as any).youtubeFixture.instances
        .at(-1)
        .options.events.onError({ data: 100 }),
    );
    await host.getByRole("button", { name: "Sync room" }).click();
    await expect(host.locator("#sync-feedback")).toContainText("Not ready", {
      timeout: 15000,
    });
    await host.getByRole("button", { name: "Retry source" }).click();
    await expect.poll(async () => (await fixtureState(host)).count).toBe(2);
    expect(
      await host.evaluate(
        () => (window as any).youtubeFixture.instances[0].destroyed,
      ),
    ).toBe(true);
    await host.getByRole("button", { name: "♪ Listen", exact: true }).click();
    await host.locator(".song-link-fallback > summary").click();
    await host
      .getByLabel("YouTube Music song URL")
      .fill("https://media.example/song.mp3");
    await host.getByRole("button", { name: "Queue song", exact: true }).click();
    await expect(host.locator(".music-discovery [role=alert]")).toContainText(
      "individual YouTube",
    );
    await host.getByLabel("YouTube Music song title").fill("Music fixture");
    await host
      .getByLabel("YouTube Music song URL")
      .fill("https://music.youtube.com/watch?v=abcdefghijk");
    await host.getByRole("button", { name: "Queue song", exact: true }).click();
    await expect(
      guest.getByRole("button", { name: "Queue 1", exact: true }),
    ).toBeVisible();
    await host.getByRole("button", { name: "Play song", exact: true }).click();
    await expect(
      guest.getByRole("heading", { name: "Music fixture", level: 1 }),
    ).toBeVisible();
    await expect(guest.getByTitle("YouTube API fixture")).toBeVisible();
    await host.screenshot({
      path: "evidence/youtube-music-layout.png",
      fullPage: true,
    });
  } catch (error) {
    console.error(
      "YouTube integration fixture state",
      JSON.stringify({
        host: await fixtureState(host),
        guest: await fixtureState(guest),
        hostMessage: await host.locator(".video-message").allTextContents(),
        guestMessage: await guest.locator(".video-message").allTextContents(),
      }),
    );
    throw error;
  } finally {
    await a.close();
    await b.close();
  }
});

test("changing songs with a cached YouTube SDK never blanks host or guest", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await installYouTube(a);
  await installYouTube(b);
  const host = await a.newPage(),
    guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest])
    page.on("pageerror", (e) => errors.push(e.message));
  try {
    const code = await enter(host, "Song host");
    await enter(guest, "Song guest", code);
    for (const page of [host, guest])
      await page.evaluate(() => {
        (window as any).youtubeFixture.deferredMethods = true;
      });
    await host.getByRole("button", { name: "♪ Listen", exact: true }).click();
    await host.getByRole("button", { name: "Discover", exact: true }).click();
    await host.locator(".song-link-fallback > summary").click();
    for (let i = 0; i < 4; i++) {
      await host.getByLabel("YouTube Music song title").fill(`Song ${i + 1}`);
      await host
        .getByLabel("YouTube Music song URL")
        .fill(`https://music.youtube.com/watch?v=abcdefghij${i}`);
      await host
        .getByRole("button", { name: "Play song", exact: true })
        .click();
      for (const page of [host, guest]) {
        await expect(
          page.getByRole("heading", { name: `Song ${i + 1}`, level: 1 }),
        ).toBeVisible();
        await expect(page.getByTitle("YouTube API fixture")).toBeVisible();
        await expect(page.getByLabel("Seek playback")).toHaveValue("0");
      }
      // Change mute while the new iframe is still loading, then switch again.
      await host.getByRole("button", { name: "Toggle sound" }).click();
    }
    await expect.poll(async () => (await fixtureState(host)).count).toBe(4);
    await expect
      .poll(() =>
        host.evaluate(
          () => (window as any).youtubeFixture.instances.at(-1).muted,
        ),
      )
      .toBe(false);
    expect(
      await host.evaluate(
        () =>
          (window as any).youtubeFixture.instances.filter(
            (p: any) => p.destroyed,
          ).length,
      ),
    ).toBe(3);
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect.poll(async () => (await fixtureState(guest)).state).toBe(1);
    await host.getByRole("button", { name: "Sync room" }).click();
    await expect(host.locator("#sync-feedback")).toContainText(
      "devices aligned",
    );
    expect(errors).toEqual([]);
  } finally {
    if (errors.length) console.error("Song-switch browser errors:", errors);
    await a.close();
    await b.close();
  }
});

test("in-app music search plays a selected result across the room without a new tab or copied link", async ({
  browser,
}) => {
  const directory = mkdtempSync(path.join(tmpdir(), "foyer-test-search-"));
  const app = await createApplication({
    dataDirectory: directory,
    musicSearch: async () => [
      {
        id: "youtube:M7lc1UVf-VE",
        sourceId: "M7lc1UVf-VE",
        provider: "youtube",
        kind: "video",
        title: "In-app search fixture",
        artist: "Fixture artist",
        artwork: "/foyer.svg",
        duration: 255,
        genres: ["Music"],
        tags: [],
        description: "Deterministic metadata fixture",
        color: "#777",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      },
    ],
  });
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.http.address() as any).port}`;
  const a = await browser.newContext(),
    b = await browser.newContext();
  await installYouTube(a);
  await installYouTube(b);
  const host = await a.newPage(),
    guest = await b.newPage();
  const errors: string[] = [];
  for (const page of [host, guest])
    page.on("pageerror", (error) => errors.push(error.message));
  try {
    await host.goto(base);
    await host.getByLabel("Display name").fill("Search host");
    await host.getByRole("button", { name: "＋ Create a room" }).click();
    await loadDemo(host);
    await expect(host.locator("video")).toBeVisible();
    const code = new URL(host.url()).searchParams.get("room")!;
    await guest.goto(base + "/?room=" + code);
    await guest.getByLabel("Display name").fill("Search guest");
    await guest.getByRole("button", { name: "Join room →" }).click();
    await host.getByRole("button", { name: "♪ Listen", exact: true }).click();
    for (const page of [host, guest]) {
      await page.getByRole("button", { name: "Discover", exact: true }).click();
      await page.getByLabel("Search songs").fill("fixture");
      await page
        .getByRole("button", { name: "Search music", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Play In-app search fixture" }),
      ).toBeVisible();
    }
    await expect(
      guest.getByRole("button", { name: "Play In-app search fixture" }),
    ).toBeDisabled();
    await guest
      .getByRole("button", { name: "Queue In-app search fixture" })
      .click();
    await expect.poll(() => app.engine.rooms.get(code)!.queue.length).toBe(1);
    await host
      .getByRole("button", { name: "Play In-app search fixture" })
      .click();
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("heading", { name: "In-app search fixture", level: 1 }),
      ).toBeVisible();
      await expect.poll(async () => (await fixtureState(page)).state).toBe(1);
    }
    for (const page of [host, guest]) {
      await expect(
        page.locator(".provider-listen .listening-disc img"),
      ).toHaveAttribute("src", "/foyer.svg");
      await expect(page.locator(".listening-disc")).toHaveCSS(
        "animation-play-state",
        "running",
      );
      for (const width of [920, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await page
          .locator(".provider-frame iframe")
          .boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(200);
        expect(bounds!.height).toBeGreaterThanOrEqual(200);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
    }
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    for (const page of [host, guest])
      await expect(page.locator(".listening-disc")).toHaveCSS(
        "animation-play-state",
        "paused",
      );
    await host.screenshot({
      path: "evidence/youtube-disc-phone.png",
      fullPage: true,
    });
    await host.setViewportSize({ width: 1440, height: 960 });
    expect(a.pages()).toHaveLength(1);
    expect(b.pages()).toHaveLength(1);
    expect(errors).toEqual([]);
    await host.screenshot({
      path: "evidence/music-search-integrated.png",
      fullPage: true,
    });
  } finally {
    await a.close();
    await b.close();
    await app.close();
    if (
      path
        .resolve(directory)
        .startsWith(path.resolve(tmpdir(), "foyer-test-search-"))
    )
      rmSync(directory, { recursive: true, force: true });
  }
});
