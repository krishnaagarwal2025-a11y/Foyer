import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
import os from "node:os";
const url = process.env.DEMO_URL || "http://localhost:3001",
  count = Number(process.env.BENCH_CLIENTS || 10),
  rounds = Number(process.env.SYNC_ROUNDS || 5);
if (
  !Number.isInteger(count) ||
  count < 2 ||
  count > 32 ||
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 20
)
  throw Error("Use 2–32 clients and 1–20 rounds per media type.");
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1] ?? null,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    maximum: sorted.at(-1) ?? null,
  };
};
const report: any = {
  startedAt: new Date().toISOString(),
  url,
  clients: count,
  roundsPerMedia: rounds,
  passed: false,
  browser: "Chromium",
  environment: {
    platform: os.platform(),
    node: process.version,
    cpus: os.cpus().length,
  },
  conditions:
    "One machine, isolated contexts, autoplay allowed, background throttling disabled, actual bundled HTML5 media. Localhost or Internet according to URL; no physical phone/LAN, audible output or frame presentation measurement. Drift uses each browser's four-timestamp estimate of server time at the instant of its media read. RTT/paused alignment are server-collected reports, not independent video-frame proof.",
  trials: [],
};
const browser = await chromium.launch({
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const contexts: BrowserContext[] = [],
  pages: Page[] = [],
  durations: number[] = [],
  alignments: number[] = [],
  drifts: number[] = [],
  errors: string[] = [];
try {
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    contexts.push(context);
    await context.addInitScript(() => {
      const metric: any = ((window as any).foyerSyncMetric = {
        room: null,
        offset: 0,
        waitingSeen: false,
      });
      window.addEventListener("watchparty:state", (event) => {
        metric.room = (event as CustomEvent).detail.room;
        if (
          metric.room.syncBarrier?.status === "waiting" &&
          !metric.room.playing
        )
          metric.waitingSeen = true;
      });
      window.addEventListener(
        "watchparty:clock",
        (event) => (metric.offset = (event as CustomEvent).detail.offset),
      );
    });
    const page = await context.newPage();
    pages.push(page);
    page.on("pageerror", (error) => errors.push(error.message));
    const code = i ? new URL(pages[0].url()).searchParams.get("room") : null;
    await page.goto(url + (code ? "/?room=" + code : "/"));
    await page.getByLabel("Display name").fill(`Sync bench ${i + 1}`);
    await page
      .getByRole("button", { name: i ? "Join room →" : "＋ Create a room" })
      .click();
    await page.locator("video").waitFor();
  }
  const host = pages[0];
  for (const media of ["video", "audio"]) {
    if (media === "audio")
      await host.getByRole("button", { name: "♪ Listen", exact: true }).click();
    for (const page of pages)
      await page.waitForFunction(
        (type) => {
          const v = document.querySelector<HTMLMediaElement>(type);
          return v && v.readyState >= 2 && v.seekable.length > 0;
        },
        media,
        { timeout: 30000 },
      );
    // Warm-up Play/Pause exercises media decoding and initial clock exchange.
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await host.waitForTimeout(400);
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    for (let n = 0; n < rounds; n++) {
      await host.getByLabel("Seek playback").fill(String(10 + n * 2));
      for (const page of pages)
        await page.evaluate(
          () => ((window as any).foyerSyncMetric.waitingSeen = false),
        );
      const previous = await host.evaluate(
        () => (window as any).foyerSyncMetric.room?.synchronization?.id,
      );
      const start = performance.now();
      await host.getByRole("button", { name: "Sync room" }).click();
      await host.waitForFunction(
        (previous) =>
          document
            .querySelector("#sync-feedback")
            ?.textContent.includes("devices aligned") &&
          (window as any).foyerSyncMetric.room.synchronization?.id !==
            previous &&
          (window as any).foyerSyncMetric.room.synchronization?.reason ===
            "manual",
        previous,
        { timeout: 18000 },
      );
      durations.push(performance.now() - start);
      const state = await host.evaluate(
        () => (window as any).foyerSyncMetric.room,
      );
      alignments.push(
        ...state.synchronization.participants.map((p: any) => p.alignmentMs),
      );
      for (const page of pages)
        await page.waitForFunction(
          (type) => {
            const v = document.querySelector<HTMLMediaElement>(type);
            return v && !v.paused && !v.seeking && v.readyState >= 2;
          },
          media,
          { timeout: 10000 },
        );
      const trial: any = {
        media,
        round: n + 1,
        check: state.synchronization,
        driftMs: [],
      };
      for (let sample = 0; sample < 3; sample++) {
        const readings = await Promise.all(
          pages.map((page) =>
            page.evaluate((type) => {
              const metric = (window as any).foyerSyncMetric,
                r = metric.room,
                v = document.querySelector<HTMLMediaElement>(type)!;
              const serverNow =
                performance.timeOrigin + performance.now() + metric.offset;
              const expected = Math.min(
                r.media.duration,
                r.position +
                  (r.playing ? Math.max(0, serverNow - r.anchor) / 1000 : 0),
              );
              return {
                driftMs: Math.abs(expected - v.currentTime) * 1000,
                paused: v.paused,
                seeking: v.seeking,
                readyState: v.readyState,
                rate: v.playbackRate,
                waitingSeen: metric.waitingSeen,
              };
            }, media),
          ),
        );
        for (const reading of readings) {
          drifts.push(reading.driftMs);
          trial.driftMs.push(reading.driftMs);
          if (reading.paused || !reading.waitingSeen)
            throw Error(
              "A participant did not observe the pause barrier or resume.",
            );
        }
        await host.waitForTimeout(200);
      }
      report.trials.push(trial);
      await host.getByRole("button", { name: "Pause", exact: true }).click();
    }
  }
  report.passed =
    !errors.length &&
    alignments.every((value) => value <= 80) &&
    drifts.every((value) => value <= 500);
} catch (error) {
  report.error = String(error);
} finally {
  await Promise.allSettled(contexts.map((context) => context.close()));
  await browser.close();
  report.completedAt = new Date().toISOString();
  report.pageErrors = errors;
  report.pauseHandshakeCommitMs = summarize(durations);
  report.reportedPausedAlignmentMs = summarize(alignments);
  report.estimatedPlaybackDriftMs = summarize(drifts);
  writeFileSync(
    process.env.BENCH_REPORT || "evidence/room-sync-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        trials: `${report.trials.length} detailed trials saved in the report`,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
