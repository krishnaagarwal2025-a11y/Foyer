import { normalizeSource } from "../shared/media";
import { expectedPosition, type Room, type Result } from "../shared/types";
import { acceptSnapshot } from "../shared/sync";
if (!document.getElementById("foyer-companion")) {
  const host = document.createElement("div");
  host.id = "foyer-companion";
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>:host{all:initial;position:fixed;z-index:2147483647;right:16px;top:60px;font:13px system-ui;color:#eee}*{box-sizing:border-box}button,input,select{font:inherit}button{background:#342844;color:#eee;border:1px solid #6c508d;border-radius:8px;padding:8px;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}input,select{width:100%;background:#15111d;color:#eee;border:1px solid #59436b;border-radius:7px;padding:9px;margin:5px 0 10px}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #ceafff;outline-offset:2px}.panel{width:310px;max-height:85vh;overflow:auto;background:#1b1623;border:1px solid #59436b;border-radius:14px;padding:16px;box-shadow:0 10px 40px #0008;margin-top:8px}.hidden{display:none}.top,.row{display:flex;gap:6px;align-items:center;justify-content:space-between}.row button{flex:1}h2{margin:0;color:#d4b4ff}p{line-height:1.5;color:#b7a8c7}small{display:block;color:#b6a5c8;font-size:11px;margin:8px 0}a{color:#cfb0ff}#notice{color:#ffd6a0;overflow-wrap:anywhere}#chat{height:150px;overflow:auto;border:1px solid #493453;border-radius:8px;padding:8px;margin-top:10px}.msg{margin-bottom:10px;overflow-wrap:anywhere}.msg strong{color:#d4b4ff}.msg p{margin:4px 0}.primary{background:#be99ff;color:#20152c;font-weight:700}label{display:block;font-size:12px;margin-top:10px}.status{color:#91d5b3}#badge{font-size:10px;border:1px solid #806797;border-radius:9px;padding:4px}.shortcut{font-size:11px}</style><button id="toggle" aria-label="Toggle Foyer companion">◉ Foyer</button><section class="panel hidden" id="panel"><div class="top"><h2>Foyer</h2><span id="badge">COMPANION · EXPERIMENTAL</span></div><p>Synchronize your own authorized stream. This extension never reads account credentials.</p><div id="setup"><label>Foyer server<input id="server" value="http://localhost:3001" type="url"></label><small>Allow your server in the extension popup before connecting.</small><label>Display name<input id="name" maxlength="32" placeholder="Your name"></label><label>Room code<input id="code" maxlength="6" placeholder="Blank to create a room"></label><div class="row"><button id="connect" class="primary">Create / Join</button><button id="fresh">Join as new</button></div></div><div id="room" class="hidden"><div class="top"><strong id="roomcode"></strong><button id="copy">Copy invite</button><button id="leave">Leave</button></div><small class="status" id="status">Connecting</small><small id="current"></small><div class="row"><button id="play">Play</button><button id="pause">Pause</button><button id="sync">Sync me</button></div><label>Seek (seconds)<input id="seek" type="number" min="0" step="1"></label><button id="seekbutton">Seek room</button><button id="bind">Use this title</button><label><input id="ad" type="checkbox" style="width:auto"> Ad playing (manual fallback)</label><small>Ads are not skipped or controlled. Host ad detection pauses the room; resume after the ad.</small><button id="open">Open room title</button><label>Transfer host<select id="participants"></select></label><button id="transfer">Transfer host</button><div id="chat" aria-live="polite"></div><form id="messageform"><label>Message<input id="message" maxlength="500" placeholder="Say something…"></label><button class="primary">Send</button></form><div class="row" id="reactions"><button>❤️</button><button>🔥</button><button>😂</button><button>👏</button></div><small id="diagnostic"></small></div><p id="notice" role="status"></p><a href="https://github.com/krishnaagarwal2025-a11y/Foyer" target="_blank" rel="noreferrer">Foyer source & setup ↗</a></section>`;
  const $ = <T extends HTMLElement>(id: string) =>
    shadow.getElementById(id) as T;
  const input = (id: string) => $<HTMLInputElement>(id),
    button = (id: string) => $<HTMLButtonElement>(id);
  let room: Room | null = null,
    self = "",
    offset = 0,
    rtt = 0,
    status = "Disconnected",
    bound: HTMLVideoElement | null = null,
    lastAvailability = "",
    manualAd = false;
  const now = () => performance.timeOrigin + performance.now();
  const notice = (text: string) => ($("notice").textContent = text);
  function current() {
    try {
      return normalizeSource(
        location.href,
        document.title.slice(0, 100),
        Number.isFinite(bound?.duration) && bound!.duration > 0
          ? bound!.duration
          : 3600,
      );
    } catch {
      return null;
    }
  }
  function matches() {
    const source = current();
    return (
      !!room &&
      !!source &&
      source.provider === room.media.provider &&
      source.sourceId === room.media.sourceId
    );
  }
  function controls() {
    return (
      status === "Connected" &&
      !!room &&
      (room.hostId === self || room.settings.collaborative)
    );
  }
  async function command(command: Record<string, unknown>) {
    if (!room || status !== "Connected") {
      notice("Reconnect before sending commands.");
      return;
    }
    try {
      const result = (await chrome.runtime.sendMessage({
        type: "foyer:command",
        envelope: {
          opId: crypto.randomUUID(),
          mediaRevision: room.mediaRevision,
          command,
        },
      })) as Result;
      if (!result?.ok) notice(result?.error || "Command rejected.");
    } catch {
      notice("Extension connection unavailable. Reload this page.");
    }
  }
  function render() {
    if (!room) return;
    $("setup").classList.add("hidden");
    $("room").classList.remove("hidden");
    $("roomcode").textContent = `ROOM ${room.code}`;
    $("status").textContent = status;
    $("current").textContent =
      `${room.media.title} · ${room.hostId === self ? "You are host" : "Host controls"} · ${room.participants.length} people`;
    for (const id of ["play", "pause", "seekbutton", "bind"])
      button(id).disabled = !controls();
    button("sync").disabled =
      !matches() ||
      !bound ||
      room.hostId !== self ||
      status !== "Connected" ||
      room.syncBarrier?.status === "waiting";
    button("transfer").disabled =
      room.hostId !== self || status !== "Connected";
    const select = $<HTMLSelectElement>("participants"),
      previous = select.value;
    select.replaceChildren();
    for (const p of room.participants.filter(
      (p) => p.connected && p.id !== self,
    )) {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      select.append(option);
    }
    if ([...select.options].some((o) => o.value === previous))
      select.value = previous;
    const chat = $("chat"),
      atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 35;
    chat.replaceChildren();
    for (const msg of room.chat.slice(-50)) {
      const el = document.createElement("div");
      el.className = "msg";
      const name = document.createElement("strong");
      name.textContent = msg.name;
      el.append(name);
      if (msg.spoiler) {
        const reveal = document.createElement("button");
        reveal.textContent = "Spoiler · reveal";
        reveal.onclick = () => {
          const text = document.createElement("p");
          text.textContent = msg.text;
          reveal.replaceWith(text);
        };
        el.append(reveal);
      } else {
        const text = document.createElement("p");
        text.textContent = msg.text;
        el.append(text);
      }
      chat.append(el);
    }
    if (atBottom) chat.scrollTop = chat.scrollHeight;
  }
  function adActive() {
    return (
      manualAd ||
      !!document.querySelector(
        '[data-uia="ad-break"], [data-testid="adCountdown"], [data-testid="ad-timer"], [data-ad-state="playing"], .ad-break',
      )
    );
  }
  function reportAvailability(value: string) {
    if (value !== lastAvailability) {
      lastAvailability = value;
      void command({ type: "availability", status: value });
      if (value === "ad" && room?.hostId === self && room.playing)
        void command({ type: "pause" });
    }
  }
  function apply(force = false) {
    if (!room || !bound || status !== "Connected") return;
    if (!matches()) {
      reportAvailability("unavailable");
      notice("Open the same title as the room, then press Sync me.");
      return;
    }
    if (adActive()) {
      reportAvailability("ad");
      notice(
        "Ad playing. Playback correction is suspended; ads are not skipped.",
      );
      return;
    }
    if (bound.readyState < 2 || !bound.seekable.length) {
      reportAvailability("buffering");
      return;
    }
    if (room.playing && room.anchor > now() + offset) {
      if (!bound.paused) bound.pause();
      bound.playbackRate = 1;
      return;
    }
    reportAvailability("ready");
    const expected = expectedPosition(room, now() + offset),
      delta = expected - bound.currentTime;
    $("diagnostic").textContent =
      `RTT ${rtt.toFixed(0)} ms · estimated drift ${(delta * 1000).toFixed(0)} ms · v${room.version}`;
    if (force || Math.abs(delta) > (room.playing ? 0.5 : 0.15)) {
      try {
        bound.currentTime = Math.min(expected, bound.duration);
      } catch {
        notice("The platform did not accept this seek.");
      }
    }
    bound.playbackRate = 1;
    if (room.playing && bound.paused)
      void bound
        .play()
        .catch(() =>
          notice("Click the platform player to allow playback, then Sync me."),
        );
    if (!room.playing && !bound.paused) bound.pause();
  }
  const nativeAction = (type: string) => {
    if (room?.syncBarrier?.status === "waiting") return;
    if (room?.playing && room.anchor > now() + offset) return;
    if (adActive() || !matches() || !controls() || !bound) return;
    // Browser events caused by our own correction can arrive after the seek/play
    // promise settles. Compare them with the authoritative room before emitting
    // anything, so a delayed player event cannot create a control feedback loop.
    if (type === "play" && room!.playing) return;
    if (type === "pause" && !room!.playing) return;
    if (
      type === "seek" &&
      Math.abs(expectedPosition(room!, now() + offset) - bound.currentTime) <
        0.4
    )
      return;
    void command(
      type === "seek" ? { type, position: bound.currentTime } : { type },
    );
  };
  function bindVideo() {
    const candidate = [...document.querySelectorAll("video")]
      .filter((v) => v.getBoundingClientRect().width > 0)
      .sort(
        (a, b) =>
          b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
      )[0];
    if (candidate === bound) return;
    if (bound) {
      bound.removeEventListener("play", onPlay);
      bound.removeEventListener("pause", onPause);
      bound.removeEventListener("seeked", onSeek);
      bound.removeEventListener("ended", onEnd);
    }
    bound = candidate || null;
    if (bound) {
      bound.addEventListener("play", onPlay);
      bound.addEventListener("pause", onPause);
      bound.addEventListener("seeked", onSeek);
      bound.addEventListener("ended", onEnd);
    } else if (room)
      notice(
        "No accessible video player found. Start playback on the service first.",
      );
  }
  const onPlay = () => nativeAction("play"),
    onPause = () => nativeAction("pause"),
    onSeek = () => nativeAction("seek"),
    onEnd = () => {
      if (room?.hostId === self && matches() && !adActive())
        void command({ type: "ended" });
    };
  async function useTitle() {
    const source = current();
    if (!source) {
      notice("Open a supported video title page first.");
      return;
    }
    await command({
      type: "source",
      media: {
        url: source.url,
        title: source.title,
        duration: source.duration,
      },
      enqueue: false,
    });
  }
  async function connect(fresh = false) {
    const result = await chrome.runtime.sendMessage({
      type: "foyer:connect",
      server: input("server").value,
      name: input("name").value,
      code: input("code").value,
      fresh,
    });
    if (!result?.ok) notice(result?.error || "Could not connect.");
    else notice("Connecting to your Foyer server…");
  }
  button("toggle").onclick = () => $("panel").classList.toggle("hidden");
  button("connect").onclick = () => void connect();
  button("fresh").onclick = () => void connect(true);
  button("play").onclick = () => void command({ type: "play" });
  button("pause").onclick = () => void command({ type: "pause" });
  button("sync").onclick = () => {
    const code = room?.code;
    if (!code || status !== "Connected") {
      notice("Reconnect before syncing.");
      return;
    }
    if (room?.hostId !== self) {
      notice("Only the host can synchronize the room.");
      return;
    }
    notice("Pausing the room and checking every device…");
    void chrome.runtime
      .sendMessage({ type: "foyer:sync" })
      .then((result: Result) => {
        if (room?.code !== code) return;
        if (!result?.ok || !result.room) {
          notice(result?.error || "Sync check failed.");
          return;
        }
        room = acceptSnapshot(room, result.room);
        apply(true);
        notice(
          bound && matches() && !adActive() && bound.readyState >= 2
            ? "Device delays checked. This player is following the room."
            : "Device delays checked. Waiting for the matching source to become ready.",
        );
      })
      .catch(() => notice("Reconnect before syncing."));
  };
  button("bind").onclick = () => void useTitle();
  button("seekbutton").onclick = () =>
    void command({ type: "seek", position: Number(input("seek").value) });
  input("ad").onchange = () => {
    manualAd = input("ad").checked;
    apply();
  };
  button("transfer").onclick = () =>
    void command({
      type: "transfer",
      participantId: $<HTMLSelectElement>("participants").value,
    });
  button("open").onclick = () => {
    if (
      room?.media.url &&
      ["netflix", "prime", "hotstar"].includes(room.media.provider || "")
    )
      location.href = room.media.url;
    else
      window.open(
        input("server").value + "/?room=" + room?.code,
        "_blank",
        "noopener",
      );
  };
  button("copy").onclick = () => {
    if (room)
      void navigator.clipboard
        .writeText(
          `${input("server").value.replace(/\/$/, "")}/?room=${room.code}`,
        )
        .then(() => notice("Invite copied."))
        .catch(() =>
          notice(`Invite: ${input("server").value}/?room=${room!.code}`),
        );
  };
  button("leave").onclick = () => {
    void chrome.runtime.sendMessage({ type: "foyer:disconnect" });
    room = null;
    self = "";
    status = "Disconnected";
    $("setup").classList.remove("hidden");
    $("room").classList.add("hidden");
    notice("Left the room.");
  };
  $<HTMLFormElement>("messageform").onsubmit = (e) => {
    e.preventDefault();
    void command({
      type: "chat",
      text: input("message").value,
      spoiler: false,
    });
    input("message").value = "";
  };
  $("reactions")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () =>
          void command({ type: "reaction", emoji: b.textContent })),
    );
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    switch (message.type) {
      case "foyer:sync-check": {
        const clientReceivedAt = now(),
          packet = message.packet;
        void (async () => {
          let aligned = !packet.barrierId;
          if (
            packet.barrierId &&
            room?.syncBarrier?.id === packet.barrierId &&
            matches() &&
            bound &&
            !adActive()
          ) {
            try {
              bound.pause();
              bound.playbackRate = 1;
              if (
                bound.readyState >= 2 &&
                !bound.seeking &&
                Math.abs(bound.currentTime - packet.targetPosition) > 0.01
              )
                bound.currentTime = packet.targetPosition;
              const until = performance.now() + 1000;
              while (bound.seeking && performance.now() < until)
                await new Promise((resolve) => setTimeout(resolve, 20));
              aligned =
                bound.paused &&
                Math.abs(bound.currentTime - packet.targetPosition) * 1000 <=
                  packet.toleranceMs;
            } catch {
              aligned = false;
            }
          }
          respond({
            id: packet.id,
            sequence: packet.sequence,
            mediaRevision: room?.mediaRevision ?? -1,
            clientReceivedAt,
            clientSentAt: now(),
            ready:
              aligned &&
              !!room &&
              room.code === packet.code &&
              room.mediaRevision === packet.mediaRevision &&
              matches() &&
              !adActive() &&
              !!bound &&
              bound.readyState >= 2 &&
              bound.seekable.length > 0 &&
              !bound.seeking,
            autoplayBlocked: false,
            paused: bound?.paused,
            position: bound?.currentTime,
          });
        })();
        return true;
      }
      case "foyer:toggle":
        $("panel").classList.toggle("hidden");
        break;
      case "foyer:clock":
        offset = message.offset;
        rtt = message.rtt;
        break;
      case "foyer:error":
        notice(message.error);
        break;
      case "foyer:status":
        status = message.status;
        render();
        break;
      case "foyer:joined":
        room = message.room;
        self = message.self;
        offset = message.offset;
        input("code").value = room!.code;
        render();
        bindVideo();
        if (room!.hostId === self && message.created) void useTitle();
        break;
      case "foyer:state":
        room = acceptSnapshot(room, message.room);
        render();
        apply();
        break;
      case "foyer:reaction":
        notice(`${message.data.name} ${message.data.emoji}`);
        break;
    }
  });
  void chrome.storage.local
    .get(["server", "name"])
    .then((settings: { server?: unknown; name?: unknown }) => {
      if (typeof settings.server === "string")
        input("server").value = settings.server;
      if (typeof settings.name === "string")
        input("name").value = settings.name;
    });
  setInterval(() => {
    bindVideo();
    apply();
  }, 250);
}
