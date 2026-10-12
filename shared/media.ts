import type { Movie } from "./types";
export const externalProviders = ["netflix", "prime", "hotstar"];
export function isPlayable(movie: Movie) {
  return Boolean(movie.url || movie.sourceId);
}
// YouTube songs retain the full visible official video player in Listen rooms.
export function isListeningSource(movie: Movie) {
  return movie.kind === "audio" || movie.provider === "youtube";
}
export function normalizeSource(
  raw: string,
  title = "Untitled",
  duration = 3600,
): Movie {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    raw.length > 2000
  )
    throw Error("Use an HTTP(S) source without embedded credentials.");
  const host = url.hostname.toLowerCase(),
    parts = url.pathname.split("/").filter(Boolean);
  let provider: Movie["provider"] = "direct",
    kind: Movie["kind"] = "video",
    sourceId: string | undefined;
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "music.youtube.com",
      "m.youtube.com",
      "youtu.be",
      "www.youtube-nocookie.com",
      "youtube-nocookie.com",
    ].includes(host)
  ) {
    provider = "youtube";
    sourceId =
      host === "youtu.be"
        ? parts[0]
        : url.searchParams.get("v") ||
          (["shorts", "embed", "live"].includes(parts[0])
            ? parts[1]
            : undefined);
    if (!sourceId || !/^[\w-]{11}$/.test(sourceId))
      throw Error(
        "Use a YouTube video, Shorts, or individual YouTube Music song link with a video ID.",
      );
    url.href = `https://www.youtube.com/watch?v=${sourceId}`;
  } else if (
    ["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host)
  ) {
    provider = "vimeo";
    sourceId = parts.find((p) => /^\d+$/.test(p));
    if (!sourceId) throw Error("Use a Vimeo video link.");
  } else if (["soundcloud.com", "www.soundcloud.com"].includes(host)) {
    provider = "soundcloud";
    kind = "audio";
    if (parts.length < 2) throw Error("Use a SoundCloud track link.");
    sourceId = parts.join("/");
  } else if (["www.netflix.com", "netflix.com"].includes(host)) {
    provider = "netflix";
    kind = "external";
    sourceId =
      parts[0] === "watch" && /^\d+$/.test(parts[1]) ? parts[1] : undefined;
    if (!sourceId)
      throw Error("Use a Netflix /watch/ link, not a browse page.");
    url.href = `https://www.netflix.com/watch/${sourceId}`;
  } else if (
    [
      "www.primevideo.com",
      "primevideo.com",
      "www.amazon.com",
      "www.amazon.in",
      "www.amazon.co.uk",
      "www.amazon.de",
      "www.amazon.co.jp",
    ].includes(host)
  ) {
    provider = "prime";
    kind = "external";
    const index = parts.indexOf("detail");
    sourceId = parts[index + 1];
    if (index < 0 || !sourceId || !/^[A-Z0-9]{10,40}$/i.test(sourceId))
      throw Error("Use a Prime Video title detail link.");
  } else if (
    [
      "www.hotstar.com",
      "hotstar.com",
      "www.jiohotstar.com",
      "jiohotstar.com",
    ].includes(host)
  ) {
    provider = "hotstar";
    kind = "external";
    sourceId = [...parts].reverse().find((p) => /^\d{6,}$/.test(p));
    if (!sourceId) throw Error("Use a Hotstar/JioHotstar video title link.");
  } else if (/\.(mp3|m4a|aac|wav|flac|oga|ogg|opus)$/i.test(url.pathname))
    kind = "audio";
  else if (!/\.(mp4|webm|ogv|m3u8)$/i.test(url.pathname))
    throw Error(
      "Supported links: YouTube, Vimeo, SoundCloud, Netflix, Prime Video, Hotstar, or direct audio, MP4/WebM/Ogg-video, or HLS files.",
    );
  if (!Number.isFinite(duration) || duration <= 0 || duration > 43200)
    throw Error("Duration must be between 1 second and 12 hours.");
  url.hash = "";
  return {
    id: `${provider}:${sourceId || url.href}`,
    provider,
    kind,
    sourceId,
    url: url.href,
    title: title.trim().slice(0, 100) || "Untitled",
    duration,
    description:
      kind === "external"
        ? "Requires the Foyer companion extension and your own service access."
        : "Imported source",
    genres: [],
    tags: [],
    color: kind === "audio" ? "#57bda8" : "#b28afb",
  };
}
