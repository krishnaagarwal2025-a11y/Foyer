const button = document.getElementById("theme");
function label() {
  button.textContent = `Switch to ${document.documentElement.dataset.theme === "light" ? "dark" : "light"} theme`;
  button.setAttribute("aria-label", button.textContent);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      document.documentElement.dataset.theme === "light"
        ? "#f4f4f2"
        : "#111214",
    );
}
button.addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("foyer-theme", theme);
  } catch {}
  label();
});
label();
