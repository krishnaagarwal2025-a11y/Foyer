import { it, expect } from "vitest";
import { Engine } from "../server/engine";
it("new Watch rooms and late joins remain empty until the host selects media", () => {
  const e = new Engine(
    () => {},
    () => {},
  );
  const a = e.join("host", { name: "Host" });
  const code = a.room!.code;
  expect(a.room!.media.kind).toBe("empty");
  expect(a.room!.media.url).toBeUndefined();
  expect(e.join("guest", { name: "Guest", code }).room!.media.kind).toBe(
    "empty",
  );
  const send = (command: object) =>
    e.apply("host", {
      opId: crypto.randomUUID(),
      mediaRevision: e.rooms.get(code)!.mediaRevision,
      command,
    });
  expect(send({ type: "play" }).ok).toBe(false);
  expect(
    e.prepareRoomSync("host", {
      opId: crypto.randomUUID(),
      mediaRevision: 0,
      command: { type: "resync" },
    }).ok,
  ).toBe(false);
  expect(send({ type: "media", movieId: "local-demo" }).ok).toBe(true);
  expect(send({ type: "play" }).ok).toBe(true);
  const switched = send({ type: "mode", mode: "watch" });
  expect(switched).toMatchObject({ ok: true });
  expect(e.rooms.get(code)!.media.kind).toBe("empty");
  expect(
    e.join("listen", { name: "Listener", mode: "listen" }).room!.media.kind,
  ).toBe("audio");
});
