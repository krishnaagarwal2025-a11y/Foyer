import type { Movie } from "../shared/types.js";
import type { Innertube } from "youtubei.js";

let client: Promise<Innertube> | undefined;
const active = new Map<string, Promise<Movie[]>>();
export function youtubeMovie(track: {
  id?: string;
  title?: string;
  artists?: { name: string }[];
  duration?: { seconds: number };
  thumbnails?: { url: string; width: number }[];
}): Movie | null {
  if (!track.id || !/^[\w-]{11}$/.test(track.id) || !track.title) return null;
  const duration = Number(track.duration?.seconds),
    known = Number.isFinite(duration) && duration > 0 && duration <= 43200;
  const artwork = [...(track.thumbnails || [])]
    .sort((a, b) => b.width - a.width)
    .find((t) => t.url.startsWith("https://"))?.url;
  return {
    id: `youtube:${track.id}`,
    sourceId: track.id,
    provider: "youtube",
    kind: "video",
    title: track.title.slice(0, 100),
    artist:
      track.artists
        ?.map((a) => a.name)
        .join(", ")
        .slice(0, 100) || "YouTube Music",
    duration: known ? duration : 3600,
    durationEstimated: !known,
    genres: ["Music"],
    tags: ["YouTube Music"],
    description:
      "YouTube Music search result. Plays in the official visible YouTube player; availability depends on the uploader.",
    color: "#71717a",
    url: `https://www.youtube.com/watch?v=${track.id}`,
    artwork,
  };
}
export async function searchYouTube(query: string): Promise<Movie[]> {
  const key = query.toLocaleLowerCase();
  const pending = active.get(key);
  if (pending) return pending;
  if (active.size >= 6) throw Error("Search is busy. Retry shortly.");
  const work = runSearch(query);
  active.set(key, work);
  try {
    return await work;
  } finally {
    active.delete(key);
  }
}
async function runSearch(query: string): Promise<Movie[]> {
  // Metadata only: never obtain or decipher direct YouTube audio/video streams,
  // authenticate user accounts, or proxy provider media.
  if (!client)
    client = import("youtubei.js")
      .then(({ Innertube }) =>
        Innertube.create({
          retrieve_player: false,
          generate_session_locally: true,
          lang: "en",
          location: "IN",
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
        }),
      )
      .catch((error) => {
        client = undefined;
        throw error;
      });
  const youtube = await client;
  const response = await youtube.music.search(query, { type: "song" });
  return (response.songs?.contents || [])
    .slice(0, 20)
    .map((t) => youtubeMovie(t))
    .filter((t): t is Movie => !!t);
}
