import { it, expect } from "vitest";
import { youtubeMovie } from "../server/youtube-search";
it("maps metadata to an official embed source without manufacturing known durations", () => {
  const movie = youtubeMovie({
    id: "M7lc1UVf-VE",
    title: "Song",
    artists: [{ name: "Artist" }],
    duration: { seconds: 207 },
    thumbnails: [{ url: "https://i.ytimg.com/a.jpg", width: 120 }],
  });
  expect(movie?.url).toBe("https://www.youtube.com/watch?v=M7lc1UVf-VE");
  expect(movie?.artist).toBe("Artist");
  expect(movie?.duration).toBe(207);
  expect(movie?.durationEstimated).toBe(false);
  const unknown = youtubeMovie({ id: "M7lc1UVf-VE", title: "Unknown" });
  expect(unknown?.durationEstimated).toBe(true);
  expect(youtubeMovie({ id: "bad/path", title: "Bad" })).toBeNull();
});
