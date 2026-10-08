// Load before first paint from a same-origin file permitted by the security policy.
(() => {
  let appearance = "system";
  try {
    const saved = localStorage.getItem("fahrtenbuch:appearance");
    if (saved === "light" || saved === "dark") appearance = saved;
  } catch {}
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.dataset.theme = appearance;
  document.documentElement.style.colorScheme = appearance === "system" ? "light dark" : appearance;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (appearance === "system") themeColor.removeAttribute("content");
  else themeColor.setAttribute("content", appearance === "dark" ? "#171719" : "#ffffff");
})();
