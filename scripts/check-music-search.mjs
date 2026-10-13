import { chromium, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
const report = {
  url: process.env.DEMO_URL || "http://localhost:3001",
  query: process.env.MUSIC_QUERY || "finding her",
  startedAt: new Date().toISOString(),
  passed: false,
  pageErrors: [],
  conditions:
    "Actual anonymous YouTube Music metadata search and official YouTube embed playback, one touch-emulated Chromium client with autoplay allowed. No other tab, copied URL, API key, account, audio extraction or media proxy. Not physical mobile/Safari or a multi-device timing benchmark.",
};
const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page = await context.newPage();
  await page.addInitScript(() => {
    window.addEventListener("watchparty:state", (event) => {
      window.foyerMusicCheckState = event.detail.room;
    });
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  await page.goto(report.url);
  await page.getByLabel("Display name").fill("Live music search check");
  await page.getByRole("button", { name: "♪ Listen", exact: true }).click();
  await page.getByRole("button", { name: "＋ Create a room" }).click();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.getByLabel("Search songs").fill(report.query);
  await page.getByRole("button", { name: "Search music", exact: true }).click();
  const result = page.locator(".track").first();
  await result.waitFor({ timeout: 20000 });
  report.searchResults = await page.locator(".track").count();
  report.selectedTitle = await result.locator("strong").textContent();
  await result.getByRole("button", { name: /^Play / }).click();
  const video = page.frameLocator(".provider-frame iframe").locator("video");
  await expect
    .poll(
      () =>
        video.evaluate(
          (v) => !v.paused && v.readyState >= 2 && v.currentTime > 2,
        ),
      { timeout: 35000 },
    )
    .toBe(true);
  report.beforeSync = await video.evaluate((v) => ({
    position: v.currentTime,
    paused: v.paused,
    readyState: v.readyState,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
  }));
  report.syncTrials = [];
  for (let round = 0; round < 3; round++) {
    const previous = await page.evaluate(
      () => window.foyerMusicCheckState?.synchronization?.id,
    );
    await page.getByRole("button", { name: "Sync room" }).click();
    await page.waitForFunction(
      (previous) =>
        document
          .querySelector("#sync-feedback")
          ?.textContent.includes("devices aligned") &&
        window.foyerMusicCheckState?.synchronization?.id !== previous &&
        window.foyerMusicCheckState?.synchronization?.reason === "manual",
      previous,
      { timeout: 18000 },
    );
    await expect
      .poll(() => video.evaluate((v) => !v.paused && v.readyState >= 2), {
        timeout: 10000,
      })
      .toBe(true);
    report.syncTrials.push({
      round: round + 1,
      check: await page.evaluate(
        () => window.foyerMusicCheckState?.synchronization,
      ),
      actualMedia: await video.evaluate((v) => ({
        position: v.currentTime,
        paused: v.paused,
        readyState: v.readyState,
      })),
    });
    await page.waitForTimeout(500);
  }
  report.syncFeedback = await page.locator("#sync-feedback").textContent();
  report.tabs = context.pages().length;
  report.afterSync = await video.evaluate((v) => ({
    position: v.currentTime,
    paused: v.paused,
    readyState: v.readyState,
  }));
  await page.locator(".stage h1").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "evidence/music-search-live.png",
    fullPage: true,
    timeout: 15000,
  });
  report.passed = report.tabs === 1 && !report.pageErrors.length;
} catch (error) {
  report.error = String(error.message).split("\n")[0];
  report.diagnostics = await page
    ?.evaluate(() => ({
      feedback: document.querySelector("#sync-feedback")?.textContent,
      alerts: [...document.querySelectorAll('[role="alert"]')].map(
        (e) => e.textContent,
      ),
      url: location.href,
      visibleText: document.body.innerText.slice(0, 5000),
      frames: [...document.querySelectorAll("iframe")].map((f) => f.src),
      room: window.foyerMusicCheckState,
    }))
    .catch(() => null);
} finally {
  await browser.close();
  report.completedAt = new Date().toISOString();
  writeFileSync(
    process.env.MUSIC_REPORT || "evidence/music-search-live.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
