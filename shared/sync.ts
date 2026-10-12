import type { Room } from "./types";
export const acceptSnapshot = (previous: Room | null, next: Room) =>
  !previous || previous.code !== next.code || next.version > previous.version
    ? next
    : previous;
