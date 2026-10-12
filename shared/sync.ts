import type { Room, SyncClockPacket, SyncMeasurement } from "./types.js";
export const acceptSnapshot = (previous: Room | null, next: Room) =>
  !previous || previous.code !== next.code || next.version > previous.version
    ? next
    : previous;

/** Four timestamps (server send, client receive/send, server receive).
 * RTT is measured with elapsed clocks; half-RTT offset assumes symmetric paths. */
export function probeClockOffset(packet: SyncClockPacket) {
  return (
    (packet.serverSentAt -
      packet.clientReceivedAt +
      (packet.serverReceivedAt - packet.clientSentAt)) /
    2
  );
}
export function startLeadMs(participants: SyncMeasurement[]) {
  const rtts = participants.flatMap((p) => (p.rttMs === null ? [] : [p.rttMs]));
  return Math.max(
    120,
    Math.min(1500, Math.ceil(Math.max(0, ...rtts) * 1.5 + 80)),
  );
}
