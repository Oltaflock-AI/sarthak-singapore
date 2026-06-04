"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const SunIcon = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="3.4" />
    <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M15.95 4.05l-1.4 1.4M5.45 14.55l-1.4 1.4M15.95 15.95l-1.4-1.4M5.45 5.45l-1.4-1.4" />
  </svg>
);

const MoonIcon = (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16.5 11.2A6.8 6.8 0 0 1 8.8 3.5a6.8 6.8 0 1 0 7.7 7.7z" />
  </svg>
);

// The current theme lives on <html data-theme>; the anti-FOUC script in the
// root layout sets it before paint. We read it as an external store so there
// is no setState-in-effect and no hydration mismatch.
function subscribe(cb: () => void) {
  window.addEventListener("themechange", cb);
  return () => window.removeEventListener("themechange", cb);
}
function getSnapshot(): Theme {
  return (document.documentElement.dataset.theme as Theme) || "dark";
}
function getServerSnapshot(): Theme {
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("theme", theme); } catch {}
  // Notify the store above + theme-aware canvases (charts) to re-render.
  window.dispatchEvent(new Event("themechange"));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => applyTheme(next)}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "dark" ? SunIcon : MoonIcon}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
