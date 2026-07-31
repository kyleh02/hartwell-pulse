/**
 * Celebrations, for the handful of moments that genuinely deserve one.
 *
 * The restraint is the design. A burst of confetti every time something is
 * logged trains you to ignore it, and worse, it would reward the wrong thing:
 * the outreach playbook is explicit that volume is the risk, so celebrating
 * every send would push exactly the behaviour that gets a campaign complained
 * about. These fire on outcomes, not activity.
 *
 * No dependency: a canvas, a few hundred particles, then it removes itself.
 * Anyone who has asked their system for less motion gets the toast alone.
 */

export type CelebrationTone = "gold" | "steel" | "success";

interface CelebrateOptions {
  title: string;
  message?: string;
  tone?: CelebrationTone;
  /** Bigger moments get more of everything. 1 is a nod, 3 is a win. */
  intensity?: 1 | 2 | 3;
}

const TONES: Record<CelebrationTone, string[]> = {
  gold: ["#b5a675", "#cbbe97", "#e0d6b4", "#f9f7f2"],
  steel: ["#7fa0c8", "#9db9d9", "#c3d4e8", "#f3f4f5"],
  success: ["#6ba368", "#8fc08c", "#b9d9b7", "#f9f7f2"],
};

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: string;
  spin: number;
  angle: number;
  life: number;
}

function burst(tone: CelebrationTone, intensity: number) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "80",
  } as CSSStyleDeclaration);
  document.body.appendChild(canvas);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const colours = TONES[tone];
  const count = 60 * intensity;
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Two side vents rather than one central fountain: it reads as celebration
  // rather than as something erupting out of the page.
  const origins = [
    { x: w * 0.15, y: h * 0.72, dir: 1 },
    { x: w * 0.85, y: h * 0.72, dir: -1 },
  ];

  const parts: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const o = origins[i % origins.length];
    const spread = (Math.random() - 0.5) * 0.9;
    const speed = 9 + Math.random() * 9 + intensity * 1.5;
    parts.push({
      x: o.x,
      y: o.y,
      vx: (Math.cos(-1.15 + spread) * speed) * o.dir,
      vy: Math.sin(-1.15 + spread) * speed,
      size: 4 + Math.random() * 5,
      colour: colours[(Math.random() * colours.length) | 0],
      spin: (Math.random() - 0.5) * 0.3,
      angle: Math.random() * Math.PI,
      life: 1,
    });
  }

  let frame = 0;
  const maxFrames = 150;
  function tick() {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    frame++;
    for (const p of parts) {
      p.vy += 0.32; // gravity
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.life = Math.max(0, 1 - frame / maxFrames);
      if (p.life <= 0) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.colour;
      // Rectangles read as paper; circles read as bubbles.
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (frame < maxFrames) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(tick);
}

function toast(title: string, message: string | undefined, tone: CelebrationTone) {
  const accent =
    tone === "steel"
      ? "var(--pulse-steel)"
      : tone === "success"
        ? "var(--pulse-success)"
        : "var(--pulse-gold)";

  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  Object.assign(el.style, {
    position: "fixed",
    left: "50%",
    bottom: "calc(1.5rem + env(safe-area-inset-bottom))",
    transform: "translateX(-50%) translateY(12px)",
    zIndex: "81",
    maxWidth: "min(26rem, calc(100vw - 2rem))",
    padding: "0.85rem 1.1rem",
    borderRadius: "var(--radius-card)",
    border: "1px solid var(--pulse-border-strong)",
    background: "var(--pulse-surface)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
    color: "var(--pulse-text)",
    fontFamily: "var(--font-sans)",
    opacity: "0",
    transition: "opacity .28s ease, transform .28s ease",
    borderLeft: `3px solid ${accent}`,
  } as CSSStyleDeclaration);

  const h = document.createElement("p");
  h.textContent = title;
  Object.assign(h.style, {
    margin: "0",
    fontSize: "0.9rem",
    fontWeight: "500",
  } as CSSStyleDeclaration);
  el.appendChild(h);

  if (message) {
    const p = document.createElement("p");
    p.textContent = message;
    Object.assign(p.style, {
      margin: "0.2rem 0 0",
      fontSize: "0.78rem",
      color: "var(--pulse-text-dim)",
    } as CSSStyleDeclaration);
    el.appendChild(p);
  }

  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
  });
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(12px)";
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

export function celebrate({
  title,
  message,
  tone = "gold",
  intensity = 2,
}: CelebrateOptions) {
  if (typeof window === "undefined") return;
  toast(title, message, tone);
  if (!reducedMotion()) burst(tone, intensity);
}

/** A quiet confirmation, for things worth acknowledging but not cheering. */
export function acknowledge(title: string, message?: string) {
  if (typeof window === "undefined") return;
  toast(title, message, "steel");
}
