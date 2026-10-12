import { chromium, type Page } from "@playwright/test";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import type { Room } from "../shared/types";
const url = process.env.DEMO_URL || "http://127.0.0.1:3001",
  count = Number(process.env.BENCH_CLIENTS || 10),
  iterations = Number(process.env.BROWSER_COMMANDS || 30);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stats = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y),
    at = (p: number) => a[Math.max(0, Math.ceil(a.length * p) - 1)];
  return { samples: a.length, p50: at(0.5), p95: at(0.95), maximum: a.at(-1) };
};
const flags = [
  "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  ...(process.env.LOW_MEMORY === "1"
    ? ["--process-per-site", "--renderer-process-limit=2", "--disable-gpu"]
    : []),
];
const browser = await chromium.launch({ headless: true, args: flags });
const sharedContext =
  process.env.LOW_MEMORY === "1"
    ? await browser.newContext({ viewport: { width: 960, height: 720 } })
    : null;
const pages: Page[] = [],
  bridges: number[] = [],
  rtts: number[] = [],
  begins = new Map<string, number>(),
  kinds = new Map<string, string>(),
  deliveries = new Map<string, number>(),
  applications = new Map<string, number>(),
  drifts: number[] = [];
let measuring = false;
const failures: string[] = [];
try {
  let code = "";
  for (let i = 0; i < count; i++) {
    const context =
      sharedContext ||
      (await browser.newContext({
        viewport: { width: 960, height: 720 },
      }));
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("crash", () => console.error(`Browser page ${i + 1} crashed`));
    pages.push(page);
    await page.exposeFunction(
      "benchEvent",
      (
        type: string,
        detail: {
          time: number;
          opId?: string;
          command?: { type: string };
          room?: Room;
          drift?: number;
        },
      ) => {
        if (!measuring) return;
        if (
          type === "command" &&
          ["play", "pause", "seek"].includes(detail.command?.type || "")
        ) {
          begins.set(detail.opId!, detail.time + bridges[i]);
          kinds.set(detail.opId!, detail.command!.type);
        }
        const op =
          type === "applied" && detail.opId
            ? { id: detail.opId, type: detail.command?.type || "" }
            : detail.room?.lastOperation;
        if (!op || !["play", "pause", "seek"].includes(op.type)) return;
        const key = `${op.id}:${i}`;
        if (type === "state" && !deliveries.has(key))
          deliveries.set(key, detail.time + bridges[i]);
        if (type === "applied" && !applications.has(key))
          applications.set(key, detail.time + bridges[i]);
      },
    );
    await page.addInitScript(() => {
      window.addEventListener("watchparty:clock", (e) => {
        (window as unknown as { benchOffset: number }).benchOffset = (
          e as CustomEvent
        ).detail.offset;
      });
      for (const event of ["command", "state", "applied"])
        window.addEventListener(`watchparty:${event}`, (e) => {
          (
            window as unknown as {
              benchEvent: (type: string, detail: unknown) => void;
            }
          ).benchEvent(event, (e as CustomEvent).detail);
        });
      window.addEventListener("watchparty:state", (e) => {
        (window as unknown as { benchRoom: Room }).benchRoom = (
          e as CustomEvent
        ).detail.room;
      });
    });
    page.on("pageerror", (e) => failures.push(e.message));
    await page.goto(code ? `${url}/?room=${code}` : url);
    await page.getByLabel("Display name").fill(`Viewer ${i + 1}`);
    const button = page.getByRole("button", {
      name: code ? "Join room →" : "＋ Create a room",
    });
    await button.waitFor();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.includes("Create a room") && !b.disabled,
        ) ||
        Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.includes("Join room") && !b.disabled,
        ),
    );
    await button.click();
    await page
      .getByRole("heading", { name: "Cinema Color Journey", level: 1 })
      .waitFor();
    if (!code) code = new URL(page.url()).searchParams.get("room")!;
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2;
    });
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.muted = true;
    });
    if (sharedContext)
      await page.getByRole("button", { name: "Cinema mode" }).click();
    const calibration: { rtt: number; offset: number }[] = [];
    for (let n = 0; n < 7; n++) {
      const start = performance.now(),
        remote = await page.evaluate(() => performance.now()),
        end = performance.now();
      calibration.push({
        rtt: end - start,
        offset: (start + end) / 2 - remote,
      });
    }
    calibration.sort((a, b) => a.rtt - b.rtt);
    bridges[i] = calibration[0].offset;
    rtts.push(calibration[0].rtt);
    console.log(`Ready browser ${i + 1}/${count}`);
  }
  const host = pages[0];
  const action = async (n: number) => {
    switch (n % 3) {
      case 0:
        await host.getByRole("button", { name: "Play", exact: true }).click();
        break;
      case 1:
        await host.getByRole("button", { name: "Pause", exact: true }).click();
        break;
      case 2:
        await host.getByLabel("Seek playback").evaluate(
          (input: HTMLInputElement, value: string) => {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value",
            )!.set!.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
          String(8 + (n % 60)),
        );
        break;
    }
  };
  for (let i = 0; i < 6; i++) {
    await action(i);
    await sleep(700);
  }
  measuring = true;
  for (let i = 0; i < iterations; i++) {
    await action(i);
    await sleep(1000);
    for (const page of pages) {
      const sample = await page.evaluate(() => {
        const room = (window as unknown as { benchRoom: Room }).benchRoom,
          v = document.querySelector("video")!;
        return {
          position: v.currentTime,
          playing: !v.paused,
          readyState: v.readyState,
          room,
          serverTime: performance.timeOrigin + performance.now(),
          clockOffset: (window as unknown as { benchOffset: number })
            .benchOffset,
        };
      });
      if (!sample.room) throw Error("No authoritative state observed");
      if (!Number.isFinite(sample.clockOffset))
        throw Error("Missing app clock estimate");
      const offset = sample.clockOffset;
      const expected = Math.min(
        sample.room.media.duration,
        sample.room.position +
          (sample.room.playing
            ? (sample.serverTime + offset - sample.room.anchor) / 1000
            : 0),
      );
      drifts.push(Math.abs(expected - sample.position) * 1000);
      if (sample.readyState < 2) failures.push("Unbuffered sample");
      if (sample.playing !== sample.room.playing)
        failures.push("Paused state mismatch");
    }
  }
  const byType: Record<string, { delivery: number[]; application: number[] }> =
    Object.fromEntries(
      ["play", "pause", "seek"].map((type) => [
        type,
        { delivery: [], application: [] },
      ]),
    );
  const eventSamples: number[] = [],
    applySamples: number[] = [];
  for (const [key, end] of deliveries) {
    const [op, index] = key.split(":");
    if (Number(index) === 0) continue;
    const start = begins.get(op);
    if (start !== undefined) {
      eventSamples.push(Math.max(0, end - start));
      byType[kinds.get(op)!].delivery.push(Math.max(0, end - start));
    }
  }
  for (const [key, end] of applications) {
    const [op, index] = key.split(":");
    if (Number(index) === 0) continue;
    const start = begins.get(op);
    if (start !== undefined) {
      applySamples.push(Math.max(0, end - start));
      byType[kinds.get(op)!].application.push(Math.max(0, end - start));
    }
  }
  if (sharedContext)
    await host.getByRole("button", { name: "Exit cinema" }).click();
  await host.screenshot({
    path: "evidence/ten-browser-room.png",
    fullPage: true,
  });
  const report = {
    timestamp: new Date().toISOString(),
    url,
    participants: count,
    browser: browser.version(),
    contexts: sharedContext
      ? "Separate pages and sessionStorage identities; shared browser context to fit Windows commit budget. Cookies/localStorage shared; application identity does not use them."
      : "Separate isolated browser contexts, one Chromium instance",
    headless: true,
    flags,
    warmupCommands: 6,
    commands: iterations,
    method:
      "Start: actual host command dispatch in app. Delivery: recipient Socket.IO state handler. Applied: first non-seeking video sample matching paused state and within 500ms of authoritative timeline, with a state version at least as new as the command. Browser clocks calibrated to a single Node monotonic clock using minimum RTT of 7 Playwright evaluations per page. Application sampled on command, playing/seeked/canplay events and each 100ms correction tick. Drift measured from HTML5 currentTime at least one second after each control; offset from app ping estimator via read-only clock telemetry.",
    calibrationRoundTripMs: stats(rtts),
    eventDeliveryMs: stats(eventSamples),
    playerApplicationMs: stats(applySamples),
    byControlType: Object.fromEntries(
      Object.entries(byType).map(([type, values]) => [
        type,
        {
          deliveryMs: stats(values.delivery),
          applicationMs: stats(values.application),
        },
      ]),
    ),
    absoluteDriftMs: stats(drifts),
    missingDeliverySamples: iterations * (count - 1) - eventSamples.length,
    missingApplicationSamples: iterations * (count - 1) - applySamples.length,
    failures,
    environment: {
      os: os.type() + " " + os.release(),
      node: process.version,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryGB: os.totalmem() / 2 ** 30,
      freeMemoryGB: os.freemem() / 2 ** 30,
      loadAverage: os.loadavg(),
    },
    limitations:
      "All clients share one measurement machine; deployment URL identifies loopback versus public hosting. Autoplay allowed by test flag and audio muted. Background throttling disabled. Player application criterion is state/timeline, not frame presentation timestamp. Clock calibration uncertainty approximately half calibration RTT. Windows load average does not reflect CPU load.",
    passed:
      applySamples.length === iterations * (count - 1) &&
      eventSamples.length === iterations * (count - 1) &&
      stats(eventSamples).p95 <= 250 &&
      stats(drifts).maximum! <= 500 &&
      failures.length === 0,
  };
  mkdirSync("evidence", { recursive: true });
  writeFileSync(
    process.env.BENCH_REPORT || "evidence/browser-benchmark.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser.close();
}
