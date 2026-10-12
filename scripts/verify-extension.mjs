import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = "public/extension";
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
assert.equal(manifest.manifest_version, 3, "extension must use Manifest V3");
assert.equal(manifest.background?.service_worker, "worker.js");
assert.equal(manifest.action?.default_popup, "popup.html");
assert.deepEqual(new Set(manifest.permissions), new Set(["storage", "activeTab"]));
assert.ok(!manifest.permissions.includes("cookies"));
assert.ok(!manifest.permissions.includes("webRequest"));
assert.ok(manifest.optional_host_permissions.includes("http://*/*"));
assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
for (const host of [
  "www.netflix.com",
  "www.primevideo.com",
  "www.hotstar.com",
  "www.jiohotstar.com",
])
  assert.ok(matches.some((pattern) => pattern.includes(host)), `${host} is supported`);
for (const name of ["worker.js", "content.js", "popup.js", "popup.html"]) {
  assert.ok((await stat(path.join(root, name))).size > 100, `${name} is bundled`);
}
const source = await Promise.all(
  ["worker.js", "content.js", "popup.js"].map((name) =>
    readFile(path.join(root, name), "utf8"),
  ),
);
assert.ok(!source.some((file) => /document\.cookie|chrome\.cookies/.test(file)));
const archive = await readFile(path.join(root, "foyer-extension.zip"));
assert.equal(archive.readUInt32LE(0), 0x04034b50, "ZIP local header exists");
assert.equal(
  archive.readUInt32LE(archive.length - 22),
  0x06054b50,
  "ZIP end directory exists",
);
for (const name of [
  "manifest.json",
  "popup.html",
  "worker.js",
  "content.js",
  "popup.js",
])
  assert.ok(archive.includes(Buffer.from(name)), `${name} is in the ZIP`);
console.log(
  `Foyer Companion package verified: Manifest V${manifest.manifest_version}, ${matches.length} page patterns, scoped server access, five ZIP files.`,
);
