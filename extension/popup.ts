export {};
const server = document.getElementById("server") as HTMLInputElement,
  status = document.getElementById("status")!;
void chrome.storage.local.get("server").then((v: { server?: unknown }) => {
  if (typeof v.server === "string") server.value = v.server;
});
document.getElementById("save")!.onclick = async () => {
  try {
    const url = new URL(server.value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw Error("Use an HTTP(S) origin without credentials.");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) throw Error("Open a supported streaming title first.");
    const page = new URL(tab.url),
      amazon = /^www\.amazon\.(com|in|co\.uk|de|co\.jp)$/.test(page.hostname),
      provider =
        [
          "www.netflix.com",
          "www.primevideo.com",
          "www.hotstar.com",
          "www.jiohotstar.com",
        ].includes(page.hostname) ||
        (amazon && page.pathname.startsWith("/gp/video/"));
    if (!provider)
      throw Error("Open a supported Netflix, Prime Video or Hotstar title page.");
    const granted = await chrome.permissions.request({
      origins: [`${url.origin}/*`, `${page.origin}/*`],
    });
    if (!granted)
      throw Error("Access to the Foyer server and current site was not granted.");
    await chrome.storage.local.set({ server: url.origin });
    status.textContent = `Allowed ${url.origin} and ${page.origin}. Reload this title page.`;
  } catch (e) {
    status.textContent =
      e instanceof Error ? e.message : "Could not save server.";
  }
};
document.getElementById("toggle")!.onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw Error("Open a streaming title first.");
    await chrome.tabs.sendMessage(tab.id, { type: "foyer:toggle" });
  } catch {
    status.textContent =
      "Open Netflix, Prime Video or Hotstar/JioHotstar and reload the page.";
  }
};
