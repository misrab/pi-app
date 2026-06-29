import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

function readTheme(): AppTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Tracks `data-theme` on `<html>` (set in main.tsx / Header toggle). */
export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(readTheme);

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return theme;
}

export function accentColorFromTheme(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2dd4bf";
}
