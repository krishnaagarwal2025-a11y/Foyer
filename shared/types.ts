export type Movie = {
  provider?:
    | "direct"
    | "youtube"
    | "vimeo"
    | "soundcloud"
    | "audius"
    | "navidrome"
    | "netflix"
    | "prime"
    | "hotstar";
  kind?: "video" | "audio" | "external" | "empty";
  sourceId?: string;
  artist?: string;
  artwork?: string;
  id: string;
  title: string;
  description: string;
  genres: string[];
  tags: string[];
  duration: number;
  durationEstimated?: boolean;
  url?: string;
  color: string;
};
export type Participant = {
  id: string;
  name: string;
  connected: boolean;
  joinedAt: number;
  preferences: string[];
  drift?: number;
  playbackStatus?: "ready" | "buffering" | "ad" | "unavailable";
};
export type QueueItem = { id: string; movie: Movie; votes: string[] };
export type Poll = {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
};
export type Chat = {
  id: string;
  name: string;
  text: string;
  spoiler: boolean;
  time: number;
};
export type SyncMeasurement = {
  participantId: string;
  rttMs: number | null;
  samples: number;
  ready: boolean;
  autoplayBlocked: boolean;
  position?: number;
  paused?: boolean;
  alignmentMs?: number;
};
export type Synchronization = {
  id: string;
  code: string;
  reason: "play" | "manual";
  checkedAt: number;
  mediaRevision: number;
  participants: SyncMeasurement[];
  startAt?: number;
};
export type SyncProbe = {
  id: string;
  code: string;
  mediaRevision: number;
  reason: "play" | "manual";
  participants: string[];
  expiresAt: number;
  barrierId?: string;
  targetPosition?: number;
  toleranceMs?: number;
};
export type SyncClockPacket = {
  id: string;
  serverSentAt: number;
  serverReceivedAt: number;
  clientReceivedAt: number;
  clientSentAt: number;
  rttMs: number;
};
export type Room = {
  syncBarrier?: {
    id: string;
    hostId: string;
    startedAt: number;
    position: number;
    mediaRevision: number;
    participants: string[];
    status: "waiting" | "failed";
    error?: string;
  };
  synchronization?: Synchronization;
  lastOperation?: { id: string; type: string };
  code: string;
  hostId: string;
  participants: Participant[];
  media: Movie;
  mediaRevision: number;
  playing: boolean;
  position: number;
  anchor: number;
  version: number;
  queue: QueueItem[];
  polls: Poll[];
  chat: Chat[];
  bookmarks: { id: string; name: string; position: number }[];
  settings: {
    collaborative: boolean;
    autoAdvance: boolean;
    mode?: "watch" | "listen";
  };
};
export type Result = {
  synchronization?: Synchronization;
  ok: boolean;
  error?: string;
  room?: Room;
  identity?: { id: string; token: string };
  serverTime?: number;
};
export function expectedPosition(
  room: Pick<Room, "playing" | "position" | "anchor" | "media">,
  now: number,
) {
  return Math.min(
    room.media.duration,
    Math.max(
      0,
      room.position +
        (room.playing ? Math.max(0, now - room.anchor) / 1000 : 0),
    ),
  );
}
export function correction(drift: number, playing: boolean) {
  if (!playing) return { seek: Math.abs(drift) > 0.15, rate: 1 };
  if (Math.abs(drift) > 0.5) return { seek: true, rate: 1 };
  return {
    seek: false,
    rate:
      Math.abs(drift) < 0.08
        ? 1
        : 1 + Math.max(-0.05, Math.min(0.05, drift * 0.15)),
  };
}
