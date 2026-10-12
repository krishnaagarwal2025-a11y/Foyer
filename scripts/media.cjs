const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
fs.mkdirSync("public/media", { recursive: true });
const ffmpeg = require("ffmpeg-static");
const result = spawnSync(
  ffmpeg,
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=15:duration=90",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=44100:duration=90",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "34",
    "-g",
    "15",
    "-keyint_min",
    "15",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    "-movflags",
    "+faststart",
    path.resolve("public/media/demo.mp4"),
  ],
  { stdio: "inherit" },
);
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
