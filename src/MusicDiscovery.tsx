import React, { useEffect, useState } from "react";
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
    [nav, setNav] = useState(false),
    [key, setKey] = useState(sessionStorage.getItem("foyer-library-key") || "");
  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((v) => setNav(v.navidrome))
      .catch(() => {});
  }, []);
  async function search() {
    setLoading(true);
    setError("");
    try {
      if (key) sessionStorage.setItem("foyer-library-key", key);
      const response = await fetch(
        `/api/music?provider=${provider}&q=${encodeURIComponent(query)}`,
        {
          headers:
            provider === "navidrome" ? { "X-Foyer-Library-Key": key } : {},
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Music search unavailable.");
      setTracks(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Music search unavailable.");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="panel music-discovery">
      <div className="section-heading">
        <div>
          <div className="eyebrow">A SOUNDTRACK FOR YOUR PEOPLE</div>
          <h2>Find your next listen.</h2>
        </div>
        <span className="pill">YOUTUBE + MUSIC LIBRARIES</span>
      </div>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (provider === "youtube") {
            window.open(
              `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
              "_blank",
              "noopener,noreferrer",
            );
            return;
          }
          void search();
        }}
      >
        <input
          aria-label="Search songs"
          maxLength={100}
          placeholder={
            provider === "youtube"
              ? "Find a song or artist on YouTube Music…"
              : "Search songs or artists; leave blank for trending…"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Music provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setTracks([]);
            setError("");
          }}
        >
          <option value="youtube">YouTube Music</option>
          <option value="audius">Audius</option>
          <option value="navidrome" disabled={!nav}>
            Navidrome {nav ? "" : "(not configured)"}
          </option>
        </select>
        <button className="primary" disabled={loading}>
          {provider === "youtube"
            ? "Search YouTube Music ↗"
            : loading
              ? "Searching…"
              : "Find music"}
        </button>
      </form>
      {provider === "youtube" && (
        <form
          className="youtube-music-links"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(
              event.currentTarget,
              (event.nativeEvent as SubmitEvent).submitter,
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
          <p className="muted">
            Search opens YouTube Music. Copy an individual song's share link
            here to listen together. The official video stays visible; some
            songs disallow embedding or require access on YouTube.
          </p>
          <input
            name="title"
            aria-label="YouTube Music song title"
            placeholder="Song title (optional)"
            maxLength={100}
          />
          <input
            name="url"
            aria-label="YouTube Music song URL"
            placeholder="https://music.youtube.com/watch?v=…"
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
      )}
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
      <p className="muted">
        Audius contains artist-published music, not every commercial song.
        YouTube Music, SoundCloud links and direct audio can also be added to
        the room. Navidrome connects your own collection.
      </p>
      {error && (
        <p role="alert" className="error">
          {error} The local demo remains available.
        </p>
      )}
      <div className="track-list">
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
                {track.artist} · {Math.floor(track.duration / 60)}:
                {String(Math.floor(track.duration % 60)).padStart(2, "0")} ·{" "}
                {track.genres.join(", ")}
              </small>
            </div>
            <button
              disabled={!connected}
              onClick={() =>
                command({
                  type: "library",
                  provider: track.provider,
                  sourceId: track.sourceId,
                  enqueue: true,
                })
              }
            >
              ＋ Queue
            </button>
            <button
              disabled={!canControl}
              onClick={() =>
                command({
                  type: "library",
                  provider: track.provider,
                  sourceId: track.sourceId,
                  enqueue: false,
                })
              }
            >
              Listen
            </button>
          </article>
        ))}
      </div>
      {provider !== "youtube" && !loading && !tracks.length && !error && (
        <p className="empty">
          Search the open catalog, or start with the local melody.
        </p>
      )}
    </section>
  );
}
