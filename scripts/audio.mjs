import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
mkdirSync("public/media", { recursive: true });
const rate = 22050,
  seconds = 60,
  count = rate * seconds,
  buffer = Buffer.alloc(44 + count * 2);
buffer.write("RIFF");
buffer.writeUInt32LE(36 + count * 2, 4);
buffer.write("WAVEfmt ", 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(rate, 24);
buffer.writeUInt32LE(rate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(count * 2, 40);
const notes = [261.63, 329.63, 392, 523.25, 440, 392, 329.63, 293.66];
for (let i = 0; i < count; i++) {
  const t = i / rate,
    beat = t % 1.5,
    f = notes[Math.floor(t / 1.5) % notes.length],
    envelope = Math.min(1, beat / 0.035) * Math.exp(-beat * 2.7);
  const sample =
    (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) *
      envelope *
      0.18 +
    0.04 *
      Math.sin(2 * Math.PI * 130.81 * t) *
      Math.min(1, t / 2) *
      Math.min(1, (seconds - t) / 2);
  buffer.writeInt16LE(
    Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
    44 + i * 2,
  );
}
writeFileSync("public/media/evening-keys.wav", buffer);
const compressed = spawnSync(
  ffmpeg,
  [
    "-y",
    "-i",
    "public/media/evening-keys.wav",
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    "-movflags",
    "+faststart",
    "public/media/evening-keys.m4a",
  ],
  { stdio: "pipe" },
);
if (compressed.status !== 0)
  throw Error("Could not generate compressed demo audio: " + compressed.stderr);
console.log(
  "Generated original 60-second audio with a compact fast-start AAC version; WAV retained for compatibility.",
);
