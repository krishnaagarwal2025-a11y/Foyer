import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// Deterministic asynchronous IFrame API fixture. This checks Foyer's integration
// and feedback-loop handling, not YouTube's network/DRM/embed availability.
async function installYouTube(context: BrowserContext) {
  await context.addInitScript(() => {
    const fixture: any = ((window as any).youtubeFixture = {
      instances: [],
      commands: [],
      blocked: false,
      deferredMethods: false,
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
          this.timer = setTimeout(() => this.emit(1), 500);
        }
        pauseVideo() {
          clearTimeout(this.timer);
          this.emit(2);
        }
        seekTo(time: number) {
          this.seeks++;
          const resume = this.state === 1;
          this.position = time;
          this.anchor = performance.now();
          this.emit(3);
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.emit(resume ? 1 : 2), 200);
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
      count: f.instances.length,
      position: p?.getCurrentTime(),
      commands: f.commands.filter((c: any) =>
        ["play", "pause", "seek"].includes(c.type),
      ),
    };
  });

test("YouTube buffering settles, native host actions synchronize, retry rebuilds and Music links join Listen", async ({
  browser,
}) => {
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
      host.getByRole("button", { name: "Click to sync and play" }),
    ).toBeVisible();
    await host.evaluate(() => {
      (window as any).youtubeFixture.blocked = false;
    });
    await host.getByRole("button", { name: "Sync me now" }).click();
    await expect.poll(async () => (await fixtureState(host)).state).toBe(1);
    await expect(host.locator("#sync-feedback")).toContainText(
      "Synced to the room",
    );
    // A provider error leaves retry visible; retry must destroy/recreate the iframe.
    await host.evaluate(() =>
      (window as any).youtubeFixture.instances
        .at(-1)
        .options.events.onError({ data: 100 }),
    );
    await host.getByRole("button", { name: "Sync me now" }).click();
    await expect(host.locator("#sync-feedback")).toContainText(
      "source is unavailable",
    );
    await host.getByRole("button", { name: "Retry source" }).click();
    await expect.poll(async () => (await fixtureState(host)).count).toBe(2);
    expect(
      await host.evaluate(
        () => (window as any).youtubeFixture.instances[0].destroyed,
      ),
    ).toBe(true);
    await host.getByRole("button", { name: "♪ Listen", exact: true }).click();
    await expect(host.getByLabel("YouTube Music song URL")).toBeVisible();
    await a.route("https://music.youtube.com/search**", (route) =>
      route.fulfill({
        body: "YouTube Music search fixture",
        contentType: "text/html",
      }),
    );
    await host.getByLabel("Search songs").fill("finding her");
    const popupPromise = host.waitForEvent("popup");
    await host
      .getByRole("button", { name: "Search YouTube Music ↗", exact: true })
      .click();
    const searchPage = await popupPromise;
    await expect(searchPage).toHaveURL(
      "https://music.youtube.com/search?q=finding%20her",
    );
    await searchPage.close();
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
    await guest.getByRole("button", { name: "Sync me now" }).click();
    await expect(guest.locator("#sync-feedback")).toContainText(
      "Synced to the room",
    );
    expect(errors).toEqual([]);
  } finally {
    if (errors.length) console.error("Song-switch browser errors:", errors);
    await a.close();
    await b.close();
  }
});
