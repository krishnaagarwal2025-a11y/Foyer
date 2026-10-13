import React, { useEffect, useRef, useState } from "react";
import type { Movie } from "../shared/types";
import { normalizeSource } from "../shared/media";

export function MusicDiscovery({
  command,
  canControl,
  connected,
}: {
  command: (v: Record<string, unknown>) => void;
  canControl: boolean;
  connected: boolean;
}) {
  const [provider, setProvider] = useState("youtube"),
    [query, setQuery] = useState(""),
    [tracks, setTracks] = useState<Movie[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [searched, setSearched] = useState(false),
    [nav, setNav] = useState(false),
    [key, setKey] = useState(sessionStorage.getItem("foyer-library-key") || "");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/providers", { signal: c.signal })
      .then((r) => r.json())
      .then((v) => setNav(!!v.navidrome))
      .catch(() => {});
    return () => {
      c.abort();
      request.current?.abort();
    };
  }, []);
  async function search() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError("");
    setSearched(true);
    setTracks([]);
    try {
      if (key) sessionStorage.setItem("foyer-library-key", key);
      const response = await fetch(
        `/api/music?provider=${provider}&q=${encodeURIComponent(query)}`,
        {
          headers:
            provider === "navidrome" ? { "X-Foyer-Library-Key": key } : {},
          signal: controller.signal,
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Music search unavailable.");
      if (!Array.isArray(result))
        throw Error("Music search returned an unexpected response.");
      if (request.current === controller) setTracks(result);
    } catch (failure) {
      if (request.current === controller)
        setError(
          controller.signal.aborted
            ? "Search timed out. Try again."
            : failure instanceof Error
              ? failure.message
              : "Music search unavailable.",
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }
  const play = (track: Movie, enqueue = false) =>
    command({
      type: "library",
      provider: track.provider,
      sourceId: track.sourceId,
      enqueue,
      start: !enqueue,
    });
  return (
    <section className="panel music-discovery">
      <div className="section-heading">
        <div>
          <div className="eyebrow">MUSIC SEARCH</div>
          <h2>Find a song</h2>
        </div>
      </div>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="Search songs"
          maxLength={100}
          placeholder="Song, artist or album"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          required={provider === "youtube"}
        />
        <select
          aria-label="Music provider"
          value={provider}
          onChange={(e) => {
            request.current?.abort();
            request.current = null;
            setProvider(e.target.value);
            setTracks([]);
            setError("");
            setLoading(false);
            setSearched(false);
          }}
        >
          <option value="youtube">YouTube Music</option>
          <option value="audius">Audius</option>
          <option value="navidrome" disabled={!nav}>
            Navidrome {nav ? "" : "(not configured)"}
          </option>
        </select>
        <button className="primary" disabled={loading}>
          {loading ? "Searching…" : "Search music"}
        </button>
      </form>
      {provider === "navidrome" && (
        <label>
          Private library access code
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            maxLength={128}
          />
        </label>
      )}
      <p className="music-search-help">
        Choose a result to play it here.{" "}
        {canControl
          ? "Everyone can add to the queue."
          : "The host starts playback; you can add songs to the queue."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="track-list" aria-busy={loading}>
        {tracks.map((track) => (
          <article className="track" key={track.id}>
            {track.artwork ? (
              <img
                alt=""
                src={track.artwork}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="track-icon">♪</div>
            )}
            <div>
              <strong>{track.title}</strong>
              <small>
                {track.artist || "Independent artist"} ·{" "}
                {track.durationEstimated
                  ? "Duration checked on playback"
                  : `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}`}
              </small>
            </div>
            <div className="track-actions">
              <button
                aria-label={`Play ${track.title}`}
                disabled={!canControl}
                onClick={() => play(track)}
              >
                Play
              </button>
              <button
                aria-label={`Queue ${track.title}`}
                disabled={!connected}
                onClick={() => play(track, true)}
              >
                ＋
              </button>
            </div>
          </article>
        ))}
      </div>
      {!loading && !tracks.length && !error && (
        <p className="empty">
          {searched
            ? "No songs found. Try a different title or artist."
            : "Search YouTube Music or discover independent tracks on Audius."}
        </p>
      )}
      <details className="song-link-fallback">
        <summary>Add a song link</summary>
        <form
          className="youtube-music-links"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(
              e.currentTarget,
              (e.nativeEvent as SubmitEvent).submitter,
            );
            try {
              if (
                normalizeSource(String(form.get("url"))).provider !== "youtube"
              )
                throw Error(
                  "Paste an individual YouTube or YouTube Music song link.",
                );
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Invalid song link.",
              );
              return;
            }
            setError("");
            command({
              type: "source",
              enqueue: form.get("action") === "queue",
              media: {
                url: String(form.get("url")),
                title: String(form.get("title") || "YouTube Music song"),
                duration: 3600,
              },
            });
          }}
        >
          <input
            name="title"
            aria-label="YouTube Music song title"
            placeholder="Song title (optional)"
            maxLength={100}
          />
          <input
            name="url"
            aria-label="YouTube Music song URL"
            placeholder="YouTube or YouTube Music share link"
            type="url"
            required
            maxLength={2000}
          />
          <div className="card-actions">
            <button name="action" value="play" disabled={!canControl}>
              Play song
            </button>
            <button name="action" value="queue" disabled={!connected}>
              Queue song
            </button>
          </div>
        </form>
      </details>
      <p className="provider-note">
        YouTube results use the official video player. Some tracks restrict
        embedding. Audius carries artist-published music.
      </p>
    </section>
  );
}
