import React, { useEffect, useState } from "react";
import type { Movie } from "../shared/types";
export function MusicDiscovery({
  command,
  canControl,
  connected,
}: {
  command: (v: Record<string, unknown>) => void;
  canControl: boolean;
  connected: boolean;
}) {
  const [provider, setProvider] = useState("audius"),
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
        <span className="pill">OPEN MUSIC + YOUR LIBRARY</span>
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
          placeholder="Search songs or artists; leave blank for trending…"
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
          <option value="audius">Audius</option>
          <option value="navidrome" disabled={!nav}>
            Navidrome {nav ? "" : "(not configured)"}
          </option>
        </select>
        <button className="primary" disabled={loading}>
          {loading ? "Searching…" : "Find music"}
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
      <p className="muted">
        Audius contains artist-published music, not every commercial song.
        SoundCloud links and direct audio can also be added below. Navidrome
        connects your own collection.
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
      {!loading && !tracks.length && !error && (
        <p className="empty">
          Search the open catalog, or start with the local melody.
        </p>
      )}
    </section>
  );
}
