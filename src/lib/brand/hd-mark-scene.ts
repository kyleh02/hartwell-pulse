/**
 * The Hartwell Digital "HD" monogram as a slab of polished champagne gold,
 * turning in 3D: large at the top of the sign-in page, small beside
 * "HARTWELL PULSE" in the portal header.
 *
 *   const mark = createHdMarkScene(canvas, { theme: "dark", markFill, small });
 *   mark.resize(cssW, cssH, dpr);   // best before ready, and on every size change
 *   await mark.ready;               // built, linked and drawn once: fade the canvas in now
 *   mark.render(tSeconds);          // one frame; a pure, periodic function of t
 *   mark.isTurning(t);              // false in the drifting dwell (30 fps is plenty there)
 *   mark.setTheme("light");
 *   mark.dispose();
 *
 * createHdMarkScene throws synchronously when the device cannot run it (no
 * WebGL2, or half-float render targets unsupported); the caller then keeps
 * the flat SVG of the logo. Only the context and those capability checks run
 * synchronously. The heavy work (the distance field, the extrusion, the
 * studio and its PMREM, shader linking) runs in `ready` in short slices that
 * yield to the page between them, so a sign-in form stays responsive while
 * the mark builds. `ready` then sizes itself if the caller has not (from the
 * canvas's layout box) and draws one frame, so the first visible frame pays
 * for nothing. If the GPU context is lost, `ready` resolves early and
 * render/resize do nothing; if a shader fails to link, the scene frees
 * itself and `ready` rejects.
 *
 * How it is built
 * - Geometry: the traced outline extruded as a straight slab, so the
 *   silhouette sits exactly on the traced outline and nothing can fold over.
 *   Every face normal is then replaced in the shader.
 * - Shading normals: an exact signed distance field of the outline (built once
 *   per page on the CPU and shared by every mark) drives a "pillow"
 *   round-over on the faces: the hero keeps a fixed 58-unit round-over, so
 *   stems carry the ring light as fine rim lines; the small marks use a
 *   cylinder profile scaled to each stroke's own half-width that turns only
 *   28 degrees by the outline, so in the dwell a stroke mirrors the key and
 *   nothing else and reads as one clean polished bar. The walls take the field's gradient, so
 *   curved walls are smooth instead of faceted. Where the round-over is seen
 *   at a grazing angle it can fall inside a pixel; there the shading widens
 *   the reflection lobe by how far the normal turns across that pixel
 *   (specular anti-aliasing), so the rim stays a clean gold edge in motion.
 * - Environment: a dark studio painted by a shader into an equirect target
 *   (key, overhead, ring light, a big softbox camera left for the mid-turn
 *   flash, strips and rims), then PMREM. The small marks get a simpler studio.
 * - Post: the scene renders to an MSAA half-float target (2x supersampled for
 *   the small marks and on 1x screens); a bright pass and a small down/up
 *   chain make the glow; the composite tone maps, grades the gold toward the
 *   brand champagne, and writes premultiplied alpha, so the glow is gold light
 *   on dark and only a faint warm tint on light, faded before the canvas edge.
 *   The chain is sized in CSS pixels (its levels are 1, 2 and 4 CSS px at any
 *   pixel ratio), so the halo looks the same on 1x and 2x screens. On light
 *   the glow's source is capped, so a hot wall never spreads a haze on paper.
 * - Light band, flash and stars: during the dwell a soft diagonal band of
 *   light slides along the polished crowns; mid-turn (dark only) a broad sheen
 *   sweeps the crowns as the face, and later the back, passes the big
 *   softbox, and the halo swells; four-point stars fire on real highlights at
 *   scheduled moments (on the hero: the band crossing a serif tip, the band
 *   leaving the D's shoulder, the mirrored back passing the softbox; on the
 *   small marks only the shoulder), hidden by the scene depth where metal is
 *   in front of them, and kept inside the canvas.
 */
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { HD_PATH, HD_WIDTH, HD_HEIGHT } from "@/lib/brand/hd-path";

export type HdTheme = "dark" | "light";

export interface HdMarkScene {
  resize(cssW: number, cssH: number, dpr: number): void;
  render(t: number): void;
  setTheme(theme: HdTheme): void;
  isTurning(t: number): boolean;
  ready: Promise<void>;
  dispose(): void;
}

type Vec3 = readonly [number, number, number];

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* ------------------------------------------------------------------ timing */
// One turn per cycle. The dwell is never frozen: the mark drifts linearly from
// +drift to -drift, so the studio's reflections slide along the polished
// strokes. The turn then carries on in the same direction with the same speed
// at the join (no jolt), shaped by v(x) ~ 1 - a cos 2pi x - b cos 4pi x - c cos 6pi x:
// fastest through the two side views, easing through the mirrored back so it
// can be read, and slowing back into the drift. t = 0 is the middle of the
// dwell, square to the viewer, so the first frame matches the flat SVG.

interface Timetable {
  readonly cycle: number;
  readonly dwell: number;
  readonly drift: number; // radians either side of square-on
  readonly turn: number;
  readonly span: number;
  readonly driftSpeed: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly offset: number; // cycle phase at t = 0
}

function makeTimetable(cycle: number, dwell: number, driftDeg: number, b: number, c: number): Timetable {
  const drift = driftDeg * D2R;
  const turn = cycle - dwell;
  const span = TAU - 2 * drift;
  const driftSpeed = (2 * drift) / dwell;
  const a = 1 - driftSpeed / (span / turn) - b - c; // the turn starts and ends at the drift speed
  return { cycle, dwell, drift, turn, span, driftSpeed, a, b, c, offset: dwell / 2 };
}

// hero: 6 s, 2.8 s dwell; peak about 206 deg/s; the back within 60 degrees of square for about 1.4 s
const HERO_TIME = makeTimetable(6.0, 2.8, 6, 0.85, 0.175);
// small marks, seen all day: 10 s, 7 s of drifting dwell, a 3 s turn. The
// light band and the stars are timed in seconds back from the turn (Look.band),
// not as shares of the dwell, so a longer dwell (a rarer turn) is this one line.
const SMALL_TIME = makeTimetable(10.0, 7.0, 6, 0.8, 0.15);

function phaseOf(tt: Timetable, t: number): number {
  const x = t + tt.offset;
  const u = x - Math.floor(x / tt.cycle) * tt.cycle;
  return u < tt.cycle ? u : 0;
}

/** Yaw in radians: +drift at the start of the dwell, falling through the turn to drift - 2pi. */
function yawOf(tt: Timetable, u: number): number {
  if (u < tt.dwell) return tt.drift - tt.driftSpeed * u;
  const x = (u - tt.dwell) / tt.turn;
  const p = x - (tt.a * Math.sin(TAU * x)) / TAU - (tt.b * Math.sin(2 * TAU * x)) / (2 * TAU) - (tt.c * Math.sin(3 * TAU * x)) / (3 * TAU);
  return -tt.drift - tt.span * p;
}

/** Cycle phase at which the turn reaches a given yaw (radians, between -drift and drift - 2pi). */
function phaseOfYaw(tt: Timetable, yaw: number): number {
  let lo = tt.dwell, hi = tt.cycle;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) / 2;
    if (yawOf(tt, m) > yaw) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

const TILT = -0.07; // the top leans away a touch: the camera sits a little above the spin axis

/* ------------------------------------------------------------------ looks */

interface Box {
  az: number; // degrees from +z (towards the camera) towards +x
  el: number;
  w: number;
  h: number;
  roll: number;
  I: number;
  soft: number;
  grad: number;
  col: Vec3;
}
interface Studio {
  key: string;
  base: Vec3;
  floor: Vec3;
  boxes: readonly Box[];
  ring: { az: number; el: number; radius: number; width: number; I: number } | null;
  width: number; // equirect width; PMREM cube size is width / 4
}

const WHITE: Vec3 = [1.0, 0.985, 0.96];
const WARM: Vec3 = [1.0, 0.9, 0.74];

// The faces mirror the region behind the camera during the dwell (key, ring);
// the turn sweeps them across the rest of the room. The mark turns towards
// negative yaw, so the front face mirrors azimuth 2 * yaw: the big softbox at
// -100 makes the face flash at yaw -50 and the mirrored back at yaw -230.
const HERO_STUDIO: Studio = {
  key: "hero",
  base: [0.011, 0.0085, 0.006],
  floor: [0.034, 0.026, 0.018],
  boxes: [
    // front key behind the camera, tilted so faces carry a diagonal light/dark split
    { az: 4, el: 19.5, w: 64, h: 22, roll: -16, I: 1.8, soft: 0.06, grad: 0.5, col: WHITE },
    // big overhead box: top round-overs and the tops of serifs
    { az: 0, el: 70, w: 120, h: 24, roll: 0, I: 1.7, soft: 0.06, grad: 0.0, col: WHITE },
    // the big softbox, camera left: the mid-turn flash
    { az: -100, el: 8, w: 30, h: 58, roll: 0, I: 1.5, soft: 0.05, grad: 0.25, col: WHITE },
    // a tall strip camera right: a line of light sweeps the face as it lands
    { az: 80, el: 6, w: 10, h: 84, roll: 0, I: 1.4, soft: 0.02, grad: 0.3, col: WHITE },
    // rear rims, seen in the turn
    { az: -152, el: 18, w: 14, h: 64, roll: 8, I: 1.4, soft: 0.03, grad: 0.2, col: WHITE },
    { az: 132, el: 12, w: 9, h: 70, roll: -6, I: 1.5, soft: 0.02, grad: 0.2, col: WHITE },
    // a low warm bounce card so the undersides are never dead black
    { az: 0, el: -32, w: 90, h: 16, roll: 0, I: 0.34, soft: 0.12, grad: -0.3, col: WARM },
  ],
  ring: { az: 0, el: 6, radius: 46, width: 1.6, I: 2.4 },
  width: 1024,
};

