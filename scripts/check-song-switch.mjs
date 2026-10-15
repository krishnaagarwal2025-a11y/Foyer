import { chromium, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("evidence", { recursive: true });

// Real provider playback, separate from the SDK timing fixture. Reuse the public
// API demo with fresh revisions to exercise cached SDK mounts; this makes no
// claim about every song's embedding/license availability.
const report = {
  url: process.env.DEMO_URL || "http://localhost:3001",
  checkedAt: new Date().toISOString(),
  passed: false,
  switches: [],
  pageErrors: [],
  conditions:
    "One Chromium mobile/touch context (390×844), autoplay allowed. Public YouTube API demo repeatedly loaded under fresh room revisions, then local audio and back to YouTube. Not a physical phone or performance benchmark.",
};
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.goto(report.url);
  await page.getByLabel("Display name").fill("Live song switch check");
  await page.getByRole("button", { name: "＋ Create a room" }).click();
  await page.locator(".source-panel > summary").click();
  const sources = [
    {
      title: "YouTube revision one",
      url: "https://music.youtube.com/watch?v=M7lc1UVf-VE",
      player: "youtube",
    },
    {
      title: "YouTube revision two",
      url: "https://music.youtube.com/watch?v=M7lc1UVf-VE",
      player: "youtube",
    },
    {
      title: "Local audio interlude",
      url: new URL("/media/evening-keys.wav", report.url).href,
      player: "audio",
    },
    {
      title: "YouTube after audio",
      url: "https://music.youtube.com/watch?v=M7lc1UVf-VE",
      player: "youtube",
    },
  ];
  for (const source of sources) {
    await page.getByLabel("Custom media title").fill(source.title);
    await page.getByLabel("Custom media URL").fill(source.url);
    await page.getByRole("button", { name: "Load video", exact: true }).click();
    await page.getByRole("heading", { name: source.title, level: 1 }).waitFor();
    const media =
      source.player === "youtube"
        ? page.frameLocator(".provider-frame iframe").locator("video")
        : page.locator("audio");
    await media.waitFor({ state: "attached", timeout: 30000 });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    // Wait on the actual source rather than a displayed timeline that may still
    // be transitioning when a new media element has just been mounted.
    await expect
      .poll(
        () =>
          media.evaluate(
            (video) =>
              !video.paused && video.readyState >= 2 && video.currentTime > 2,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    const state = await media.evaluate((video) => ({
      currentTime: video.currentTime,
      paused: video.paused,
      readyState: video.readyState,
      ...(video instanceof HTMLVideoElement
        ? { width: video.videoWidth, height: video.videoHeight }
        : {}),
    }));
    if (state.paused || state.readyState < 2 || state.currentTime < 1)
      throw Error(`${source.title}: provider did not play`);
    if (await page.locator(".provider-loading[role=alert]").count())
      throw Error("Player boundary recovered a failure during a normal switch");
    report.switches.push({
      title: source.title,
      player: source.player,
      ...state,
    });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
  }
  await page.getByRole("button", { name: "Sync room" }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#sync-feedback")
        ?.textContent.includes("devices aligned"),
    undefined,
    { timeout: 15000 },
  );
  report.manualSyncConfirmed = true;
  if (report.pageErrors.length)
    throw Error("Uncaught browser errors during switching");
  await page.locator(".stage h1").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "evidence/phone-youtube-switch.png",
    fullPage: true,
    timeout: 15000,
  });
  report.passed = true;
} catch (error) {
  report.error = String(error.message).split("\n")[0];
} finally {
  await browser.close();
  report.completedAt = new Date().toISOString();
  writeFileSync(
    process.env.SONG_SWITCH_REPORT || "evidence/song-switch-local.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
