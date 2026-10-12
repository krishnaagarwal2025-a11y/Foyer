import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const report = {
  startedAt: new Date().toISOString(),
  source:
    process.env.YOUTUBE_TEST_URL ||
    "https://www.youtube.com/watch?v=M7lc1UVf-VE",
  url: process.env.DEMO_URL || "http://127.0.0.1:3001",
  passed: false,
  limitations:
    "Live external-service smoke test, one Chromium page on localhost. Video availability and autoplay are provider-dependent; not a synchronization benchmark.",
};
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.youtubeSamples = [];
    window.addEventListener("watchparty:applied", (event) => {
      const d = event.detail;
      if (d.room.media.provider === "youtube")
        window.youtubeSamples.push({
          playing: d.room.playing,
          paused: d.paused,
          drift: d.drift,
          readyState: d.readyState,
        });
    });
  });
  await page.goto(report.url);
  await page.getByLabel("Display name").fill("YouTube live check");
  await page.getByRole("button", { name: "＋ Create a room" }).click();
  await page.getByLabel("Custom media title").fill("Official YouTube API demo");
  await page.getByLabel("Custom media URL").fill(report.source);
  await page.getByRole("button", { name: "Load video", exact: true }).click();
  await page.locator(".provider-frame iframe").waitFor({ timeout: 25000 });
  report.embedLoaded = true;
  await page.getByRole("button", { name: "Play", exact: true }).click();
  try {
    await page.waitForFunction(
      () =>
        window.youtubeSamples.some(
          (s) => s.playing && !s.paused && s.readyState >= 2,
        ),
      undefined,
      { timeout: 25000 },
    );
    await page.waitForFunction(
      () =>
        Number(document.querySelector('[aria-label="Seek playback"]').value) >
        5,
      undefined,
      { timeout: 10000 },
    );
    report.passed = true;
  } catch (error) {
    report.playbackError = String(error.message).split("\n")[0];
  }
  report.appliedSamples = await page.evaluate(
    () => window.youtubeSamples.length,
  );
  report.positionSeconds = await page.getByLabel("Seek playback").inputValue();
  report.playerBounds = await page.locator(".provider-frame iframe").boundingBox();
  const embed = page.frames().find((frame) => frame.url().startsWith("https://www.youtube.com/embed/"));
  if (embed) report.videoElement = await embed.locator("video").evaluate((video) => ({
    currentTime: video.currentTime, paused: video.paused, readyState: video.readyState,
    videoWidth: video.videoWidth, videoHeight: video.videoHeight,
    renderedWidth: video.getBoundingClientRect().width, renderedHeight: video.getBoundingClientRect().height,
  })).catch(() => ({ unavailable: true }));
  report.feedback = await page.locator(".video-message").allTextContents();
  report.autoplayAction = await page
    .getByRole("button", { name: "Click to sync and play" })
    .isVisible();
  await page.locator(".provider-frame").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "evidence/youtube-live.png", fullPage: true });
} catch (error) {
  report.error = String(error.message).split("\n")[0];
} finally {
  await browser.close();
  report.completedAt = new Date().toISOString();
  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/youtube-live.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
