import { useEffect, useState } from "react";

const labels = { system: "System", light: "Hell", dark: "Dunkel" };
type Appearance = keyof typeof labels;

/** Native CSS follows live system changes; users can save an explicit preference. */
export function ThemeControl() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const saved = document.documentElement.dataset.appearance;
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.appearance = appearance;
    root.dataset.theme = appearance;
    root.style.colorScheme = appearance === "system" ? "light dark" : appearance;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (appearance === "system") meta?.removeAttribute("content");
    else meta?.setAttribute("content", appearance === "dark" ? "#171719" : "#ffffff");
  }, [appearance]);

  const next = appearance === "system" ? "light" : appearance === "light" ? "dark" : "system";
  const description = `Darstellung: ${labels[appearance]}. Zu ${labels[next]} wechseln.`;

  return (
    <button
      type="button"
      className="theme-control"
      aria-label={description}
      title={description}
      onClick={() => {
        setAppearance(next);
        try {
          localStorage.setItem("fahrtenbuch:appearance", next);
        } catch {
          /* The current choice still works when browser storage is unavailable. */
        }
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {appearance === "system" ? (
          <>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M8 20h8m-4-4v4" />
          </>
        ) : appearance === "light" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        ) : (
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        )}
      </svg>
    </button>
  );
}
