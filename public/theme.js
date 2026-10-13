// Set the saved/system theme before first paint; React keeps it in sync.
try {
  const stored = localStorage.getItem("foyer-theme");
  document.documentElement.dataset.theme =
    stored === "light" || stored === "dark"
      ? stored
      : matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
document
  .querySelector('meta[name="theme-color"]')
  ?.setAttribute(
    "content",
    document.documentElement.dataset.theme === "light" ? "#f4f4f2" : "#111214",
  );
