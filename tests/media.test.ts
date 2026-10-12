import { describe, expect, it } from "vitest";
import {
  isPlayable,
  isListeningSource,
  normalizeSource,
} from "../shared/media";

describe("provider-aware media links", () => {
  it("normalizes YouTube watch, short, and Shorts URLs to visible embeds", () => {
    for (const input of [
      "https://www.youtube.com/watch?v=abcdefghijk&t=90",
      "https://youtu.be/abcdefghijk?t=90",
      "https://youtube.com/shorts/abcdefghijk",
      "https://m.youtube.com/live/abcdefghijk?feature=share",
    ]) {
      const movie = normalizeSource(input, "A video", 120);
      expect(movie.provider).toBe("youtube");
      expect(movie.kind).toBe("video");
      expect(movie.sourceId).toBe("abcdefghijk");
      expect(movie.url).toBe("https://www.youtube.com/watch?v=abcdefghijk");
      expect(isPlayable(movie)).toBe(true);
    }
  });

  it("recognizes Vimeo, SoundCloud, HLS and audio-only files", () => {
    expect(normalizeSource("https://vimeo.com/123456789").provider).toBe(
      "vimeo",
    );
    expect(normalizeSource("https://soundcloud.com/artist/song").kind).toBe(
      "audio",
    );
    expect(normalizeSource("https://media.example/show.m3u8").provider).toBe(
      "direct",
    );
    for (const extension of [
      "mp3",
      "m4a",
      "aac",
      "wav",
      "flac",
      "oga",
      "ogg",
      "opus",
    ])
      expect(
        normalizeSource(`https://media.example/song.${extension}`).kind,
      ).toBe("audio");
    expect(normalizeSource("https://media.example/clip.ogv").kind).toBe(
      "video",
    );
  });

  it("accepts individual YouTube Music songs for Listen without hiding their video", () => {
    const song = normalizeSource(
      "https://music.youtube.com/watch?v=abcdefghijk&list=RDAMVMabcdefghijk",
    );
    expect(song.url).toBe("https://www.youtube.com/watch?v=abcdefghijk");
    expect(song.kind).toBe("video");
    expect(isListeningSource(song)).toBe(true);
    expect(
      isListeningSource(normalizeSource("https://example.org/movie.mp4")),
    ).toBe(false);
    expect(() =>
      normalizeSource("https://music.youtube.com/playlist?list=PL123"),
    ).toThrow(/link/i);
  });

  it("identifies commercial services as extension-controlled sources", () => {
    const services = [
      ["https://www.netflix.com/watch/8123456789", "netflix", "8123456789"],
      ["https://www.primevideo.com/detail/B0C1234567", "prime", "B0C1234567"],
      [
        "https://www.amazon.in/gp/video/detail/B0C1234567",
        "prime",
        "B0C1234567",
      ],
      [
        "https://www.amazon.co.uk/gp/video/detail/B0C1234567",
        "prime",
        "B0C1234567",
      ],
      [
        "https://www.hotstar.com/in/movies/title/1260000011",
        "hotstar",
        "1260000011",
      ],
      [
        "https://www.jiohotstar.com/in/movies/title/1260000011",
        "hotstar",
        "1260000011",
      ],
    ] as const;
    for (const [url, provider, sourceId] of services) {
      const movie = normalizeSource(url);
      expect(movie.provider).toBe(provider);
      expect(movie.kind).toBe("external");
      expect(movie.sourceId).toBe(sourceId);
      expect(movie.description).toMatch(/companion extension/i);
      expect(isPlayable(movie)).toBe(true);
    }
  });

  it("rejects malformed, unsupported, credential-bearing and unsafe links", () => {
    for (const url of [
      "javascript:alert(1)",
      "https://youtube.com/watch?v=short",
      "https://youtube.com.evil.example/watch?v=abcdefghijk",
      "https://netflix.com/browse",
      "https://primevideo.com/detail/nope",
      "https://hotstar.com/movie/no-id",
      "https://user:password@media.example/video.mp4",
      "https://media.example/watch/without-a-media-file",
    ])
      expect(() => normalizeSource(url)).toThrow();
  });
});
