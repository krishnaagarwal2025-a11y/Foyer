import { loadDemo } from "./demo";
import { test, expect, type Page } from "@playwright/test";
const enter = async (page: Page, name: string, code?: string) => {
  await page.goto(code ? "/?room=" + code : "/");
  await page.getByLabel("Display name").fill(name);
  const button = page.getByRole("button", {
    name: code ? "Join room →" : "＋ Create a room",
  });
  await expect(button).toBeEnabled();
  await button.click();
  if (!code) await loadDemo(page);
  await expect(page.locator("video")).toBeVisible();
  return new URL(page.url()).searchParams.get("room")!;
};

test("device packets precede common video/audio start, manual sync checks peers, and queued starts use the protocol", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  for (const context of [a, b])
    await context.addInitScript(() => {
      const data: any = ((window as any).protocolEvidence = {
        probes: [],
        states: [],
        holds: [],
        commands: [],
        offset: 0,
      });
      window.addEventListener(
        "watchparty:clock",
        (e) => (data.offset = (e as CustomEvent).detail.offset),
      );
      window.addEventListener("watchparty:probe", (e) =>
        data.probes.push((e as CustomEvent).detail),
      );
      window.addEventListener("watchparty:command", (e) =>
        data.commands.push((e as CustomEvent).detail.command),
      );
      window.addEventListener("watchparty:state", (e) => {
        const r = (e as CustomEvent).detail.room;
        data.states.push(r);
        if (
          r.playing &&
          r.synchronization?.startAt &&
          r.anchor >
            performance.timeOrigin + performance.now() + data.offset + 60
        ) {
          setTimeout(() => {
            const player =
              document.querySelector<HTMLMediaElement>("video,audio");
            data.holds.push({
              paused: player?.paused,
              remaining:
                r.anchor -
                performance.timeOrigin -
                performance.now() -
                data.offset,
            });
          }, 30);
        }
      });
    });
  const host = await a.newPage(),
    guest = await b.newPage();
  const state = (page: Page) =>
    page.evaluate(() => {
      const e = (window as any).protocolEvidence;
      return {
        probes: e.probes,
        holds: e.holds,
        last: e.states.at(-1),
        commands: e.commands,
      };
    });
  try {
    const code = await enter(host, "Protocol host");
    await enter(guest, "Protocol guest", code);
    for (const page of [host, guest])
      await expect
        .poll(() =>
          page
            .locator("video")
            .evaluate(
              (v: HTMLVideoElement) =>
                v.readyState >= 2 && v.seekable.length > 0,
            ),
        )
        .toBe(true);
    // Space opens an interactive disclosure without starting the room.
    await host.locator(".source-panel > summary").focus();
    await host.keyboard.press("Space");
    await expect(host.getByLabel("Custom media URL")).toBeVisible();
    expect(
      (await state(host)).commands.filter((c: any) => c.type === "play"),
    ).toHaveLength(0);
    await host.keyboard.press("Space");
    await expect(host.getByLabel("Custom media URL")).toBeHidden();
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(false);
    for (const page of [host, guest]) {
      const evidence = await state(page);
      expect(
        evidence.probes.filter((p: any) => p.reason === "play"),
      ).toHaveLength(3);
      expect(evidence.holds.some((h: any) => h.remaining > 0 && h.paused)).toBe(
        true,
      );
      expect(evidence.last.synchronization.participants).toHaveLength(2);
      expect(
        evidence.last.synchronization.participants.every(
          (p: any) => p.samples === 3 && p.rttMs !== null && p.ready,
        ),
      ).toBe(true);
    }
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await host.getByRole("button", { name: "♪ Listen", exact: true }).click();
    for (const page of [host, guest])
      await expect
        .poll(() =>
          page
            .locator("audio")
            .evaluate(
              (v: HTMLAudioElement) =>
                v.readyState >= 2 && v.seekable.length > 0,
            ),
        )
        .toBe(true);
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        guest.locator("audio").evaluate((v: HTMLAudioElement) => v.paused),
      )
      .toBe(false);
    const revision = (await state(host)).last.mediaRevision;
    expect(
      (await state(guest)).probes.filter(
        (p: any) => p.reason === "play" && p.mediaRevision === revision,
      ),
    ).toHaveLength(3);
    await expect(
      guest.getByRole("button", { name: "Host controls sync" }),
    ).toBeDisabled();
    await host.getByRole("button", { name: "Sync room" }).click();
    await expect(host.locator("#sync-feedback")).toContainText(
      "devices aligned",
    );
    for (const page of [host, guest]) {
      const manual = (await state(page)).probes.filter(
        (p: any) => p.reason === "manual",
      );
      expect(manual.length).toBeGreaterThanOrEqual(3);
      expect(manual.length % 3).toBe(0); // readiness may require another 3-packet round
      expect(
        (await state(page)).last.synchronization.participants.every(
          (p: any) =>
            p.samples === 3 && p.ready && p.paused && p.alignmentMs <= 80,
        ),
      ).toBe(true);
    }
    expect(
      (await state(guest)).commands.filter((c: any) =>
        ["play", "pause", "seek"].includes(c.type),
      ),
    ).toEqual([]);
    await host.getByRole("button", { name: /^People/ }).click();
    await expect(host.locator(".device-delay")).toHaveCount(2);
    await expect(host.locator(".device-delay").first()).toContainText("ms RTT");
    await host.screenshot({
      path: "evidence/device-protocol-people.png",
      fullPage: true,
    });
    await host.getByRole("button", { name: "Discover", exact: true }).click();
    const card = host
      .locator(".movie")
      .filter({ hasText: "Foyer · Evening Keys" });
    await card.getByRole("button", { name: "＋ Queue" }).click();
    await host.getByRole("button", { name: "Room", exact: true }).click();
    await host.getByRole("button", { name: "Queue 1", exact: true }).click();
    await host.getByRole("button", { name: "Play winner" }).click();
    await expect
      .poll(async () => (await state(guest)).last.mediaRevision)
      .toBeGreaterThan(revision);
    await expect
      .poll(() =>
        guest.locator("audio").evaluate((v: HTMLAudioElement) => v.paused),
      )
      .toBe(false);
    expect((await state(guest)).last.synchronization.mediaRevision).toBe(
      (await state(guest)).last.mediaRevision,
    );
    // Automatic next item loads first, then goes through the same preparation.
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await host.getByRole("button", { name: "Discover", exact: true }).click();
    await card.getByRole("button", { name: "＋ Queue" }).click();
    await host.getByRole("button", { name: /^People/ }).click();
    await host.getByText("Room settings", { exact: true }).click();
    await host.getByLabel("Auto-play winning queued video").click();
    await expect(
      host.getByLabel("Auto-play winning queued video"),
    ).toBeChecked();
    await host.getByLabel("Seek playback").fill("59.7");
    const beforeEnd = (await state(host)).last.mediaRevision;
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(async () => (await state(guest)).last.mediaRevision, {
        timeout: 10000,
      })
      .toBeGreaterThan(beforeEnd);
    await expect
      .poll(() =>
        guest.locator("audio").evaluate((v: HTMLAudioElement) => v.paused),
      )
      .toBe(false);
    await expect
      .poll(() =>
        guest.locator("audio").evaluate((v: HTMLAudioElement) => v.currentTime),
      )
      .toBeGreaterThan(0.2);
    const after = (await state(guest)).last;
    expect(after.synchronization.mediaRevision).toBe(after.mediaRevision);
  } finally {
    await a.close();
    await b.close();
  }
});
