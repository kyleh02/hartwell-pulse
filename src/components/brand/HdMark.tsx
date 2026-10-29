"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { HD_HEIGHT, HD_PATH, HD_WIDTH } from "@/lib/brand/hd-path";
import { cn } from "@/lib/utils/cn";

/**
 * The Hartwell Digital monogram, turning in 3D: polished gold, a soft glow and
 * a glint of light as it comes round. Kyle asked for it on 29 October 2026, on
 * the sign-in page and at the top left of every portal page.
 *
 * What paints first is the flat vector mark below, server rendered, so the
 * logo is there at first paint and the page never waits on WebGL. The 3D scene
 * (three.js, its own chunk, src/lib/brand/hd-mark-scene.ts) is fetched only
 * once the mark is actually on screen and the browser is idle, builds itself
 * in short slices, and fades in over the flat mark once it has drawn a frame.
 * The flat mark stays fully opaque underneath while the canvas fades in (a
 * two-way cross-fade lets the page show through at the midpoint, so the logo
 * would dip), and steps aside only once the canvas covers it. The fade only
 * starts when all of it fits in the rest between turns, where the mark faces
 * the front and the two match. The flat mark is also what stays when the scene
 * cannot run: reduced motion or no WebGL2. If the GPU drops the context (a
 * phone sending the browser to the background, a driver reset) the flat mark
 * comes straight back and the scene is built again on a fresh canvas the next
 * time the mark can be seen, up to twice per mount.
 *
 * It turns, then rests. After mounting it plays a set number of turns (one for
 * the sidebar and phone header, five, about half a minute, for the sign-in
 * hero) and comes to rest facing the front, the same frame as the flat mark.
 * It plays one more turn on each client navigation and when the pointer comes
 * onto it (onto the whole lockup when text beside it names the business). A
 * client who works in the portal all day is not left with a logo turning at
 * the edge of their eye every ten seconds, and the motion always stops by
 * itself (WCAG 2.2.2).
 *
 * It draws only while it can be seen. Off screen, in a background tab or in a
 * hidden layout (the mobile header on a desktop) it stops, and a copy that has
 * never been seen never creates a WebGL context at all. Resting, it draws
 * nothing. Small marks drop to 30 fps while they drift facing the front and
 * only run every frame during the turn itself.
 */

/** Room on every side of the letters for the glow, the sparkles and the turn,
 *  as a share of the letters' height. The scene is designed to this. */
const PAD = 0.42;

/** Below this letter height the scene runs its calmer sidebar settings. */
const SMALL = 64;

/** The canvas's fade-in, matching its duration-700 class. */
const FADE_MS = 700;

/** The flat mark's gradient: CSS variables per theme (globals.css), with the
 *  dark theme's values as fallbacks. The small marks' 3D reads lighter and
 *  more even top to bottom (each stroke one polished bar), so they get their own. */
const HERO_STOPS = [
  [0, "var(--hd-stop-1, #e3d3a0)"],
  [0.3, "var(--hd-stop-2, #d5c492)"],
  [0.7, "var(--hd-stop-3, #a79769)"],
  [1, "var(--hd-stop-4, #a68f59)"],
] as const;
const SMALL_STOPS = [
  [0, "var(--hd-sm-stop-1, #d3c08a)"],
  [0.3, "var(--hd-sm-stop-2, #d2bf89)"],
  [0.7, "var(--hd-sm-stop-3, #c3b07b)"],
  [1, "var(--hd-sm-stop-4, #c2ad76)"],
] as const;

/** Turns played after mounting before the mark rests (see above). */
const TURNS_SMALL = 1;
const TURNS_HERO = 5;

/** Lost GPU contexts rebuilt per mount; past that the flat mark stays. */
const MAX_REBUILDS = 2;

// lib.dom declares requestIdleCallback on every window, so an `in` check
// narrows the fallback branch to `never` and fails the type check; Safari
// still lacks it, hence the typeof test.
const idle = (fn: () => void): void => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(fn, { timeout: 1200 });
  else setTimeout(fn, 200);
};