// Small marks: no ring, no thin features. In the dwell the faces (their
// round-over held to SMALL_LOOK.tiltMax) mirror only the 75 degrees or so
// around the camera's back: there a compact key lights each stroke's crown and
// a dim warm fill falls away smoothly to its sides, so a stroke reads as one
// polished bar at 22 to 30 px. Everything else sits beyond that, for the turn:
// the softbox, a side strip and the rear rims. No overhead box, whose top-edge
// line read as a second stroke along the horizontals.
const SMALL_STUDIO: Studio = {
  key: "small",
  base: [0.012, 0.009, 0.0065],
  floor: [0.034, 0.026, 0.018],
  boxes: [
    { az: 0, el: 12, w: 36, h: 54, roll: -10, I: 1.1, soft: 0.14, grad: 0.4, col: WHITE },
    { az: 0, el: 0, w: 96, h: 70, roll: 0, I: 0.22, soft: 0.3, grad: 0.3, col: WARM },
    { az: -100, el: 8, w: 34, h: 60, roll: 0, I: 1.6, soft: 0.1, grad: 0.25, col: WHITE },
    { az: 96, el: 6, w: 16, h: 84, roll: 0, I: 1.2, soft: 0.06, grad: 0.3, col: WHITE },
    { az: -138, el: 18, w: 18, h: 64, roll: 8, I: 1.2, soft: 0.06, grad: 0.2, col: WHITE },
    { az: 132, el: 12, w: 14, h: 70, roll: -6, I: 1.2, soft: 0.06, grad: 0.2, col: WHITE },
    { az: 0, el: -32, w: 90, h: 16, roll: 0, I: 0.22, soft: 0.12, grad: -0.3, col: WARM },
  ],
  ring: null,
  width: 512,
};

interface Look {
  studio: Studio;
  field: FieldSpec;
  round: number; // round-over width, path units
  cylinder: number; // 1: round-over scaled to each stroke's half-width (small marks)
  tiltMax: number; // degrees the round-over has turned by the outline
  roughness: number;
  aa: number; // specular anti-aliasing: lobe widening per radian the normal turns across a pixel
  saturation: number; // the grade: below 1 pulls the gold toward champagne
  bloomLevels: number; // glow levels of 1, 2, 4 ... CSS px
  star: { len: number; w: number; core: number; glow: number; ref: number }; // CSS px for a mark `ref` px tall
  // the dwell's light band: it crosses the face over `dur` seconds and has
  // left the mark `lead` seconds before the turn begins
  band: { width: number; I: number; crown0: number; crown1: number; dur: number; lead: number };
}

// Slab proportions, in path units (the mark is 1000 tall).
const DEPTH = 190;

const HERO_LOOK: Look = {
  studio: HERO_STUDIO,
  field: { texW: 512, band: 72, sdBlur: 2.4, gradBlur: 5, medial: 0 },
  round: 58,
  cylinder: 0,
  tiltMax: 70, // meets the walls' 20-degree barrel, so the face rolls into the wall
  roughness: 0.13,
  aa: 0.3,
  saturation: 0.9,
  bloomLevels: 3,
  star: { len: 44, w: 1.0, core: 2.0, glow: 8, ref: 112 },
  band: { width: 0.085, I: 2.2, crown0: 0.8, crown1: 0.985, dur: 1.302, lead: 0.098 },
};

const SMALL_LOOK: Look = {
  studio: SMALL_STUDIO,
  field: { texW: 256, band: 96, sdBlur: 6, gradBlur: 12, medial: 70 },
  round: 70,
  cylinder: 1,
  // A stroke at 30 px letters is 8 or 9 device pixels across. Rolled the full
  // 70 degrees, its edges would mirror the side boxes as rim lines either side
  // of the crown (an inline). Held to this, a stroke sees only the key and its
  // soft falloff in the dwell: one polished bar, darkening to its edges. The
  // turn still sweeps the faces past the softbox and the rims.
  tiltMax: 28,
  roughness: 0.17,
  aa: 0.15,
  saturation: 1.0, // small marks have less contrast to carry the gold, so keep its colour
  bloomLevels: 1,
  star: { len: 11, w: 0.7, core: 1.2, glow: 3.0, ref: 30 },
  band: { width: 0.11, I: 1.6, crown0: 0.75, crown1: 0.98, dur: 3.255, lead: 0.245 },
};

/* ------------------------------------------------------------- scheduling */
// The build runs in slices: work carries on until it has held the main thread
// for SLICE_MS, then yields a task so input and paint can run.

const SLICE_MS = 10;
let sliceStart = 0;

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "function") {
      const ch = new MessageChannel();
      ch.port1.onmessage = (): void => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });
}

