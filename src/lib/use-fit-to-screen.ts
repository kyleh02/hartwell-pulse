"use client";

import { useEffect, type RefObject } from "react";

/**
 * On a phone, make an element end exactly at the bottom of the screen.
 *
 * The chat used a fixed 70% of the screen's height. With the header above it
 * and, for a client, the tab bar below, that left the message box below the
 * fold on a small iPhone and sent you scrolling the page to type. This sizes it
 * to the space actually left: from where it starts down to the bottom of the
 * screen, less the tab bar when there is one.
 *
 * The moving part is left to CSS. 100dvh follows Safari's toolbar as it shows
 * and hides, so the only thing measured here is where the element starts, and
 * that only changes when the layout above it does.
 *
 * Deliberately NOT tied to the keyboard. iOS does not resize the page when the
 * keyboard opens, it scrolls the focused field into view itself, and resizing
 * the chat while Safari is doing that is what makes a page lurch. A phone held
 * sideways, or the page above changing, re-measures; typing does not.
 *
 * Desktop keeps the class-based height untouched.
 *
 * `enabled` false leaves the element alone, for a chat that already sits in a
 * container sized to the screen: the panel the chat bubble opens.
 */
export function useFitToScreen(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const wide = window.matchMedia("(min-width: 1024px)");

    function fit() {
      if (!el) return;
      if (wide.matches) {
        el.style.height = "";
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      // The client tab bar is fixed to the bottom on phones. Fixed elements have
      // no offsetParent whether shown or not, so visibility is read from the
      // computed display instead.
      const bar = document.querySelector<HTMLElement>("[data-tabbar]");
      const barHeight =
        bar && getComputedStyle(bar).display !== "none"
          ? bar.getBoundingClientRect().height
          : 0;
      const gap = 12;
      el.style.height = `max(20rem, calc(100dvh - ${Math.round(top)}px - ${Math.round(barHeight + gap)}px))`;
    }

    fit();
    // Layout above can settle after mount (fonts, a wrapped row of tabs), and a
    // body resize is the signal. Re-fitting writes the same value when nothing
    // above moved, so this cannot feed itself.
    const ro = new ResizeObserver(() => fit());
    ro.observe(document.body);
    window.addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
      wide.removeEventListener("change", fit);
      el.style.height = "";
    };
  }, [ref, enabled]);
}