export function HdMark({
  size,
  spin = true,
  label = "Hartwell Digital",
  turns,
  className,
}: {
  /** Height of the letters in CSS pixels. The mark is 1.36 times as wide. */
  size: number;
  /** False keeps the flat mark only, with no 3D chunk fetched. */
  spin?: boolean;
  /** Null when text beside it already names the business. */
  label?: string | null;
  /** Turns after mounting before it rests. Default 1 below 64 px letters, 5
   *  above; Infinity never rests. */
  turns?: number;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `hd-gold-${uid}`;
  const clipId = `hd-clip-${uid}`;
  const wrap = useRef<HTMLSpanElement>(null);
  // true once the canvas has fully faded in over the flat mark
  const [covered, setCovered] = useState(false);
  // the running scene's "one more turn", for a navigation
  const replay = useRef<(() => void) | null>(null);
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  const width = (size * HD_WIDTH) / HD_HEIGHT;
  const lockup = label === null;
  // the flat mark's colours, fitted to the 3D's t = 0 frame at each scale
  const stops = size < SMALL ? SMALL_STOPS : HERO_STOPS;

  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    replay.current?.();
  }, [pathname]);

  useEffect(() => {
    const el = wrap.current;
    if (!spin || !el) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const small = size < SMALL;
    const pad = Math.round(size * PAD);
    const cssW = width + pad * 2;
    const cssH = size + pad * 2;

    type Scene = import("@/lib/brand/hd-mark-scene").HdMarkScene;
    let mark: Scene | null = null;
    let cv: HTMLCanvasElement; // assigned below, once its handlers exist
    let gen = 0; // bumped at every teardown, so a build still running for an older canvas throws itself away
    let loading = false;
    let failed = false; // no WebGL2, a shader that will not link, the chunk did not load: the flat mark stays
    let rebuilds = 0;
    let retryTimer = 0;
    let shown = false;
    let onScreen = false;
    let raf = 0;
    let dpr = 0;
    let last = 0;
    let coverTimer = 0;

    // The mark's own clock, in seconds of animation. It runs only while frames
    // are drawn, so a mark that was off screen, in a background tab, resting or
    // rebuilt carries on from where it was instead of jumping, and every mark
    // starts at t = 0: facing the front, mid-rest, the frame the flat mark matches.
    let t = 0;
    let prevT = 0;
    let prevNow = -1;
    let wasTurning = false;
    let turnsLeft = Math.max(0, turns ?? (small ? TURNS_SMALL : TURNS_HERO));
    let restAt = turnsLeft > 0 ? Infinity : 0; // clock time at which it next comes to rest
    let resting = false;

    const theme = () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    const wanted = () => onScreen && !document.hidden && !motion.matches && !failed;
    const show = (on: boolean) => {
      shown = on;
      cv.style.opacity = on ? "1" : "0";
      window.clearTimeout(coverTimer);
      // The flat mark steps aside once the canvas is opaque over it, and comes
      // straight back (under the fading canvas) when the scene goes away.
      if (on) coverTimer = window.setTimeout(() => setCovered(true), FADE_MS);
      else setCovered(false);
    };

    /** The middle of the rest that began between prevT and t: the next time
     *  the mark faces the front square-on. Found from isTurning alone. */
    const restPoint = (m: Scene): number => {
      const edge = (a: number, b: number): number => {
        const at = m.isTurning(a);
        for (let i = 0; i < 40; i++) {
          const mid = (a + b) / 2;
          if (m.isTurning(mid) === at) a = mid;
          else b = mid;
        }
        return (a + b) / 2;
      };
      let next = t;
      while (!m.isTurning(next) && next - t < 60) next += 0.25;
      return (edge(prevT, t) + edge(next - 0.25, next)) / 2;
    };

    const frame = (now: number) => {
      raf = 0;
      if (!mark || !wanted()) {
        prevNow = -1;
        return;
      }
      if (!resting) {
        // a hitch, or a tab coming back, never jumps the mark ahead
        if (prevNow >= 0) {
          prevT = t;
          t += Math.min(now - prevNow, 100) / 1000;
        }
        prevNow = now;
        if (t >= restAt) {
          t = restAt;
          resting = true;
        }
      }
      const turning = mark.isTurning(t);
      if (wasTurning && !turning && --turnsLeft <= 0) {
        turnsLeft = 0;
        restAt = restPoint(mark);
      }
      wasTurning = turning;
      // A drifting small mark moves a degree or two a second, which 30 fps
      // carries without a visible difference at 30 pixels; the turn itself
      // gets every frame.
      if (resting || !small || turning || now - last >= 32) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (ratio !== dpr) {
          dpr = ratio;
          mark.resize(cssW, cssH, dpr);
        }
        mark.render(t);
        last = now;
        // Fade in only if the whole fade fits before the next turn: a fade
        // still running as the mark turns would show the flat logo through it.
        // (Every turn lasts longer than the fade, so checking both ends is enough.)
        if (!shown && !turning && !mark.isTurning(t + FADE_MS / 1000)) show(true);
      }
      if (resting) {
        // the canvas keeps this frame until something asks for another
        prevNow = -1;
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    /** Disposes the scene and its canvas; the flat mark comes straight back. */
    const teardown = () => {
      gen++;
      loading = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      prevNow = -1;
      window.clearTimeout(retryTimer);
      // before dispose, whose forced context loss would otherwise land here
      cv.removeEventListener("webglcontextlost", onLost);
      mark?.dispose();
      mark = null;
      cv.remove();
      shown = false;
      window.clearTimeout(coverTimer);
      setCovered(false);
    };

    // A disposed scene forces its context lost, and a canvas whose context was
    // lost never gives a working one again, so every build (a re-run of this
    // effect, a rebuild after a lost context) starts on a fresh canvas.
    const newCanvas = (): HTMLCanvasElement => {
      const c = document.createElement("canvas");
      c.setAttribute("aria-hidden", "true");
      c.className = "pointer-events-none absolute max-w-none opacity-0 transition-opacity duration-700 ease-out";
      Object.assign(c.style, { left: `${-pad}px`, top: `${-pad}px`, width: `${cssW}px`, height: `${cssH}px` });
      c.addEventListener("webglcontextlost", onLost);
      el.appendChild(c);
      return c;
    };

    /** After a lost context: a fresh canvas, built once the mark can be seen. */
    const rebuild = (delay: number) => {
      teardown();
      if (++rebuilds > MAX_REBUILDS) {
        failed = true; // a GPU that keeps dropping it gets the flat mark
        return;
      }
      cv = newCanvas();
      retryTimer = window.setTimeout(update, delay);
    };
    // The GPU took the context (the browser sent to the background on a phone,
    // a driver reset, too many contexts on the page).
    const onLost = () => rebuild(0);

    const update = () => {
      if (!wanted()) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        prevNow = -1;
        if (motion.matches && shown) show(false);
        return;
      }
      if (mark) {
        // also draws one frame of a resting mark, after a theme or size change
        if (!raf) raf = requestAnimationFrame(frame);
        return;
      }
      if (loading) return;
      loading = true;
      const g = gen;
      const canvas = cv;
      idle(() => {
        if (g !== gen) return;
        import("@/lib/brand/hd-mark-scene")
          .then(async ({ createHdMarkScene }) => {
            if (g !== gen) return;
            const scene = createHdMarkScene(canvas, { theme: theme(), markFill: size / cssH, small });
            // size it before ready, so ready's warm-up frame is the real one
            // and the first visible frame pays for nothing
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            scene.resize(cssW, cssH, dpr);
            await scene.ready;
            // torn down meanwhile, or its context lost (whose event rebuilds)
            if (g !== gen || canvas.getContext("webgl2")?.isContextLost()) return scene.dispose();
            mark = scene;
            loading = false;
            update();
          })
          .catch(() => {
            if (g !== gen) return;
            loading = false;
            // Rebuilding after a lost context, the GPU may still be coming
            // back: try again shortly. Otherwise (no WebGL2, a shader that will
            // not link, the chunk did not load; the scene has freed itself) the
            // flat mark stays, which is a complete logo in its own right.
            if (rebuilds > 0) rebuild(2000);
            else failed = true;
          });
      });
    };

    /** One more turn, then rest again: a navigation, or the pointer arriving. */
    const again = () => {
      if (turnsLeft > 0) return; // a turn is under way or still to come
      turnsLeft = 1;
      restAt = Infinity;
      resting = false;
      update();
    };

    cv = newCanvas();
    replay.current = again;
    const hover = lockup && el.parentElement ? el.parentElement : el;
    hover.addEventListener("pointerenter", again);

    const seen = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      update();
    });
    seen.observe(el);

    const themed = new MutationObserver(() => {
      mark?.setTheme(theme());
      update();
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", update);
    // a resting mark redraws for a new pixel ratio (the window moved to another screen)
    window.addEventListener("resize", update);

    return () => {
      teardown();
      seen.disconnect();
      themed.disconnect();
      hover.removeEventListener("pointerenter", again);
      if (replay.current === again) replay.current = null;
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, [spin, size, width, turns, lockup]);

  return (
    <span
      ref={wrap}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      className={cn("relative inline-block shrink-0 align-middle", className)}
      style={{ width, height: size }}
    >
      <svg
        viewBox={`0 0 ${HD_WIDTH} ${HD_HEIGHT}`}
        width={width}
        height={size}
        aria-hidden="true"
        className={cn("absolute inset-0", covered && "opacity-0")}
      >
        <defs>
          {/* The front face as the 3D mark shows it at rest, fitted to its
              t = 0 frame: a vertical gradient of its polished crowns, and a
              soft darker inner edge where its round-over turns away. Colours
              per theme in globals.css (--hd-stop-*, --hd-sm-stop-* below 64 px
              letters, --hd-edge), so the flat mark follows the same
              data-theme the scene does. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {stops.map(([offset, color]) => (
              <stop key={offset} offset={offset} style={{ stopColor: color }} />
            ))}
          </linearGradient>
          <clipPath id={clipId}>
            <path d={HD_PATH} />
          </clipPath>
        </defs>
        <path d={HD_PATH} fill={`url(#${gradientId})`} />
        {/* the stroke is centred on the outline and clipped to it, so 44 units
            of stroke give a 22-unit edge inside the letters only */}
        <path
          d={HD_PATH}
          fill="none"
          strokeWidth={44}
          strokeLinejoin="round"
          clipPath={`url(#${clipId})`}
          style={{ stroke: "var(--hd-edge, #5a4a2a)", strokeOpacity: 0.55 }}
        />
      </svg>
    </span>
  );
}
