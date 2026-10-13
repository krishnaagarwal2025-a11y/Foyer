import { test, expect, type Page } from "@playwright/test";
async function enter(page: Page, name: string, code?: string) {
  await page.goto(code ? `/?room=${code}` : "/");
  await page.getByLabel("Display name").fill(name);
  await expect(
    page.getByRole("button", {
      name: code ? "Join room →" : "＋ Create a room",
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: code ? "Join room →" : "＋ Create a room" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cinema Color Journey", level: 1 }),
  ).toBeVisible();
  return new URL(page.url()).searchParams.get("room")!;
}
test("two browsers complete the social and synchronized playback workflow", async ({
  browser,
}) => {
  const hostContext = await browser.newContext(),
    guestContext = await browser.newContext(),
    host = await hostContext.newPage(),
    guest = await guestContext.newPage();
  const errors: string[] = [];
  host.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  guest.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.stack);
  });
  try {
    const code = await enter(host, "Alex");
    await enter(guest, "Jordan", code);
    await expect(host.locator(".participant")).toHaveCount(2);
    await expect(
      guest.getByRole("button", { name: "Play", exact: true }),
    ).toBeDisabled();
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(false);
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(0.2);
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(true);
    await host.getByRole("button", { name: "Toggle sound" }).click();
    await expect(
      host.getByRole("button", { name: "Toggle sound" }),
    ).toContainText("🔇");
    expect(
      await host.locator("video").evaluate((v: HTMLVideoElement) => v.muted),
    ).toBe(true);
    await host.getByRole("button", { name: "Toggle sound" }).click();
    await host
      .getByLabel("Seek playback")
      .evaluate((input: HTMLInputElement) => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "22");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(22, 0);
    await guest.getByLabel("Mark as spoiler").check();
    await guest.getByLabel("Chat message").fill("<script>surprise</script>");
    await guest.getByRole("button", { name: "Send message" }).click();
    await expect(
      host.getByRole("button", { name: "Spoiler · click to reveal" }),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Spoiler · click to reveal" })
      .click();
    await expect(
      host.getByText("<script>surprise</script>", { exact: true }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "React 🔥" }).click();
    await expect(host.locator(".floating-reactions")).toContainText("🔥");
    await host.getByRole("button", { name: "Discover", exact: true }).click();
    await host.getByLabel("Playable only").uncheck();
    await host.getByLabel("Search movies").fill("quiet orbt");
    await expect(host.locator(".movie h3")).toContainText(["The Quiet Orbit"]);
    await host.getByLabel("Search movies").fill("");
    await guest.getByRole("button", { name: /^People/ }).click();
    await guest.getByText("Your movie preferences", { exact: true }).click();
    await guest.getByRole("button", { name: "Wonder", exact: true }).click();
    await expect(host.locator(".match").first()).toContainText("Wonder");
    await host.getByLabel("Playable only").check();
    await host
      .locator(".movie")
      .filter({ hasText: "Cinema Color Journey" })
      .getByRole("button", { name: "＋ Queue" })
      .click();
    await guest.getByRole("button", { name: "Room", exact: true }).click();
    await host.getByRole("button", { name: "Room", exact: true }).click();
    await guest.getByRole("button", { name: "Queue 1", exact: true }).click();
    await guest.getByRole("button", { name: "↑ 0 votes" }).click();
    await host.getByRole("button", { name: "Queue 1", exact: true }).click();
    await expect(host.getByRole("button", { name: "↑ 1 votes" })).toBeVisible();
    await guest.getByRole("button", { name: "Polls", exact: true }).click();
    await guest.getByLabel("New poll").fill("Snacks?");
    await guest
      .getByLabel("Options (2–5, comma separated)")
      .fill("Popcorn, Nachos");
    await guest.getByRole("button", { name: "Create poll" }).click();
    await host.getByRole("button", { name: "Polls", exact: true }).click();
    await expect(host.getByText("Snacks?", { exact: true })).toBeVisible();
    await guest.getByRole("button", { name: /^Popcorn\s*0$/ }).click();
    await expect(
      host.getByRole("button", { name: /^Popcorn\s*1$/ }),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Moments", exact: true }).click();
    await guest.getByLabel("Moment name").fill("Color break");
    await guest.getByRole("button", { name: /Save at/ }).click();
    await host.getByRole("button", { name: "Moments", exact: true }).click();
    await expect(
      host.getByRole("button", { name: "0:22 Color break" }),
    ).toBeVisible();
    await guestContext.setOffline(true);
    await expect(
      host.locator(".participant").filter({ hasText: "Jordan" }),
    ).toContainText("Reconnecting", { timeout: 35000 });
    await guestContext.setOffline(false);
    await expect(
      host.locator(".participant").filter({ hasText: "Jordan" }),
    ).toContainText("In sync", { timeout: 10000 });
    await expect(host.locator(".participant")).toHaveCount(2);
    await expect
      .poll(() =>
        guest.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(22, 0);
    await host.getByRole("button", { name: /^People/ }).click();
    await host.getByRole("button", { name: "Transfer host to Jordan" }).click();
    await expect(
      guest.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled();
    await expect(
      host.getByRole("button", { name: "Play", exact: true }),
    ).toBeDisabled();
    await guest.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        host.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(false);
    await guest.getByRole("button", { name: "Cinema mode" }).click();
    await expect(guest.locator(".sidebar")).toHaveCount(0);
    await guest
      .getByRole("heading", { name: "Cinema Color Journey", level: 1 })
      .click();
    await guest.keyboard.press("c");
    await expect(guest.locator(".sidebar")).toHaveCount(1);
    await host.getByRole("button", { name: "Room", exact: true }).click();
    await host.screenshot({
      path: "evidence/room-desktop.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
test("invalid invitations, mobile layout and deterministic host replacement", async ({
  browser,
}) => {
  const c1 = await browser.newContext(),
    c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    p1 = await c1.newPage(),
    p2 = await c2.newPage();
  try {
    await p2.goto("/?room=ZZZZZZ");
    await p2.getByLabel("Display name").fill("Mobile");
    await expect(p2.getByRole("button", { name: "Join room →" })).toBeEnabled();
    await p2.getByRole("button", { name: "Join room →" }).click();
    await expect(p2.getByRole("alert")).toContainText("Room not found");
    await p2.screenshot({ path: "evidence/home-mobile.png", fullPage: true });
    const code = await enter(p1, "Departing");
    await enter(p2, "Mobile", code);
    await p1.close();
    await expect(
      p2.getByRole("button", { name: "Play", exact: true }),
    ).toBeEnabled({ timeout: 22000 });
    await expect(p2.locator(".participant")).toHaveCount(1);
    await p2.screenshot({ path: "evidence/room-mobile.png", fullPage: true });
    expect(
      await p2.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await c1.close();
    await c2.close();
  }
});

test("late join snapshots playback, corrects drift and recovers from a bad source", async ({
  browser,
}) => {
  const first = await browser.newContext(),
    second = await browser.newContext(),
    host = await first.newPage(),
    late = await second.newPage();
  try {
    const code = await enter(host, "Host");
    await host.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(() =>
        host.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(1.5);
    await enter(late, "Late viewer", code);
    await expect
      .poll(() =>
        late.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(false);
    const difference = async () => {
      const a = await host
          .locator("video")
          .evaluate((v: HTMLVideoElement) => v.currentTime),
        b = await late
          .locator("video")
          .evaluate((v: HTMLVideoElement) => v.currentTime);
      return Math.abs(a - b);
    };
    await expect.poll(difference).toBeLessThan(0.5);
    await late.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 0;
    });
    await expect.poll(difference, { timeout: 4000 }).toBeLessThan(0.5);
    // Exercise the user-gesture recovery path deterministically, independent of browser autoplay policy.
    await late.locator("video").evaluate((v: HTMLVideoElement) => {
      (window as unknown as { originalPlay: typeof v.play }).originalPlay =
        v.play;
      v.pause();
      v.play = () =>
        Promise.reject(
          new DOMException("Simulated autoplay restriction", "NotAllowedError"),
        );
    });
    await expect(
      late.getByRole("button", { name: "Enable playback on this device" }),
    ).toBeVisible();
    await late.locator("video").evaluate((v: HTMLVideoElement) => {
      window.addEventListener(
        "click",
        () => {
          v.play = (
            window as unknown as { originalPlay: typeof v.play }
          ).originalPlay;
        },
        { once: true, capture: true },
      );
    });
    await late
      .getByRole("button", { name: "Enable playback on this device" })
      .click();
    await expect
      .poll(() =>
        late.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(false);
    await host.getByRole("button", { name: "Pause", exact: true }).click();
    await expect
      .poll(() =>
        late.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
      )
      .toBe(true);
    await host.locator(".source-panel > summary").click();
    await host.getByLabel("Custom media title").fill("Missing source");
    await host
      .getByLabel("Custom media URL")
      .fill(new URL("/media/missing.mp4", host.url()).href);
    await host.getByLabel("Custom duration seconds").fill("30");
    await host.getByRole("button", { name: "Load video", exact: true }).click();
    await expect(late.locator(".video-message")).toContainText(
      "cannot be played",
    );
    await host.getByRole("button", { name: "Use local demo" }).click();
    await expect(
      host.getByRole("heading", { name: "Cinema Color Journey", level: 1 }),
    ).toBeVisible();
    await expect
      .poll(() =>
        late.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() =>
        late.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeLessThan(0.5);
  } finally {
    await first.close();
    await second.close();
  }
});
