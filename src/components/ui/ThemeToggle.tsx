"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const THEME_KEY = "pulse-theme";

/**
 * The script that runs before first paint.
 *
 * Inlined into <head> so the theme is on the element before the browser draws
 * anything. Without it the page renders dark, then flips to light a beat
 * later, which looks broken every single load.
 *
 * Dark is the default and an OS preference is deliberately NOT consulted. Dark
 * is the brand, and a portal that looks different to a client than it does to
 * Kyle, because of a setting neither of them thought about, is a support
 * question waiting to happen. Light is a choice someone makes here.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){}})()`;

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Read what the head script already decided, rather than deciding again.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private browsing with storage blocked. The theme still applies for
      // this page, it just will not be remembered, which is a fine outcome.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-input)] text-pulse-text-mute transition-colors hover:bg-pulse-surface-2 hover:text-pulse-text"
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
