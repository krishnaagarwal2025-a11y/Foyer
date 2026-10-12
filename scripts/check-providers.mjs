import { mkdir, writeFile } from "node:fs/promises";

const base = "https://api.audius.co/v1";
const startedAt = new Date().toISOString();
const report = {
  startedAt,
  provider: "Audius",
  endpoint: base,
  keyRequired: false,
  search: { status: "not-run", playableMatches: 0 },
  stream: { status: "not-run", contentType: null },
  limitations:
    "Network smoke test only. API availability varies. This catalog contains artist-published tracks, not every commercial recording.",
};

try {
  const response = await fetch(
    `${base}/tracks/search?query=ambient&limit=12&app_name=Foyer`,
    { signal: AbortSignal.timeout(12000) },
  );
  report.search.status = response.status;
  if (!response.ok) throw Error(`Search endpoint returned ${response.status}.`);
  const body = await response.json();
  const track = Array.isArray(body.data)
    ? body.data.find(
        (entry) =>
          typeof entry.id === "string" &&
          /^[A-Za-z0-9_-]{1,80}$/.test(entry.id) &&
          entry.is_streamable === true &&
          entry.is_stream_gated !== true &&
          Number(entry.duration) > 0,
      )
    : undefined;
  report.search.playableMatches = Array.isArray(body.data)
    ? body.data.filter(
        (entry) =>
          entry.is_streamable === true && entry.is_stream_gated !== true,
      ).length
    : 0;
  if (!track) throw Error("No public playable sample was returned.");
  const stream = await fetch(
    `${base}/tracks/${encodeURIComponent(track.id)}/stream?app_name=Foyer`,
    { method: "HEAD", signal: AbortSignal.timeout(12000) },
  );
  report.stream.status = stream.status;
  report.stream.contentType = stream.headers.get("content-type");
  if (!stream.ok || !report.stream.contentType?.startsWith("audio/"))
    throw Error("Playable sample did not return an audio stream.");
  report.passed = true;
  console.log("Audius search and public audio stream are reachable.");
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  console.error(`Audius smoke test failed: ${report.error}`);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/providers-live.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