/** Yield to the page if this slice has run long enough (always, with `force`). */
async function pause(force = false): Promise<void> {
  if (!force && performance.now() - sliceStart < SLICE_MS) return;
  await nextTask();
  sliceStart = performance.now();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ shape */

let SHAPES: THREE.Shape[] | null = null;
function hdShapes(): THREE.Shape[] {
  if (!SHAPES) {
    // y flipped so the shape is y up; the letters span x 0..HD_WIDTH, y -HD_HEIGHT..0
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path transform="scale(1,-1)" d="${HD_PATH}"/></svg>`;
    SHAPES = new SVGLoader().parse(svg).paths.flatMap((p) => SVGLoader.createShapes(p));
  }
  return SHAPES;
}

// shape space (path units, y up) to object space (1 = mark height, centred on the letters' box)
const toObjX = (x: number): number => (x - HD_WIDTH / 2) / HD_HEIGHT;
const toObjY = (y: number): number => (y + HD_HEIGHT / 2) / HD_HEIGHT;

interface SharedGeometry {
  position: Float32Array;
  normal: Float32Array;
  radius: number;
}
let GEOMETRY: SharedGeometry | null = null;
function sharedGeometry(): SharedGeometry {
  if (GEOMETRY) return GEOMETRY;
  const geo = new THREE.ExtrudeGeometry(hdShapes(), { depth: DEPTH, curveSegments: 6, bevelEnabled: false });
  geo.translate(-HD_WIDTH / 2, HD_HEIGHT / 2, -DEPTH / 2);
  geo.scale(1 / HD_HEIGHT, 1 / HD_HEIGHT, 1 / HD_HEIGHT);
  geo.computeBoundingSphere();
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  GEOMETRY = {
    position: new Float32Array(pos.array as ArrayLike<number>),
    normal: new Float32Array(nor.array as ArrayLike<number>),
    radius: geo.boundingSphere ? geo.boundingSphere.radius : 1,
  };
  geo.dispose();
  return GEOMETRY;
}

/* ------------------------------------------------- signed distance field */
// Exact signed distance to the traced outline (as a polyline), in shape space
// (x right, y up, path units), inside negative, clamped to a band. Sign from an
// even-odd scanline at texel centres; distance by dead reckoning: exact nearest
// points seeded beside the outline, carried across the grid by a forward and a
// backward raster sweep. A light blur rounds the medial ridges. For the small
// marks a fourth channel holds each stroke's local half-width (a max filter of
// the inside distance), which scales the cylinder round-over.

interface FieldSpec {
  texW: number;
  band: number;
  sdBlur: number;
  gradBlur: number;
  medial: number; // max-filter reach in path units (0: no half-width channel)
}
interface Field {
  W: number;
  H: number;
  // ArrayBuffer-backed, as three's DataTexture (and TypeScript 5.9's lib.dom) require
  data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>;
  half: boolean;
  x0: number;
  y0: number;
  Wu: number;
  Hu: number;
}
// one build per spec per page; marks that ask while it runs share the promise
const FIELDS = new Map<string, Promise<Field>>();

function sharedField(spec: FieldSpec, half: boolean): Promise<Field> {
  const key = `${spec.texW}|${spec.band}|${spec.sdBlur}|${spec.gradBlur}|${spec.medial}|${half ? "h" : "f"}`;
  let p = FIELDS.get(key);
  if (!p) {
    p = buildField(spec, half);
    FIELDS.set(key, p);
    p.catch(() => FIELDS.delete(key));
  }
  return p;
}

function boxBlur2(ch: Float32Array, tmp: Float32Array, acc: Float32Array, W: number, H: number, r: number): void {
  // two passes of a running-sum box filter each way (close to a Gaussian)
  const norm = 1 / (2 * r + 1);
  for (let it = 0; it < 2; it++) {
    for (let y = 0; y < H; y++) {
      const o = y * W;
      let s = 0;
      for (let i = -r; i <= r; i++) s += ch[o + (i < 0 ? 0 : i >= W ? W - 1 : i)];
      for (let x = 0; x < W; x++) {
        tmp[o + x] = s * norm;
        const a = x + r + 1, b = x - r;
        s += ch[o + (a >= W ? W - 1 : a)] - ch[o + (b < 0 ? 0 : b)];
      }
    }
    acc.fill(0);
    for (let i = -r; i <= r; i++) {
      const o = (i < 0 ? 0 : i >= H ? H - 1 : i) * W;
      for (let x = 0; x < W; x++) acc[x] += tmp[o + x];
    }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      const oa = (y + r + 1 >= H ? H - 1 : y + r + 1) * W, ob = (y - r < 0 ? 0 : y - r) * W;
      for (let x = 0; x < W; x++) {
        ch[o + x] = acc[x] * norm;
        acc[x] += tmp[oa + x] - tmp[ob + x];
      }
    }
  }
}

function maxFilter(src: Float32Array, dst: Float32Array, tmp: Float32Array, W: number, H: number, r: number): void {
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      let m = 0;
      const a = x - r < 0 ? 0 : x - r, b = x + r >= W ? W - 1 : x + r;
      for (let i = a; i <= b; i++) if (src[o + i] > m) m = src[o + i];
      tmp[o + x] = m;
    }
  }
  for (let y = 0; y < H; y++) {
    const a = y - r < 0 ? 0 : y - r, b = y + r >= H ? H - 1 : y + r;
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let j = a; j <= b; j++) if (tmp[j * W + x] > m) m = tmp[j * W + x];
      dst[y * W + x] = m;
    }
  }
}

async function buildField(spec: FieldSpec, half: boolean): Promise<Field> {
  const PAD = 64;
  const contours: THREE.Vector2[][] = [];
  for (const sh of hdShapes()) {
    const ex = sh.extractPoints(8);
    contours.push(ex.shape, ...ex.holes);
  }
  let nseg = 0;
  for (const c of contours) nseg += c.length;
  const ax = new Float64Array(nseg), ay = new Float64Array(nseg), bx = new Float64Array(nseg), by = new Float64Array(nseg);
  let k = 0, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      if (a.x === b.x && a.y === b.y) continue;
      ax[k] = a.x; ay[k] = a.y; bx[k] = b.x; by[k] = b.y; k++;
      if (a.x < minX) minX = a.x;
      if (a.x > maxX) maxX = a.x;
      if (a.y < minY) minY = a.y;
      if (a.y > maxY) maxY = a.y;
    }
  }
  nseg = k;
  const x0 = minX - PAD, y0 = minY - PAD;
  const Wu = maxX - minX + 2 * PAD, Hu = maxY - minY + 2 * PAD;
  const s = spec.texW / Wu; // texels per path unit
  const inv = 1 / s;
  const W = spec.texW, H = Math.round(Hu * s), N = W * H;
  const cxs = new Float64Array(W), cys = new Float64Array(H);
  for (let i = 0; i < W; i++) cxs[i] = x0 + (i + 0.5) * inv;
  for (let j = 0; j < H; j++) cys[j] = y0 + (j + 0.5) * inv;

  // 1. sign: even-odd crossings per texel row, segments bucketed by row
  const inside = new Uint8Array(N);
  const rowStart = new Int32Array(H + 1);
  const rowOf = (y: number): number => Math.floor((y - y0) * s - 0.5);
  for (let q = 0; q < nseg; q++) {
    const r0 = Math.max(0, rowOf(Math.min(ay[q], by[q])) + 1), r1 = Math.min(H - 1, rowOf(Math.max(ay[q], by[q])));
    for (let j = r0; j <= r1; j++) rowStart[j + 1]++;
  }
  for (let j = 0; j < H; j++) rowStart[j + 1] += rowStart[j];
  const fillAt = rowStart.slice(0, H);
  const bucket = new Int32Array(rowStart[H]);
  for (let q = 0; q < nseg; q++) {
    const r0 = Math.max(0, rowOf(Math.min(ay[q], by[q])) + 1), r1 = Math.min(H - 1, rowOf(Math.max(ay[q], by[q])));
    for (let j = r0; j <= r1; j++) bucket[fillAt[j]++] = q;
  }
  const xs = new Float64Array(128);
  for (let j = 0; j < H; j++) {
    const Y = cys[j];
    let n = 0;
    for (let e = rowStart[j]; e < rowStart[j + 1]; e++) {
      const q = bucket[e];
      if (ay[q] <= Y !== by[q] <= Y && n < 128) xs[n++] = ax[q] + ((Y - ay[q]) * (bx[q] - ax[q])) / (by[q] - ay[q]);
    }
    const row = xs.subarray(0, n).sort();
    for (let p = 0; p + 1 < n; p += 2) {
      const i0 = Math.max(0, Math.ceil((row[p] - x0) * s - 0.5));
      const i1 = Math.min(W - 1, Math.floor((row[p + 1] - x0) * s - 0.5));
      if (i1 >= i0) inside.fill(1, j * W + i0, j * W + i1 + 1);
    }
  }
  await pause();

  // 2. seeds: exact nearest outline points within ~1.5 texels of the outline
  const FAR = 1e6;
  const d2 = new Float32Array(N).fill(1e30);
  const px = new Float32Array(N).fill(FAR), py = new Float32Array(N).fill(FAR);
  const R = 1.6 * inv;
  for (let q = 0; q < nseg; q++) {
    if ((q & 255) === 255) await pause();
    const Ax = ax[q], Ay = ay[q], dx = bx[q] - Ax, dy = by[q] - Ay;
    const L2 = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(Ax, bx[q]) - R - x0) * s));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(Ax, bx[q]) + R - x0) * s));
    const j0 = Math.max(0, Math.floor((Math.min(Ay, by[q]) - R - y0) * s));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(Ay, by[q]) + R - y0) * s));
    for (let j = j0; j <= j1; j++) {
      const Y = cys[j];
      for (let i = i0; i <= i1; i++) {
        const X = cxs[i];
        let t = ((X - Ax) * dx + (Y - Ay) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = Ax + t * dx, qy = Ay + t * dy;
        const e2 = (X - qx) * (X - qx) + (Y - qy) * (Y - qy);
        const o = j * W + i;
        if (e2 < d2[o]) { d2[o] = e2; px[o] = qx; py[o] = qy; }
      }
    }
  }
  await pause();
  // 3. carry nearest points across the grid: forward and backward raster sweeps
  const relax = (o: number, X: number, Y: number, n: number): void => {
    const ex = X - px[n], ey = Y - py[n];
    const e = ex * ex + ey * ey;
    if (e < d2[o]) { d2[o] = e; px[o] = px[n]; py[o] = py[n]; }
  };
  for (let j = 0; j < H; j++) {
    if ((j & 31) === 31) await pause();
    const Y = cys[j];
    for (let i = 0; i < W; i++) {
      const o = j * W + i, X = cxs[i];
      if (i > 0) relax(o, X, Y, o - 1);
      if (j > 0) {
        relax(o, X, Y, o - W);
        if (i > 0) relax(o, X, Y, o - W - 1);
        if (i < W - 1) relax(o, X, Y, o - W + 1);
      }
    }
    for (let i = W - 2; i >= 0; i--) relax(j * W + i, cxs[i], Y, j * W + i + 1);
  }
  await pause();
  for (let j = H - 1; j >= 0; j--) {
    if ((j & 31) === 0) await pause();
    const Y = cys[j];
    for (let i = W - 1; i >= 0; i--) {
      const o = j * W + i, X = cxs[i];
      if (i < W - 1) relax(o, X, Y, o + 1);
      if (j < H - 1) {
        relax(o, X, Y, o + W);
        if (i < W - 1) relax(o, X, Y, o + W + 1);
        if (i > 0) relax(o, X, Y, o + W - 1);
      }
    }
    for (let i = 1; i < W; i++) relax(j * W + i, cxs[i], Y, j * W + i - 1);
  }
  await pause();

  // 4. signed distance and outward gradient, clamped to the band
  const sd = new Float32Array(N), gx = new Float32Array(N), gy = new Float32Array(N);
  const B = spec.band, B2 = B * B;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const o = j * W + i;
      const sg = inside[o] ? -1 : 1;
      if (d2[o] >= B2) { sd[o] = sg * B; continue; }
      const d = Math.sqrt(d2[o]);
      sd[o] = sg * d;
      if (d > 1e-6) {
        gx[o] = (sg * (cxs[i] - px[o])) / d;
        gy[o] = (sg * (cys[j] - py[o])) / d;
      }
    }
  }
  // 5. local half-width (small marks): the largest inside distance within reach
  let hw: Float32Array | null = null;
  const tmp = new Float32Array(N), acc = new Float32Array(W);
  await pause();
  if (spec.medial > 0) {
    const din = new Float32Array(N);
    for (let i = 0; i < N; i++) din[i] = sd[i] < 0 ? -sd[i] : 0;
    hw = new Float32Array(N);
    maxFilter(din, hw, tmp, W, H, Math.max(1, Math.round(spec.medial * s)));
    await pause();
    boxBlur2(hw, tmp, acc, W, H, Math.max(1, Math.round(18 * s)));
    await pause();
  }
  // 6. round the medial ridges; the gradient gets a wider blur than the
  //    distance, which irons out the tiny tangent kinks where traced curves join
  boxBlur2(sd, tmp, acc, W, H, Math.max(1, Math.round(spec.sdBlur * s)));
  await pause();
  boxBlur2(gx, tmp, acc, W, H, Math.max(1, Math.round(spec.gradBlur * s)));
  await pause();
  boxBlur2(gy, tmp, acc, W, H, Math.max(1, Math.round(spec.gradBlur * s)));
  await pause();
  // 7. pack: r = signed distance (path units), g/b = gradient (y up), a = half-width
  let data: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>;
  if (half) {
    const u16 = new Uint16Array(N * 4);
    const h = THREE.DataUtils.toHalfFloat;
    for (let i = 0, o = 0; i < N; i++, o += 4) {
      if ((i & 32767) === 32767) await pause();
      u16[o] = h(sd[i]);
      u16[o + 1] = h(gx[i]);
      u16[o + 2] = h(gy[i]);
      u16[o + 3] = h(hw ? hw[i] : 0);
    }
    data = u16;
  } else {
    const f32 = new Float32Array(N * 4);
    for (let i = 0, o = 0; i < N; i++, o += 4) {
      if ((i & 32767) === 32767) await pause();
      f32[o] = sd[i];
      f32[o + 1] = gx[i];
      f32[o + 2] = gy[i];
      f32[o + 3] = hw ? hw[i] : 0;
    }
    data = f32;
  }
  return { W, H, data, half, x0, y0, Wu, Hu };
}

/* ------------------------------------------------------- outline features */
// Sharp convex corners (serif tips) and long smooth convex arcs (the D bowl):
// the places stars may live. Object units, y up. Built once per page.

interface Corner { x: number; y: number; ang: number; half: number }
interface Features { corners: Corner[]; outline: { x: number; y: number; nx: number; ny: number }[] }
let FEATURES: Features | null = null;

function outlineFeatures(): Features {
  if (FEATURES) return FEATURES;
  const pts = hdShapes()[0].extractPoints(14).shape.map((p) => ({ x: toObjX(p.x), y: toObjY(p.y) }));
  const P: { x: number; y: number }[] = [];
  for (const p of pts) {
    const q = P[P.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-7) P.push(p);
  }
  if (Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 1e-7) P.pop();
  const n = P.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sgn = area > 0 ? 1 : -1; // +1 for counter-clockwise
  const seg = new Float64Array(n);
  for (let i = 0; i < n; i++) seg[i] = Math.hypot(P[(i + 1) % n].x - P[i].x, P[(i + 1) % n].y - P[i].y);
  const walk = (i: number, dist: number, dir: number): { x: number; y: number } => {
    let j = i, acc = 0;
    for (let k = 0; k < n; k++) {
      const jn = dir > 0 ? (j + 1) % n : (j - 1 + n) % n;
      const sl = dir > 0 ? seg[j] : seg[jn];
      if (acc + sl >= dist) {
        const f = (dist - acc) / sl;
        return { x: P[j].x + (P[jn].x - P[j].x) * f, y: P[j].y + (P[jn].y - P[j].y) * f };
      }
      acc += sl;
      j = jn;
    }
    return P[j];
  };
  const Lw = 0.012;
  const turn = new Float64Array(n), nMid = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = walk(i, Lw, -1), f = walk(i, Lw, 1), p = P[i];
    const tix = p.x - b.x, tiy = p.y - b.y, tox = f.x - p.x, toy = f.y - p.y;
    const li = Math.hypot(tix, tiy) || 1, lo = Math.hypot(tox, toy) || 1;
    turn[i] = sgn * Math.atan2(tix * toy - tiy * tox, tix * tox + tiy * toy); // + convex
    const mx = (sgn * tiy) / li + (sgn * toy) / lo, my = (-sgn * tix) / li + (-sgn * tox) / lo;
    nMid[i] = Math.atan2(my, mx);
  }
  const corners: Corner[] = [];
  const MIN_TURN = 60 * D2R, SUPPRESS = 0.022;
  for (let i = 0; i < n; i++) {
    if (turn[i] < MIN_TURN) continue;
    let best = true;
    for (const dir of [1, -1]) {
      let acc = 0;
      for (let k = 1; k < n && acc < SUPPRESS && best; k++) {
        const j = (i + dir * k + n) % n;
        acc += seg[dir > 0 ? (j - 1 + n) % n : j];
        if (turn[j] > turn[i] || (dir < 0 && turn[j] === turn[i])) best = false;
      }
    }
    if (best) corners.push({ x: P[i].x, y: P[i].y, ang: nMid[i], half: turn[i] / 2 });
  }
  // the outline with smoothed outward normals (for points on smooth curves)
  const outline: Features["outline"] = [];
  for (let i = 0; i < n; i++) {
    const b = walk(i, 0.03, -1), f = walk(i, 0.03, 1);
    const tx = f.x - b.x, ty = f.y - b.y, l = Math.hypot(tx, ty) || 1;
    outline.push({ x: P[i].x, y: P[i].y, nx: (sgn * ty) / l, ny: (-sgn * tx) / l });
  }
  FEATURES = { corners, outline };
  return FEATURES;
}

/* ------------------------------------------------------------- environment */

const dirAE = (az: number, el: number): THREE.Vector3 =>
  new THREE.Vector3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), Math.cos(az * D2R) * Math.cos(el * D2R));
const v3 = (v: THREE.Vector3): string => `vec3(${v.x.toFixed(6)}, ${v.y.toFixed(6)}, ${v.z.toFixed(6)})`;
const c3 = (c: Vec3, k = 1): string => `vec3(${c.map((x) => (x * k).toFixed(5)).join(", ")})`;

const STUDIO_SHADERS = new Map<string, string>();
function studioShader(st: Studio): string {
  const hit = STUDIO_SHADERS.get(st.key);
  if (hit) return hit;
  let body = "";
  for (const b of st.boxes) {
    const c = dirAE(b.az, b.el);
    const worldUp = Math.abs(c.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(worldUp, c).normalize();
    const u = new THREE.Vector3().crossVectors(c, r).normalize();
    const cr = Math.cos(b.roll * D2R), sr = Math.sin(b.roll * D2R);
    const r2 = r.clone().multiplyScalar(cr).addScaledVector(u, sr);
    const u2 = u.clone().multiplyScalar(cr).addScaledVector(r, -sr);
    const hs = `vec2(${Math.tan((b.w / 2) * D2R).toFixed(5)}, ${Math.tan((b.h / 2) * D2R).toFixed(5)})`;
    body += `  L += ${c3(b.col, b.I)} * box(d, ${v3(c)}, ${v3(r2)}, ${v3(u2)}, ${hs}, ${b.soft.toFixed(4)}, ${b.grad.toFixed(3)});\n`;
  }
  if (st.ring) {
    const ra = dirAE(st.ring.az, st.ring.el);
    body += `  { float ang = acos(clamp(dot(d, ${v3(ra)}), -1.0, 1.0)) * ${(1 / D2R).toFixed(4)};\n`;
    body += `    float top = 0.55 + 0.45 * smoothstep(-0.6, 0.6, d.y);\n`;
    body += `    L += ${c3(WHITE, st.ring.I)} * top * exp(-pow((ang - ${st.ring.radius.toFixed(2)}) / ${st.ring.width.toFixed(3)}, 2.0)); }\n`;
  }
  const src = /* glsl */ `
    varying vec2 vUv;
    float box(vec3 d, vec3 c, vec3 r, vec3 u, vec2 hs, float soft, float grad) {
      float z = dot(d, c);
      if (z <= 0.05) return 0.0;
      vec2 p = vec2(dot(d, r), dot(d, u)) / z;
      vec2 q = abs(p) - hs + soft;
      float sdf = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - soft;
      float m = 1.0 - smoothstep(-soft, soft, sdf);
      vec2 n = p / hs;
      float diffuse = 1.0 - 0.25 * clamp(dot(n, n), 0.0, 1.0);
      return m * diffuse * clamp(1.0 + grad * n.y, 0.0, 2.0);
    }
    void main() {
      float phi = (vUv.x - 0.5) * 6.28318530718;
      float lat = (vUv.y - 0.5) * 3.14159265359;
      vec3 d = vec3(cos(lat) * cos(phi), sin(lat), cos(lat) * sin(phi));
      vec3 L = ${c3(st.base)};
      L += ${c3(st.floor)} * smoothstep(-0.05, -0.7, d.y);
${body}
      gl_FragColor = vec4(L, 1.0);
    }`;
  STUDIO_SHADERS.set(st.key, src);
  return src;
}

/* ---------------------------------------------------------------- shaders */

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// four bilinear taps around the centre (a 4x4 box), optional soft bright pass
const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; uniform float uPrefilter; uniform float uMaxBr;
  varying vec2 vUv;
  vec3 pf(vec3 c) {
    if (uPrefilter < 0.5) return c;
    float br = max(c.r, max(c.g, c.b));
    // cap the source (on paper a hot wall must not feed a wide haze)
    c *= min(1.0, uMaxBr / max(br, 1e-4));
    br = min(br, uMaxBr);
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float w = max(soft, br - uThreshold) / max(br, 1e-4);
    return c * w / (1.0 + br * 0.25); // Karis-style weight keeps tiny hot spots from flickering
  }
  void main() {
    vec3 a = pf(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
    vec3 b = pf(texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb);
    vec3 c = pf(texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb);
    vec3 d = pf(texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb);
    gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
  }`;

// tent upsample of the coarser level, added to the finer level
const UP_FRAG = /* glsl */ `
  uniform sampler2D tCoarse; uniform sampler2D tFine; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tCoarse, vUv).rgb * 4.0;
    s += texture2D(tCoarse, vUv + uTexel * vec2(-1.0, 0.0)).rgb * 2.0;
    s += texture2D(tCoarse, vUv + uTexel * vec2( 1.0, 0.0)).rgb * 2.0;
    s += texture2D(tCoarse, vUv + uTexel * vec2(0.0, -1.0)).rgb * 2.0;
    s += texture2D(tCoarse, vUv + uTexel * vec2(0.0,  1.0)).rgb * 2.0;
    s += texture2D(tCoarse, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
    s += texture2D(tCoarse, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
    s += texture2D(tCoarse, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
    s += texture2D(tCoarse, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    gl_FragColor = vec4(s / 16.0 + texture2D(tFine, vUv).rgb, 1.0);
  }`;

const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float uExposure; uniform float uGlow; uniform float uGlowOnMetal; uniform float uUseBloom;
  uniform vec3 uGlowTint; uniform float uToneMix; uniform float uSat; uniform vec3 uShadowTint;
  varying vec2 vUv;
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 color) {
    const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    color *= 1.0 / 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit(color);
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
  }
  vec3 neutral(vec3 color) {
    // Khronos PBR Neutral: keeps the gold's hue into the highlights
    const float startCompression = 0.8 - 0.04;
    const float desaturation = 0.15;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < startCompression) return color;
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }
  vec3 grade(vec3 c) {
    // a touch less saturation (champagne, not brass), and warm the shadows so
    // lit-away faces read as deep gold-brown rather than olive
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(l), c, uSat), 0.0);
    float sh = 1.0 - smoothstep(0.0, 0.2, l);
    return c * mix(vec3(1.0), uShadowTint, sh);
  }
  vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec4 s = texture2D(tScene, vUv);
    float a = clamp(s.a, 0.0, 1.0);
    vec3 c = a > 1e-4 ? s.rgb / a : vec3(0.0);
    vec3 col = srgb(grade(mix(aces(c * uExposure), neutral(c * uExposure), uToneMix))) * a; // premultiplied
    vec3 rgb = col; float alpha = a;
    if (uUseBloom > 0.5) {
      // fade the glow out before the canvas edge so it never clips into a box
      vec2 e = smoothstep(vec2(0.0), vec2(0.12), vUv) * smoothstep(vec2(0.0), vec2(0.12), 1.0 - vUv);
      vec3 g = texture2D(tBloom, vUv).rgb * uGlow * e.x * e.y;
      g = 1.0 - exp(-g * uGlowTint); // soft saturation, no clipping edge
      vec3 ge = srgb(g);
      float ga = max(ge.r, max(ge.g, ge.b));
      rgb = col + ge * mix(1.0 - a, 1.0, uGlowOnMetal);
      alpha = a + ga * (1.0 - a);
    }
    float n = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    alpha = clamp(alpha + n, 0.0, 1.0);
    rgb = clamp(rgb + n, 0.0, 1.0);
    alpha = max(alpha, max(rgb.r, max(rgb.g, rgb.b)));
    gl_FragColor = vec4(min(rgb, vec3(alpha)), alpha);
  }`;

const STAR_VERT = /* glsl */ `
  attribute vec4 aA; // ndc x, ndc y, ndc z, intensity
  attribute vec4 aB; // rotation, ray length (device px), ray width scale, unused
  uniform vec2 uRes; uniform sampler2D uDepth;
  varying vec2 vP; varying float vI; varying float vL; varying float vW;
  void main() {
    vec2 uv = aA.xy * 0.5 + 0.5;
    float zw = aA.z * 0.5 + 0.5;
    float d0 = texture2D(uDepth, uv).r;
    float vis = smoothstep(-0.0008, 0.0, d0 - zw); // metal in front hides the star
    float I = aA.w * vis;
    vI = I; vL = aB.y; vW = aB.z;
    float c = cos(aB.x), s = sin(aB.x);
    vec2 q = position.xy * aB.y * step(0.003, I);
    vP = q;
    vec2 off = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    gl_Position = vec4(aA.xy + off * 2.0 / uRes, 0.0, 1.0);
  }`;

const STAR_FRAG = /* glsl */ `
  uniform vec3 uCore; uniform vec3 uRay; uniform float uGain; uniform float uInk;
  uniform float uW; uniform float uCoreR; uniform float uGlowR;
  varying vec2 vP; varying float vI; varying float vL; varying float vW;
  float ray(vec2 p, float len, float w) {
    float x = abs(p.x) / len;
    if (x >= 1.0) return 0.0;
    float t = 1.0 - x;
    float ww = w * (0.4 + 0.6 * t);
    return pow(t, 1.25) * exp(-(p.y * p.y) / (ww * ww));
  }
  void main() {
    float I = vI;
    float L = vL * (0.28 + 0.72 * I); // the rays open with the flare
    float w = uW * vW;
    vec2 p = vP;
    float rays = ray(p, L, w) + ray(p.yx, L * 0.82, w);
    vec2 pd = vec2(p.x + p.y, p.x - p.y) * 0.70710678;
    float diag = 0.55 * (ray(pd, L * 0.34, w * 0.85) + ray(pd.yx, L * 0.34, w * 0.85));
    float r2 = dot(p, p);
    float core = exp(-r2 / (uCoreR * uCoreR));
    float glow = exp(-r2 / (uGlowR * uGlowR));
    vec3 c = uCore * (core * 2.0 + rays * 1.5) + uRay * (rays * 0.9 + diag * 1.3 + glow * 0.6);
    c *= I * uGain;
    // on paper a light-only glint vanishes: there the rays also cover a little
    // (alpha above their light), so they read as fine gold lines
    float a = clamp(max(c.r, max(c.g, c.b)) + uInk * (rays + diag) * I * uGain, 0.0, 1.0);
    gl_FragColor = vec4(min(c, vec3(a)), a);
  }`;

/* ----------------------------------------------------------------- themes */

interface ThemeLook {
  exposure: number;
  wallGain: number; // the walls' reflections, relative to the faces
  glow: number;
  glowOnMetal: number;
  threshold: number; // the glow's bright pass
  glowMax: number; // the brightest the glow's source may be
  swell: number; // extra glow at the mid-turn flash
  flash: number; // the sheen that sweeps the crowns at the mid-turn flash
  starGain: number;
  starInk: number;
  core: Vec3;
  ray: Vec3;
  glowTint: Vec3;
}
const THEMES: Record<HdTheme, ThemeLook> = {
  dark: {
    exposure: 1.0, wallGain: 1.0, glow: 1.6, glowOnMetal: 0.25, threshold: 0.9, glowMax: 64, swell: 1.1, flash: 2.6,
    starGain: 1.0, starInk: 0, core: [1.0, 0.98, 0.92], ray: [1.0, 0.87, 0.6], glowTint: [1.0, 0.85, 0.6],
  },
  // light: a faint warm tint only, from a capped source; no swell or flash,
  // which would read as a smudge on paper; the walls held back a little so a
  // lit wall keeps a gold value against the paper
  light: {
    exposure: 0.92, wallGain: 0.8, glow: 0.2, glowOnMetal: 0.15, threshold: 1.0, glowMax: 2.2, swell: 0, flash: 0,
    starGain: 1.0, starInk: 0.35, core: [1.0, 0.97, 0.88], ray: [0.78, 0.62, 0.3], glowTint: [1.0, 0.8, 0.45],
  },
};

// Linear F0 of the metal and the grade: a rich champagne-to-yellow gold.
const GOLD: Vec3 = [1.0, 0.845, 0.44];
const TONE_MIX = 0.5; // half ACES (contrast), half PBR Neutral (hue held in the highlights)
const SHADOW_TINT: Vec3 = [1.04, 0.985, 0.9];

/* -------------------------------------------------------------- the stars */
// A star cue: where (object units, on the round-over), which face, when (cycle
// phase of the peak), how strong and how long its rays (CSS px), and how long
// its fade. A star on a turning face is also faded as the face turns away
// (facing, ramp); its own fade is kept short enough to finish inside that, so
// it glints rather than blinks off.

interface StarCue {
  u: number;
  x: number;
  y: number;
  side: number;
  gain: number;
  len: number;
  rot: number;
  facing: number; // gone once the face is turned further than this from the viewer
  ramp: number; // ... fading in over this much more facing
  decay: number; // seconds: the fade after the peak
}

function starEnvelope(dt: number, decay: number): number {
  // a quick flare and a slower fade, measured from the peak
  if (dt < 0) return Math.exp(-(dt * dt) / (0.1 * 0.1));
  return Math.exp(-Math.pow(dt / decay, 1.6));
}

/* ------------------------------------------------------------- capability */

function probeHalfFloatTargets(gl: WebGL2RenderingContext): { ok: boolean; samples: number } {
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_color_buffer_half_float");
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 4, 4, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  let samples = 0;
  if (ok) {
    const list = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array | null;
    if (list) for (const v of list) if (v <= 4 && v > samples) samples = v;
  }
  while (gl.getError() !== gl.NO_ERROR) {
    /* clear any error the probe raised so three starts clean */
  }
  return { ok, samples };
}

/* ------------------------------------------------------------------- mark */

const COMPLETION_STATUS_KHR = 0x91b1;
const FLASH_SIGMA = 0.13; // seconds: the flash's rise and fall
const FLASH_WIDTH = 0.34; // object units: the sheen's half-width across the face

export function createHdMarkScene(canvas: HTMLCanvasElement, opts: { theme: HdTheme; markFill: number; small?: boolean }): HdMarkScene {
  sliceStart = performance.now();
  const small = opts.small === true;
  const look = small ? SMALL_LOOK : HERO_LOOK;
  const tt = small ? SMALL_TIME : HERO_TIME;
  const markFill = opts.markFill;
  let theme: HdTheme = opts.theme === "light" ? "light" : "dark";

  /* ---- synchronous: the context and what it can do (the throw contract) */
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  });
  if (!gl) throw new Error("HD mark: WebGL2 is not available");
  const loseContext = (): void => {
    const ext = gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  };
  const caps = probeHalfFloatTargets(gl);
  if (!caps.ok) {
    loseContext();
    throw new Error("HD mark: half-float render targets are not supported");
  }

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl as unknown as WebGLRenderingContext,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
  } catch (err) {
    loseContext();
    throw err;
  }
  // link status is checked in `ready` instead: three's own check reads the
  // info logs, which are null once the context is lost, and logs to the console
  renderer.debug.checkShaderErrors = false;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // the composite does its own encoding
  renderer.toneMapping = THREE.NoToneMapping;
  const floatLinear = gl.getExtension("OES_texture_float_linear") !== null;
  const parallel = gl.getExtension("KHR_parallel_shader_compile") !== null;

  let disposed = false;
  let lost = false;
  const onLost = (): void => {
    lost = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);
  const alive = (): boolean => {
    if (!lost && gl.isContextLost()) lost = true;
    return !disposed && !lost;
  };

  /* ---- cheap per-context objects; their GPU work happens later */
  const halfDepth = DEPTH / 2 / HD_HEIGHT;
  const geo = new THREE.BufferGeometry(); // filled from the shared arrays in ready
  let fieldTex: THREE.DataTexture | null = null;
  let envPM: THREE.WebGLRenderTarget | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;
  let pmrem: THREE.PMREMGenerator | null = null;

  /* material */
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(GOLD[0], GOLD[1], GOLD[2]), metalness: 1, roughness: look.roughness });
  const matUniforms: Record<string, THREE.IUniform> = {
    uField: { value: null },
    uFieldMap: { value: new THREE.Vector4() },
    uRound: { value: look.round },
    uCylinder: { value: look.cylinder },
    uHalfDepth: { value: halfDepth },
    uBarrel: { value: 20 * D2R },
    uTiltMax: { value: Math.sin(look.tiltMax * D2R) },
    uUnits: { value: HD_HEIGHT },
    uAA: { value: look.aa },
    uBand: { value: new THREE.Vector4(0, look.band.width, 0, 0) }, // centre, width, intensity
    uBandDir: { value: new THREE.Vector2(1, 0) },
    uBandCrown: { value: new THREE.Vector2(look.band.crown0, look.band.crown1) },
    uFlash: { value: new THREE.Vector4(0, 0, 0, FLASH_WIDTH) }, // front, back, sweep centre, width
    uWallGain: { value: 1 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, matUniforms);
    sh.vertexShader =
      "varying vec3 vObj; varying vec3 vObjN; varying vec3 vNx; varying vec3 vNy; varying vec3 vNz;\n" +
      sh.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n vObj = position; vObjN = normal; vNx = normalMatrix[0]; vNy = normalMatrix[1]; vNz = normalMatrix[2];",
      );
    sh.fragmentShader =
      "varying vec3 vObj; varying vec3 vObjN; varying vec3 vNx; varying vec3 vNy; varying vec3 vNz;\n" +
      "uniform sampler2D uField; uniform vec4 uFieldMap; uniform float uRound; uniform float uCylinder; uniform float uHalfDepth; uniform float uBarrel; uniform float uTiltMax;\n" +
      "uniform float uUnits; uniform float uAA; uniform vec4 uBand; uniform vec2 uBandDir; uniform vec2 uBandCrown; uniform vec4 uFlash; uniform float uWallGain;\n" +
      sh.fragmentShader
        .replace(
          "#include <normal_fragment_begin>",
          /* glsl */ `#include <normal_fragment_begin>
          float hdCrown = 0.0; // 1 on the flat crown of a face, falling over the round-over, 0 on walls
          float hdWall = 0.0;
          {
            // the object position changes linearly across a triangle, so its
            // screen derivatives are exact (taken here, in uniform control flow)
            vec3 fx = dFdx(vObj), fy = dFdy(vObj);
            vec4 fld = texture2D(uField, vObj.xy * uFieldMap.xz + uFieldMap.yw);
            vec2 gd = fld.gb / max(length(fld.gb), 1e-4);
            vec3 nObj;
            float spread; // how far the normal turns across this pixel (radians)
            if (abs(vObjN.z) < 0.5) {
              // the walls bulge a little (a barrel), so a wall reflects a band
              // of the studio rather than one flat patch of it
              hdWall = 1.0;
              float lift = clamp(vObj.z / uHalfDepth, -1.0, 1.0) * uBarrel;
              nObj = vec3(gd * cos(lift), sin(lift));
              spread = max(abs(fx.z), abs(fy.z)) / uHalfDepth * uBarrel;
            } else {
              // the pillow: tilt grows from 0 inside the round-over to
              // uTiltMax at the outline (70 degrees on the hero, where it
              // meets the wall's own tilt; less on the small marks)
              float reach = mix(uRound, clamp(fld.a, 6.0, uRound), uCylinder);
              float a = clamp(1.0 + fld.r / reach, 0.0, 1.0);
              vec2 g = mix(fld.gb, gd, uCylinder * smoothstep(0.0, 0.5, a));
              float ct = uTiltMax;
              float st = a * ct;
              nObj = vec3(g * st, sign(vObj.z) * sqrt(max(1.0 - st * st, 0.0)));
              hdCrown = abs(nObj.z);
              // the pixel's footprint across the outline, in path units: at a
              // grazing angle a whole round-over can fall inside one pixel
              float foot = max(abs(dot(fx.xy, gd)), abs(dot(fy.xy, gd))) * uUnits;
              float da = 0.5 * foot / reach;
              spread = asin(clamp(a + da, 0.0, 1.0) * ct) - asin(clamp(a - da, 0.0, 1.0) * ct);
            }
            normal = normalize(nObj.x * vNx + nObj.y * vNy + nObj.z * vNz);
            vec3 toEye = normalize(vViewPosition);
            // specular anti-aliasing: widen the lobe to cover the normals the
            // pixel spans, so one shading sample cannot land on a thin light by
            // chance (the crawling speckle a grazing rim would otherwise show)
            float alpha = roughnessFactor * roughnessFactor;
            float aaAlpha = uAA * spread;
            roughnessFactor = min(0.75, sqrt(sqrt(alpha * alpha + aaAlpha * aaAlpha)));
            // a shading normal turned away from the eye on a triangle that still
            // faces it is lifted back toward the eye: a smooth floor at about 0.1
            float nv = dot(normal, toEye);
            float lifted = 0.5 * (nv + 0.12 + sqrt((nv - 0.12) * (nv - 0.12) + 0.02));
            normal = normalize(normal + toEye * (lifted - nv));
            // and where the view grazes, a little more lobe still
            roughnessFactor = max(roughnessFactor, 0.36 * (1.0 - smoothstep(0.08, 0.3, lifted)));
            nonPerturbedNormal = normal;
          }`,
        )
        .replace(
          "#include <lights_fragment_maps>",
          /* glsl */ `#include <lights_fragment_maps>
          #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
          radiance *= mix(1.0, uWallGain, hdWall);
          if (hdWall < 0.5) {
            float along = dot(vObj.xy, uBandDir);
            if (uBand.z > 0.0 && vObj.z > 0.0) {
              // the dwell's light band: a soft light behind the camera that the
              // polished crowns pick up where the band passes
              float s = along - uBand.x;
              float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
              radiance += vec3(1.0, 0.975, 0.93) * uBand.z * exp(-s * s / (uBand.y * uBand.y)) * smoothstep(uBandCrown.x, uBandCrown.y, facing);
            }
            float flash = vObj.z > 0.0 ? uFlash.x : uFlash.y;
            if (flash > 0.0) {
              // the mid-turn flash: the face passes the big softbox, and a broad
              // sheen sweeps its polished crowns
              float s = (along - uFlash.z) / uFlash.w;
              radiance += vec3(1.0, 0.97, 0.9) * flash * exp(-s * s) * smoothstep(0.72, 0.97, hdCrown);
            }
          }
          #endif`,
        );
  };
  const mesh = new THREE.Mesh(geo, mat);
  const pivot = new THREE.Group();
  pivot.add(mesh);
  const scene = new THREE.Scene();
  scene.add(pivot);

  /* camera: the front face fills markFill of the canvas height at t = 0 */
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  const fit = (): void => {
    const d = 1 / markFill / (2 * Math.tan((camera.fov / 2) * D2R));
    camera.position.set(0, 0, d + halfDepth * Math.cos(TILT));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  fit();

  /* full-screen passes */
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passMat = (frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });

  /* post materials */
  const downMat = passMat(DOWN_FRAG, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.9 }, uKnee: { value: 0.5 }, uPrefilter: { value: 1 }, uMaxBr: { value: 64 },
  });
  const upMat = passMat(UP_FRAG, { tCoarse: { value: null }, tFine: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const compMat = passMat(COMPOSITE_FRAG, {
    tScene: { value: null }, tBloom: { value: null },
    uExposure: { value: 1 }, uToneMix: { value: TONE_MIX }, uGlow: { value: 1 }, uGlowOnMetal: { value: 0.3 }, uUseBloom: { value: 1 },
    uGlowTint: { value: new THREE.Vector3(1, 0.9, 0.7) }, uSat: { value: look.saturation }, uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
  });

  /* stars */
  const MAX_STARS = 2;
  const starGeo = new THREE.InstancedBufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  starGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4);
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4);
  aA.setUsage(THREE.DynamicDrawUsage);
  aB.setUsage(THREE.DynamicDrawUsage);
  starGeo.setAttribute("aA", aA);
  starGeo.setAttribute("aB", aB);
  starGeo.instanceCount = MAX_STARS;
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) }, uDepth: { value: null },
      uCore: { value: new THREE.Vector3() }, uRay: { value: new THREE.Vector3() }, uGain: { value: 1 }, uInk: { value: 0 },
      uW: { value: 1 }, uCoreR: { value: 2 }, uGlowR: { value: 8 },
    },
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.frustumCulled = false;
  const starScene = new THREE.Scene();
  starScene.add(starMesh);

  /* timing that depends only on the timetable */
  const bandU1 = tt.dwell - look.band.lead;
  const bandU0 = bandU1 - look.band.dur;
  const flashF = phaseOfYaw(tt, -50 * D2R), flashB = phaseOfYaw(tt, -230 * D2R);
  // filled in ready, from the outline
  let bandFrom = 0, bandTo = 1, flashMid = 0, flashHalf = 1;
  const cues: StarCue[] = [];
  let level = new Float64Array(0);

  /* per-frame state (no allocation per frame) */
  const T: ThemeLook = { ...THEMES.dark };
  let W = 1, H = 1, ss = 1, dprNow = 1;
  let starPx = 1; // device px per CSS px of star, scaled with the mark's size
  let rtScene: THREE.WebGLRenderTarget | null = null;
  const downs: THREE.WebGLRenderTarget[] = [];
  const ups: (THREE.WebGLRenderTarget | undefined)[] = [];
  let glowSrc: THREE.Texture | null = null;
  const disposeTargets = (): void => {
    if (rtScene) {
      if (rtScene.depthTexture) rtScene.depthTexture.dispose();
      rtScene.dispose();
    }
    for (const r of downs) r.dispose();
    for (const r of ups) if (r) r.dispose();
    rtScene = null;
    downs.length = 0;
    ups.length = 0;
  };

  const applyTheme = (): void => {
    Object.assign(T, THEMES[theme]);
    compMat.uniforms.uExposure.value = T.exposure;
    compMat.uniforms.uGlowOnMetal.value = T.glowOnMetal;
    (compMat.uniforms.uGlowTint.value as THREE.Vector3).set(T.glowTint[0], T.glowTint[1], T.glowTint[2]);
    downMat.uniforms.uThreshold.value = T.threshold;
    downMat.uniforms.uMaxBr.value = T.glowMax;
    matUniforms.uWallGain.value = T.wallGain;
    (starMat.uniforms.uCore.value as THREE.Vector3).set(T.core[0], T.core[1], T.core[2]);
    (starMat.uniforms.uRay.value as THREE.Vector3).set(T.ray[0], T.ray[1], T.ray[2]);
    starMat.uniforms.uGain.value = T.starGain;
    starMat.uniforms.uInk.value = T.starInk;
    starMat.uniforms.uW.value = look.star.w * dprNow;
    starMat.uniforms.uCoreR.value = look.star.core * starPx;
    starMat.uniforms.uGlowR.value = look.star.glow * starPx;
  };
  applyTheme();

  const pass = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCam);
  };

  const wp = new THREE.Vector3();
  const wn = new THREE.Vector3();
  const order = new Int32Array(MAX_STARS);
  const updateStars = (u: number): void => {
    pivot.updateMatrixWorld(true);
    order.fill(-1);
    for (let k = 0; k < cues.length; k++) {
      let dt = u - cues[k].u;
      if (dt > tt.cycle / 2) dt -= tt.cycle;
      if (dt < -tt.cycle / 2) dt += tt.cycle;
      level[k] = dt < -0.35 || dt > 1.2 ? 0 : starEnvelope(dt, cues[k].decay) * cues[k].gain;
      if (level[k] < 0.003) continue;
      for (let s = 0; s < MAX_STARS; s++) {
        if (order[s] < 0 || level[k] > level[order[s]]) {
          for (let m = MAX_STARS - 1; m > s; m--) order[m] = order[m - 1];
          order[s] = k;
          break;
        }
      }
    }
    const A = aA.array as Float32Array, B = aB.array as Float32Array;
    for (let s = 0; s < MAX_STARS; s++) {
      const k = order[s];
      A[s * 4 + 3] = 0;
      if (k < 0) continue;
      const cue = cues[k];
      wp.set(cue.x, cue.y, cue.side * (halfDepth + 0.006)).applyMatrix4(pivot.matrixWorld);
      wn.set(0, 0, cue.side).transformDirection(pivot.matrixWorld);
      const vx = camera.position.x - wp.x, vy = camera.position.y - wp.y, vz = camera.position.z - wp.z;
      const facing = (wn.x * vx + wn.y * vy + wn.z * vz) / Math.hypot(vx, vy, vz);
      const fw = smooth((facing - cue.facing) / cue.ramp);
      if (fw <= 0) continue;
      wp.project(camera);
      // rays never reach past the canvas edge
      const sx = (wp.x * 0.5 + 0.5) * W, sy = (wp.y * 0.5 + 0.5) * H;
      const room = Math.min(sx, W - sx, sy, H - sy) * 0.9;
      const len = Math.min(look.star.len * cue.len * starPx, room);
      if (len < 2 * dprNow) continue;
      let dt = u - cue.u;
      if (dt > tt.cycle / 2) dt -= tt.cycle;
      if (dt < -tt.cycle / 2) dt += tt.cycle;
      A[s * 4] = wp.x;
      A[s * 4 + 1] = wp.y;
      A[s * 4 + 2] = wp.z;
      A[s * 4 + 3] = smooth(Math.min(1, level[k] * fw));
      B[s * 4] = cue.rot + dt * 0.5; // a slow quarter-turn over its life
      B[s * 4 + 1] = len;
      B[s * 4 + 2] = Math.min(1, len / (look.star.len * cue.len * starPx));
    }
    aA.needsUpdate = true;
    aB.needsUpdate = true;
  };

  let built = false;
  let sized = false;
  let lastW = 0, lastH = 0, lastDpr = 0;

  const api: HdMarkScene = {
    ready: Promise.resolve(),
    resize(cssW: number, cssH: number, dpr: number): void {
      if (!alive()) return;
      if (sized && Math.abs(cssW - lastW) < 0.05 && Math.abs(cssH - lastH) < 0.05 && dpr === lastDpr) return;
      lastW = cssW;
      lastH = cssH;
      lastDpr = dpr;
      dprNow = Math.max(0.5, dpr);
      starPx = dprNow * Math.min(1.3, Math.max(0.6, (markFill * cssH) / look.star.ref));
      renderer.setPixelRatio(dprNow);
      renderer.setSize(Math.max(1, cssW), Math.max(1, cssH), false);
      camera.aspect = cssW / Math.max(1, cssH);
      fit();
      W = Math.max(1, canvas.width);
      H = Math.max(1, canvas.height);
      // small marks always render 2x supersampled; the hero only on 1x screens
      ss = small || dprNow < 1.5 ? 2 : 1;
      disposeTargets();
      const hf = { type: THREE.HalfFloatType, depthBuffer: false } as const;
      const SW = W * ss, SH = H * ss;
      rtScene = new THREE.WebGLRenderTarget(SW, SH, {
        type: THREE.HalfFloatType, samples: caps.samples, depthBuffer: true, depthTexture: new THREE.DepthTexture(SW, SH),
      });
      // glow chain, sized in CSS px so the halo is the same at every pixel
      // ratio: down level i (1-based) is 2^i scene texels, (2^i / (ss * dpr))
      // CSS px. Start at the level nearest 1 CSS px and keep bloomLevels of them.
      const first = Math.max(1, Math.round(Math.log2(ss * dprNow)));
      const nDown = first + look.bloomLevels - 1;
      for (let i = 1; i <= nDown; i++) downs.push(new THREE.WebGLRenderTarget(Math.max(1, SW >> i), Math.max(1, SH >> i), hf));
      const top = first - 1; // index in downs of the finest glow level
      for (let i = nDown - 2; i >= top; i--) ups[i] = new THREE.WebGLRenderTarget(downs[i].width, downs[i].height, hf);
      glowSrc = (ups[top] ?? downs[top]).texture;
      (starMat.uniforms.uRes.value as THREE.Vector2).set(W, H);
      applyTheme();
      sized = true;
    },
    render(t: number): void {
      if (!built || !rtScene || !alive()) return;
      const u = phaseOf(tt, t);
      pivot.rotation.set(TILT, yawOf(tt, u), 0);
      // the light band, late in the dwell
      const band = matUniforms.uBand.value as THREE.Vector4;
      if (u > bandU0 && u < bandU1) {
        const q = (u - bandU0) / (bandU1 - bandU0);
        band.x = bandFrom + (bandTo - bandFrom) * q;
        band.z = look.band.I * smooth(q / 0.08) * smooth((1 - q) / 0.08);
      } else band.z = 0;
      // the mid-turn flash (hero, dark): a sheen sweeps the crowns as the face,
      // then the back, passes the big softbox, and the halo swells
      const f1 = (u - flashF) / FLASH_SIGMA, f2 = (u - flashB) / FLASH_SIGMA;
      const e1 = Math.exp(-f1 * f1), e2 = Math.exp(-f2 * f2);
      const flash = matUniforms.uFlash.value as THREE.Vector4;
      flash.x = small ? 0 : T.flash * e1;
      flash.y = small ? 0 : T.flash * 0.8 * e2;
      // the softbox's reflection crosses the face from the H to the D, and the
      // mirrored back the other way (in object space)
      flash.z = flashMid + (e1 > e2 ? f1 : -f2) * flashHalf;
      const swell = small ? 0 : T.swell * (e1 + 0.75 * e2);
      compMat.uniforms.uGlow.value = T.glow * (small ? 0.5 : 1) * (1 + swell);

      // 1. the metal, into the MSAA half-float target (with depth for the stars)
      renderer.setRenderTarget(rtScene);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      // 2. glow
      let src: THREE.Texture = rtScene.texture;
      let sw = rtScene.width, sh = rtScene.height;
      for (let i = 0; i < downs.length; i++) {
        downMat.uniforms.tSrc.value = src;
        (downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
        downMat.uniforms.uPrefilter.value = i === 0 ? 1 : 0;
        pass(downMat, downs[i]);
        src = downs[i].texture;
        sw = downs[i].width;
        sh = downs[i].height;
      }
      for (let i = downs.length - 2; i >= 0; i--) {
        const target = ups[i];
        if (!target) break;
        const coarse = ups[i + 1] ?? downs[i + 1];
        upMat.uniforms.tCoarse.value = coarse.texture;
        upMat.uniforms.tFine.value = downs[i].texture;
        (upMat.uniforms.uTexel.value as THREE.Vector2).set(1 / coarse.width, 1 / coarse.height);
        pass(upMat, target);
      }
      // 3. tone map, grade and composite to the canvas, premultiplied
      compMat.uniforms.tScene.value = rtScene.texture;
      compMat.uniforms.tBloom.value = glowSrc;
      pass(compMat, null);
      // 4. stars on top, hidden where metal is in front of them
      updateStars(u);
      starMat.uniforms.uDepth.value = rtScene.depthTexture;
      renderer.setRenderTarget(null);
      renderer.render(starScene, postCam);
    },
    setTheme(next: HdTheme): void {
      theme = next === "light" ? "light" : "dark";
      applyTheme();
    },
    isTurning(t: number): boolean {
      return phaseOf(tt, t) >= tt.dwell;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      built = false;
      canvas.removeEventListener("webglcontextlost", onLost);
      // nothing here waits on the GPU: ready's own steps stop at their next
      // check, and no browser-side compile poll is left running
      disposeTargets();
      geo.dispose();
      mat.dispose();
      if (fieldTex) fieldTex.dispose();
      if (envPM) envPM.dispose();
      if (envRT) envRT.dispose();
      if (pmrem) pmrem.dispose();
      tri.dispose();
      downMat.dispose();
      upMat.dispose();
      compMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      renderer.dispose(); // also drops three's context-loss listener, so no console line
      // a context that is already lost has nothing to release (and three would
      // warn that the lose-context extension is missing)
      if (!gl.isContextLost()) renderer.forceContextLoss();
    },
  };

  /** Size from the canvas's layout box, or from the mark's nominal size when it has none yet. */
  const sizeToDefault = (): void => {
    const r = canvas.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (!(w > 0 && h > 0)) {
      const letters = small ? 30 : 112;
      h = letters / markFill;
      w = h - letters + (letters * HD_WIDTH) / HD_HEIGHT;
    }
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    api.resize(w, h, dpr);
  };

  /** Wait for every program to link, without three's poll (which never ends once the context is lost). */
  const linkAll = async (): Promise<void> => {
    const progs = renderer.info.programs ?? [];
    if (parallel) {
      for (;;) {
        if (!alive()) return;
        let done = true;
        for (const p of progs) {
          if (gl.getProgramParameter(p.program as WebGLProgram, COMPLETION_STATUS_KHR) !== true) {
            done = false;
            break;
          }
        }
        if (done) break;
        await sleep(8);
      }
      sliceStart = performance.now();
    }
    // without the extension this is where each link actually happens: one
    // program per slice, so no single task carries all of them
    for (const p of progs) {
      if (!alive()) return;
      if (gl.getProgramParameter(p.program as WebGLProgram, gl.LINK_STATUS) !== true) {
        if (!alive()) return;
        throw new Error("HD mark: a shader failed to link");
      }
      await pause();
    }
  };

  const build = async (): Promise<void> => {
    // the shared work, cached for every mark on the page
    await pause();
    if (!alive()) return;
    hdShapes();
    await pause(true); // the extrusion is one indivisible call: give it a slice of its own
    if (!alive()) return;
    const G = sharedGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(G.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(G.normal, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), G.radius);
    await pause();
    if (!alive()) return;
    const F = await sharedField(look.field, !floatLinear);
    if (!alive()) return;
    fieldTex = new THREE.DataTexture(F.data, F.W, F.H, THREE.RGBAFormat, F.half ? THREE.HalfFloatType : THREE.FloatType);
    fieldTex.minFilter = fieldTex.magFilter = THREE.LinearFilter;
    fieldTex.generateMipmaps = false;
    fieldTex.needsUpdate = true;
    matUniforms.uField.value = fieldTex;
    // object (X, Y) -> field uv: shape x = X * HD_HEIGHT + HD_WIDTH / 2, shape y = Y * HD_HEIGHT - HD_HEIGHT / 2
    (matUniforms.uFieldMap.value as THREE.Vector4).set(HD_HEIGHT / F.Wu, (HD_WIDTH / 2 - F.x0) / F.Wu, HD_HEIGHT / F.Hu, (-HD_HEIGHT / 2 - F.y0) / F.Hu);
    await pause();
    if (!alive()) return;
    const feats = outlineFeatures();

    /* the light band: a soft diagonal ("\") band that crosses the front face
       late in the dwell and leaves the mark at the D's shoulder */
    const bandDir = matUniforms.uBandDir.value as THREE.Vector2;
    bandDir.set(Math.cos(30 * D2R), Math.sin(30 * D2R));
    let sMin = 1e9, sMax = -1e9, exit = feats.outline[0];
    for (const p of feats.outline) {
      const s = p.x * bandDir.x + p.y * bandDir.y;
      if (s < sMin) sMin = s;
      if (s > sMax) { sMax = s; exit = p; }
    }
    const bw = look.band.width;
    bandFrom = sMin - 2.2 * bw;
    bandTo = sMax + 1.6 * bw;
    (matUniforms.uBand.value as THREE.Vector4).x = bandFrom;
    const bandAt = (s: number): number => bandU0 + ((s - bandFrom) / (bandTo - bandFrom)) * (bandU1 - bandU0);
    // the flash's sheen crosses the whole face within two sigma either side of its peak
    flashMid = (sMin + sMax) / 2;
    flashHalf = ((sMax - sMin) / 2 + FLASH_WIDTH) / 2;

    /* star cues */
    const ROUND_OBJ = look.round / HD_HEIGHT;
    const TILT_SWEET = 48 * D2R; // where on the round-over a star sits
    const insetFor = (half: number): number => (ROUND_OBJ * (1 - Math.sin(TILT_SWEET))) / Math.max(0.4, Math.cos(half));
    const cornerNear = (x: number, y: number): Corner => {
      let best = feats.corners[0], bd = 1e9;
      for (const c of feats.corners) {
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < bd) { bd = d; best = c; }
      }
      return best;
    };
    const onCorner = (c: Corner): { x: number; y: number } => {
      const ins = insetFor(c.half);
      return { x: c.x - Math.cos(c.ang) * ins, y: c.y - Math.sin(c.ang) * ins };
    };
    {
      // the band leaves the mark at the D's shoulder: the last outline point it touches
      const ins = insetFor(0) * (small ? 1.6 : 1);
      const sx = exit.x - exit.nx * ins, sy = exit.y - exit.ny * ins;
      const uExit = bandAt(sx * bandDir.x + sy * bandDir.y) + 0.04;
      cues.push({ u: uExit, x: sx, y: sy, side: 1, gain: 1, len: 1, rot: 0.1, facing: 0.6, ramp: 0.25, decay: 0.3 });
      if (!small) {
        // the band crossing the H's top-left serif tip
        const c = onCorner(cornerNear(-0.68, 0.5));
        cues.push({ u: bandAt(c.x * bandDir.x + c.y * bandDir.y), x: c.x, y: c.y, side: 1, gain: 0.85, len: 0.8, rot: -0.12, facing: 0.6, ramp: 0.25, decay: 0.3 });
        // The face's own pass of the big softbox is carried by the sheen and
        // the halo swell alone: a star there, at full speed on a near-white H,
        // only read as a blink. The mirrored back gets one small glint on the
        // H's top-left serif (seen from behind) as the sheen rises over it,
        // where the turn has slowed for the back: rise and fade about 0.2 s
        // each, finished before the face has turned away.
        const b = onCorner(cornerNear(-0.68, 0.5));
        cues.push({ u: phaseOfYaw(tt, -220 * D2R), x: b.x, y: b.y, side: -1, gain: 0.7, len: 0.7, rot: -0.25, facing: 0.15, ramp: 0.45, decay: 0.18 });
      }
    }
    level = new Float64Array(cues.length);

    /* the studio (per context: PMREM lives on the GPU), in three slices */
    await pause(true);
    if (!alive()) return;
    envRT = new THREE.WebGLRenderTarget(look.studio.width, look.studio.width / 2, { type: THREE.HalfFloatType, depthBuffer: false });
    envRT.texture.mapping = THREE.EquirectangularReflectionMapping;
    const envMat = passMat(studioShader(look.studio), {});
    quad.material = envMat;
    renderer.setRenderTarget(envRT);
    renderer.render(postScene, postCam);
    renderer.setRenderTarget(null);
    envMat.dispose();
    await pause(true);
    if (!alive()) return;
    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    await pause(true);
    if (!alive()) return;
    envPM = pmrem.fromEquirectangular(envRT.texture);
    scene.environment = envPM.texture;
    envRT.dispose();
    envRT = null;
    pmrem.dispose();
    pmrem = null;

    /* compile and link every program the frame uses */
    await pause(true);
    if (!alive()) return;
    const compileScene = new THREE.Scene();
    // one glow level has no up chain, so the small marks never use upMat
    for (const m of look.bloomLevels > 1 ? [downMat, upMat, compMat] : [downMat, compMat]) {
      const q = new THREE.Mesh(tri, m);
      q.frustumCulled = false;
      compileScene.add(q);
    }
    compileScene.add(starMesh.clone());
    renderer.compile(scene, camera);
    renderer.compile(compileScene, postCam);
    await linkAll();
    if (!alive()) return;

    /* one frame, so targets, uploads and first-use state all exist before the fade-in */
    await pause(true);
    if (!alive()) return;
    if (!sized) sizeToDefault();
    built = true;
    api.render(0);
  };

  api.ready = build().catch((err: unknown) => {
    api.dispose();
    throw err;
  });
  return api;
}
