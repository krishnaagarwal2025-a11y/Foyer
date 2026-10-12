import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { Movie } from "../../shared/types";
export interface PlaybackHandle {
  currentTime: number;
  duration: number;
  readonly paused: boolean;
  readonly readyState: number;
  readonly seekable: { length: number };
  readonly seeking: boolean;
  readonly buffering?: boolean;
  muted: boolean;
  playbackRate: number;
  readonly supportsRate?: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
}
type Props = {
  media: Movie;
  revision: number;
  muted: boolean;
  onReady: () => void;
  onPlaying: () => void;
  onSeeked: () => void;
  onEnded: () => void;
  onError: (message: string) => void;
  onWaiting: () => void;
  onProviderControl: (
    type: "play" | "pause" | "seek",
    position?: number,
  ) => boolean;
};
const scripts = new Map<string, Promise<void>>();
function loadScript(url: string) {
  if (!scripts.has(url))
    scripts.set(
      url,
      new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          scripts.delete(url);
          script.remove();
          reject(
            Error(
              "Provider player could not load. Check your connection and retry.",
            ),
          );
        };
        document.head.appendChild(script);
      }),
    );
  return scripts.get(url)!;
}
type YTPlayer = {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(t: number, a: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  destroy(): void;
};
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        options: Record<string, unknown>,
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
    SC?: {
      Widget: ((el: HTMLIFrameElement) => SCPlayer) & {
        Events: Record<string, string>;
      };
    };
  }
}
type SCPlayer = {
  bind(event: string, fn: (data?: unknown) => void): void;
  unbind(event: string): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  setVolume(v: number): void;
  getPosition(fn: (value: number) => void): void;
  getDuration(fn: (value: number) => void): void;
  isPaused(fn: (value: boolean) => void): void;
};
export const FoyerPlayer = forwardRef<PlaybackHandle, Props>(
  function FoyerPlayer(props, ref) {
    const native = useRef<HTMLMediaElement | null>(null),
      container = useRef<HTMLDivElement | null>(null),
      iframe = useRef<HTMLIFrameElement | null>(null),
      adapter = useRef<PlaybackHandle | null>(null),
      callbacks = useRef(props);
    callbacks.current = props;
    const proxy = useMemo(
      () =>
        new Proxy({} as PlaybackHandle, {
          get: (_target, key) => {
            const a = adapter.current;
            if (!a) {
              if (key === "play")
                return () => Promise.reject(Error("Player is not ready"));
              if (key === "pause" || key === "load") return () => {};
              if (key === "seekable") return { length: 0 };
              if (key === "paused") return true;
              if (key === "duration") return props.media.duration;
              return 0;
            }
            const value = Reflect.get(a, key, a);
            return typeof value === "function" ? value.bind(a) : value;
          },
          set: (_target, key, value) => {
            if (adapter.current)
              Reflect.set(adapter.current, key, value, adapter.current);
            return true;
          },
        }),
      [],
    );
    useImperativeHandle(ref, () => proxy, [proxy]);
    useEffect(() => {
      let disposed = false,
        readinessReported = false,
        cleanup = () => {};
      adapter.current = null;
      const m = props.media,
        p = m.provider || "direct";
      const error = (message: string) => {
        if (!disposed) callbacks.current.onError(message);
      };
      const ready = () => {
        if (!disposed && !readinessReported) {
          readinessReported = true;
          callbacks.current.onReady();
        }
      };
      if (m.kind === "external") return;
      if (["direct", "audius", "navidrome"].includes(p)) {
        const el = native.current!;
        adapter.current = el as PlaybackHandle;
        if (p === "navidrome") {
          const controller = new AbortController();
          void fetch(`/api/music/ticket/${encodeURIComponent(m.sourceId!)}`, {
            method: "POST",
            headers: {
              "X-Foyer-Library-Key":
                sessionStorage.getItem("foyer-library-key") || "",
            },
            signal: controller.signal,
          })
            .then(async (response) => {
              const result = await response.json();
              if (!response.ok) throw Error(result.error);
              if (!disposed) {
                el.src = result.url;
                el.load();
              }
            })
            .catch((e) => {
              if (!disposed)
                error(
                  e instanceof Error
                    ? e.message
                    : "Library access unavailable.",
                );
            });
          cleanup = () => controller.abort();
        }
        if (
          m.url &&
          /\.m3u8(?:\?|$)/i.test(m.url) &&
          !el.canPlayType("application/vnd.apple.mpegurl")
        ) {
          void import("hls.js")
            .then(({ default: Hls }) => {
              if (disposed) return;
              if (!Hls.isSupported()) {
                error("This browser does not support HLS playback.");
                return;
              }
              const hls = new Hls({ enableWorker: true });
              hls.loadSource(m.url!);
              hls.attachMedia(el);
              adapter.current = new Proxy(el as PlaybackHandle, {
                get: (target, key) => {
                  if (key === "load") return () => hls.startLoad();
                  const value = Reflect.get(target, key, target);
                  return typeof value === "function"
                    ? value.bind(target)
                    : value;
                },
                set: (target, key, value) =>
                  Reflect.set(target, key, value, target),
              });
              hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal)
                  error(
                    `HLS playback failed (${data.type}). Check the source or select the local demo.`,
                  );
              });
              cleanup = () => hls.destroy();
            })
            .catch((cause: unknown) =>
              error(
                cause instanceof Error
                  ? cause.message
                  : "HLS playback could not be loaded.",
              ),
            );
        }
        // A cached source can finish before the lazy adapter effect runs. Native
        // media will not replay `loadedmetadata` for a listener attached later,
        // so reconcile the already-ready element with the room revision here.
        else if (el.readyState >= 2 && el.currentSrc) {
          const readinessFallback = setTimeout(() => {
            if (el.readyState >= 2 && el.currentSrc) ready();
          }, 0);
          const previousCleanup = cleanup;
          cleanup = () => {
            clearTimeout(readinessFallback);
            previousCleanup();
          };
        }
      } else {
        let position = 0,
          duration = m.duration,
          paused = true,
          loaded = false,
          seeking = false,
          buffering = false,
          isMuted = props.muted;
        let play = async () => {},
          pause = () => {},
          seek = (_t: number) => {},
          volume = (_m: boolean) => {},
          query = () => {},
          destroy = () => {};
        adapter.current = {
          get currentTime() {
            return position;
          },
          set currentTime(t) {
            seeking = true;
            seek(t);
          },
          get duration() {
            return duration;
          },
          get paused() {
            return paused;
          },
          get readyState() {
            return loaded ? 2 : 0;
          },
          get seekable() {
            return { length: loaded ? 1 : 0 };
          },
          get seeking() {
            return seeking;
          },
          get buffering() {
            return buffering;
          },
          get muted() {
            return isMuted;
          },
          set muted(v) {
            isMuted = v;
            volume(v);
          },
          playbackRate: 1,
          supportsRate: false,
          play: () => play(),
          pause: () => pause(),
          load: () => {
            if (loaded) {
              query();
              ready();
            }
          },
        };
        const timer = setInterval(() => {
          if (loaded && !disposed) query();
        }, 100);
        const timeout = setTimeout(() => {
          if (!loaded)
            error(
              "The streaming player did not become ready. Retry or choose a different source.",
            );
        }, 20000);
        const onReady = () => {
          loaded = true;
          clearTimeout(timeout);
          volume(isMuted);
          ready();
        };
        const completeSeek = () => {
          seeking = false;
          if (!disposed) callbacks.current.onSeeked();
        };
        (async () => {
          if (p === "youtube") {
            if (!window.YT?.Player) {
              await loadScript("https://www.youtube.com/iframe_api");
              await new Promise<void>((resolve, reject) => {
                if (window.YT?.Player) {
                  resolve();
                  return;
                }
                const previous = window.onYouTubeIframeAPIReady;
                const t = setTimeout(
                  () => reject(Error("YouTube API timed out.")),
                  10000,
                );
                window.onYouTubeIframeAPIReady = () => {
                  clearTimeout(t);
                  previous?.();
                  resolve();
                };
              });
            }
            if (disposed) return;
            const mount = document.createElement("div");
            container.current!.replaceChildren(mount);
            let pendingPlay: Promise<void> | undefined;
            let finishPlay: (() => void) | undefined;
            let failPlay: ((error: Error) => void) | undefined;
            let playTimeout: ReturnType<typeof setTimeout> | undefined;
            let intendedState: number | undefined;
            let commandUntil = 0;
            let seekTarget: number | undefined;
            let seekDeadline = 0;
            const settlePlay = (failure?: Error) => {
              clearTimeout(playTimeout);
              const resolve = finishPlay,
                reject = failPlay;
              pendingPlay = undefined;
              finishPlay = undefined;
              failPlay = undefined;
              if (failure) reject?.(failure);
              else resolve?.();
            };
            const player = new window.YT!.Player(mount, {
              width: "100%",
              height: "100%",
              videoId: m.sourceId,
              playerVars: { playsinline: 1, origin: location.origin, rel: 0 },
              events: {
                onReady: () => {
                  duration = player.getDuration() || m.duration;
                  onReady();
                },
                onStateChange: (e: { data: number }) => {
                  if (disposed) return;
                  buffering = e.data === 3;
                  if (e.data === 1) {
                    paused = false;
                    settlePlay();
                  } else if ([0, 2, 5, -1].includes(e.data)) paused = true;
                  const commanded =
                    seeking ||
                    e.data === intendedState ||
                    (intendedState !== undefined &&
                      performance.now() < commandUntil);
                  if (e.data === intendedState) intendedState = undefined;
                  query();
                  const userAction =
                    loaded &&
                    [1, 2].includes(e.data) &&
                    !commanded &&
                    callbacks.current.onProviderControl(
                      e.data === 1 ? "play" : "pause",
                    );
                  if (e.data === 1 && !userAction)
                    callbacks.current.onPlaying();
                  if ([2, 5].includes(e.data) && loaded && !userAction)
                    callbacks.current.onReady();
                  if (e.data === 0) callbacks.current.onEnded();
                  if (e.data === 3) callbacks.current.onWaiting();
                },
                onError: (e: { data: number }) => {
                  buffering = false;
                  const message =
                    e.data === 153
                      ? "YouTube needs a browser referrer to play this video. Open Foyer in Chrome or Edge and retry."
                      : `YouTube cannot play this video (code ${e.data}). It may be private, restricted, or have embedding disabled. Try another link or open it on YouTube.`;
                  settlePlay(Error(message));
                  error(message);
                },
                onAutoplayBlocked: () => {
                  buffering = false;
                  const message =
                    "Autoplay was blocked. Click to sync and play.";
                  settlePlay(Error(message));
                  error(message);
                },
              },
            });
            play = () => {
              if (player.getPlayerState() === 1) return Promise.resolve();
              if (pendingPlay) return pendingPlay;
              intendedState = 1;
              commandUntil = performance.now() + 1500;
              pendingPlay = new Promise<void>((resolve, reject) => {
                finishPlay = resolve;
                failPlay = reject;
              });
              playTimeout = setTimeout(() => {
                buffering = false;
                settlePlay(
                  Error(
                    "Playback did not start. Click to sync and play, or check the video's availability.",
                  ),
                );
              }, 8000);
              const request = pendingPlay;
              player.playVideo();
              return request;
            };
            pause = () => {
              if (player.getPlayerState() === 2 || intendedState === 2) return;
              intendedState = 2;
              commandUntil = performance.now() + 1500;
              settlePlay();
              player.pauseVideo();
            };
            seek = (t) => {
              seekTarget = t;
              seekDeadline = performance.now() + 3000;
              commandUntil = performance.now() + 1500;
              player.seekTo(t, true);
            };
            volume = (v) => (v ? player.mute() : player.unMute());
            query = () => {
              const previous = position;
              position = player.getCurrentTime() || 0;
              duration = player.getDuration() || duration;
              const state = player.getPlayerState();
              buffering = state === 3;
              if (state === 1) paused = false;
              else if ([0, 2, 5, -1].includes(state)) paused = true;
              if (
                seekTarget !== undefined &&
                !buffering &&
                (Math.abs(position - seekTarget) < 0.5 ||
                  performance.now() > seekDeadline)
              ) {
                seekTarget = undefined;
                completeSeek();
              } else if (
                !seeking &&
                loaded &&
                !buffering &&
                performance.now() > commandUntil &&
                Math.abs(position - previous) > 1.5
              ) {
                callbacks.current.onProviderControl("seek", position);
              }
            };
            destroy = () => {
              settlePlay();
              player.destroy();
            };
          } else if (p === "vimeo") {
            const { default: VimeoPlayer } = await import("@vimeo/player");
            if (disposed) return;
            const player = new VimeoPlayer(container.current!, {
              url: m.url! as `https://vimeo.com/${string}`,
              autopause: false,
              playsinline: true,
            });
            destroy = () => {
              void player.destroy().catch(() => {});
            };
            await player.ready();
            if (disposed) {
              destroy();
              return;
            }
            duration = await player.getDuration();
            play = () => player.play();
            pause = () => {
              void player.pause().catch(() => {});
            };
            seek = (t) => {
              void player
                .setCurrentTime(t)
                .then((value) => {
                  position = value;
                  completeSeek();
                })
                .catch((e) => {
                  seeking = false;
                  error(String(e));
                });
            };
            volume = (v) => {
              void player.setMuted(v).catch(() => {});
            };
            query = () => {
              void Promise.all([player.getCurrentTime(), player.getPaused()])
                .then(([t, p]) => {
                  position = t;
                  paused = p;
                })
                .catch(() => {});
            };
            player.on("play", () => {
              paused = false;
              callbacks.current.onPlaying();
            });
            player.on("pause", () => (paused = true));
            player.on("ended", () => callbacks.current.onEnded());
            player.on("bufferstart", () => callbacks.current.onWaiting());
            player.on("error", (e) =>
              error(`Vimeo playback failed: ${e.name}`),
            );
            onReady();
          } else if (p === "soundcloud") {
            await loadScript("https://w.soundcloud.com/player/api.js");
            if (disposed) return;
            const widget = window.SC!.Widget(iframe.current!);
            const events = window.SC!.Widget.Events;
            play = async () => widget.play();
            pause = () => widget.pause();
            seek = (t) => {
              widget.seekTo(t * 1000);
              position = t;
              setTimeout(completeSeek, 200);
            };
            volume = (v) => widget.setVolume(v ? 0 : 100);
            query = () => {
              widget.getPosition((t) => (position = t / 1000));
              widget.isPaused((v) => (paused = v));
            };
            widget.bind(events.READY, () =>
              widget.getDuration((t) => {
                duration = t / 1000;
                onReady();
              }),
            );
            widget.bind(events.PLAY, () => {
              paused = false;
              callbacks.current.onPlaying();
            });
            widget.bind(events.PAUSE, () => (paused = true));
            widget.bind(events.FINISH, () => callbacks.current.onEnded());
            widget.bind(events.ERROR, () =>
              error(
                "SoundCloud cannot play this track. It may be private or unavailable.",
              ),
            );
            destroy = () =>
              Object.values(events).forEach((event) => widget.unbind(event));
          }
        })().catch((e) =>
          error(e instanceof Error ? e.message : "Provider unavailable."),
        );
        cleanup = () => {
          clearInterval(timer);
          clearTimeout(timeout);
          destroy();
        };
      }
      return () => {
        disposed = true;
        cleanup();
        adapter.current = null;
      };
    }, [props.media.url, props.media.provider, props.revision]);
    useEffect(() => {
      if (adapter.current) adapter.current.muted = props.muted;
    }, [props.muted]);
    const m = props.media,
      p = m.provider || "direct";
    if (m.kind === "external")
      return (
        <div className="external-screen">
          <span className="eyebrow">FOYER COMPANION · EXPERIMENTAL</span>
          <h2>
            {p === "hotstar"
              ? "Hotstar / JioHotstar"
              : p === "prime"
                ? "Prime Video"
                : "Netflix"}
          </h2>
          <p>
            Watch on the service website with your own access. The Foyer
            extension connects playback to this room.
          </p>
          <a
            className="button-link primary"
            href={m.url}
            target="_blank"
            rel="noreferrer"
          >
            Open streaming title ↗
          </a>
          <a
            className="button-link secondary"
            href="/extension/foyer-extension.zip"
            download
          >
            Download extension
          </a>
          <p className="muted">
            Install instructions and limitations:{" "}
            <a href="/help#extension" target="_blank">
              Foyer help
            </a>
            . This platform adapter requires signed-in verification.
          </p>
        </div>
      );
    if (p === "soundcloud")
      return (
        <iframe
          ref={iframe}
          title="SoundCloud player"
          className="provider-frame"
          allow="autoplay"
          src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(m.url!)}&auto_play=false&visual=true`}
        />
      );
    if (["youtube", "vimeo"].includes(p))
      return (
        <div
          ref={container}
          className="provider-frame"
          aria-label={`${p} player`}
        />
      );
    const events = {
      onLoadedMetadata: () => {
        if (!Number.isFinite(native.current?.duration))
          callbacks.current.onError(
            "Live streams are not synchronized yet. Use an on-demand source.",
          );
        else callbacks.current.onReady();
      },
      onCanPlay: () => callbacks.current.onReady(),
      onPlaying: () => callbacks.current.onPlaying(),
      onSeeked: () => callbacks.current.onSeeked(),
      onEnded: () => callbacks.current.onEnded(),
      onWaiting: () => callbacks.current.onWaiting(),
      onError: () =>
        callbacks.current.onError(
          "This source cannot be played. Check its codec, availability and browser permissions. The host can select the local demo.",
        ),
    };
    if (m.kind === "audio")
      return (
        <div className="audio-screen">
          <div
            className="record-art"
            style={{ "--movie-color": m.color } as React.CSSProperties}
          >
            {m.artwork ? (
              <img src={m.artwork} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>♪</span>
            )}
          </div>
          <h2>{m.title}</h2>
          <p>{m.artist || "A listening room for your people"}</p>
          <span className="pill">
            {p === "audius"
              ? "AUDIUS · OPEN MUSIC"
              : p === "navidrome"
                ? "YOUR NAVIDROME LIBRARY"
                : "AUDIO ONLY"}
          </span>
          <audio
            ref={(node) => {
              native.current = node;
            }}
            src={m.url}
            preload="auto"
            muted={props.muted}
            {...events}
            aria-label="Shared audio player"
          />
        </div>
      );
    return (
      <video
        ref={(node) => {
          native.current = node;
        }}
        src={
          m.url?.match(/\.m3u8(?:\?|$)/i) &&
          !document
            .createElement("video")
            .canPlayType("application/vnd.apple.mpegurl")
            ? undefined
            : m.url
        }
        playsInline
        preload="auto"
        muted={props.muted}
        {...events}
        aria-label="Shared video player"
      />
    );
  },
);
