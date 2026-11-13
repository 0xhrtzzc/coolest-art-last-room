// make.fun "Make the coolest art" (coolest-art-01) entry.
// One image, drawn deterministically with the Node standard library alone:
// a door standing open in empty space, and a small cat on the threshold whose
// backlit shadow is far bigger than the cat. No network, no dependencies,
// no randomness outside the fixed seeds below.
//
// Run it locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZE = 1024;
const SS = 2;
const W = SIZE * SS;
const H = SIZE * SS;
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/* ------------------------------------------------------------------ *
 * Deterministic noise
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x5eed1ce7);

function hash2(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function fbm(x, y, octaves) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(fx, fy);
    norm += amp;
    amp *= 0.5;
    fx = fx * 2.03 + 11.7;
    fy = fy * 2.01 - 7.3;
  }
  return sum / norm;
}

/* ------------------------------------------------------------------ *
 * Distances and coverage
 * ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function sdBox(px, py, hx, hy) {
  const dx = Math.abs(px) - hx;
  const dy = Math.abs(py) - hy;
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0);
}

function sdCircle(px, py, r) {
  return Math.hypot(px, py) - r;
}

function sdRoundRect(px, py, hx, hy, r) {
  return sdBox(px, py, hx - r, hy - r) - r;
}

function sdSegment(px, py, ax, ay, bx, by, r) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d = Math.min(
    sdSegment(px, py, ax, ay, bx, by, 0),
    sdSegment(px, py, bx, by, cx, cy, 0),
    sdSegment(px, py, cx, cy, ax, ay, 0)
  );
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  return inside ? -d : d;
}

function sdConvex(px, py, pts) {
  let worst = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    worst = Math.max(worst, ((px - a[0]) * ey - (py - a[1]) * ex) / len);
  }
  return worst;
}

function cover(d, soft) {
  return clamp(0.5 - d / soft, 0, 1);
}

/* ------------------------------------------------------------------ *
 * The composition
 * ------------------------------------------------------------------ */

const HORIZON = 552;
const OPEN_L = 372;
const OPEN_R = 616;
const OPEN_T = 234;
const OPEN_B = 756;
const FRAME = 24;
const LEAF_FREE_X = 524;
const LEAF_FREE_T = 232;
const LEAF_FREE_B = 772;

const CAT_X = 502;
const CAT_BASE = 886;
const CAT_SCALE = 1.1;

// Where the gap meets the floor, seen from the viewer: the shadow is the same
// silhouette, thrown from that point, so it starts at the cat's feet and runs
// away from the light, stretched by the ground it lies on.
const LIGHT_X = 448;
const LIGHT_Y = 700;
const SHADOW_SX = 2.3;
const SHADOW_SY = 1.5;

// A cat standing in profile, facing the light, built from parts: a body, a head with
// two ears, four legs and a tail carried up. Local space: x right, y down, y = 0 on the
// ground, the ear tips and the tail about 108 units up.
function catSdf(lx, ly) {
  let d = sdRoundRect(lx - 8, ly + 52, 34, 16, 15);          // body
  d = Math.min(d, sdRoundRect(lx + 18, ly + 56, 14, 15, 12)); // shoulders
  d = Math.min(d, sdCircle(lx + 40, ly + 76, 15));            // head
  d = Math.min(d, sdCircle(lx + 53, ly + 74, 6));             // muzzle
  d = Math.min(d, sdTriangle(lx, ly, -46, -88, -38, -109, -32, -86)); // near ear
  d = Math.min(d, sdTriangle(lx, ly, -36, -88, -28, -109, -22, -86)); // far ear
  d = Math.min(d, sdSegment(lx, ly, -24, -46, -24, -8, 5));   // near foreleg
  d = Math.min(d, sdSegment(lx, ly, -10, -46, -10, -8, 5));   // far foreleg
  d = Math.min(d, sdSegment(lx, ly, 30, -44, 32, -8, 6));     // near hindleg
  d = Math.min(d, sdSegment(lx, ly, 16, -44, 18, -8, 5));     // far hindleg
  d = Math.min(d, sdRoundRect(lx + 26, ly + 3, 5, 4, 3));     // forepaws
  d = Math.min(d, sdRoundRect(lx + 12, ly + 3, 5, 4, 3));
  d = Math.min(d, sdRoundRect(lx + 31, ly + 3, 6, 4, 3));     // hind paws
  d = Math.min(d, sdRoundRect(lx + 17, ly + 3, 5, 4, 3));
  d = Math.min(d, sdSegment(lx, ly, 44, -50, 56, -60, 5));    // tail, carried up
  d = Math.min(d, sdSegment(lx, ly, 56, -60, 63, -78, 5));
  d = Math.min(d, sdSegment(lx, ly, 63, -78, 60, -96, 5));
  d = Math.min(d, sdSegment(lx, ly, 60, -96, 51, -104, 5));
  return d;
}

function catDistance(px, py) {
  return catSdf((px - CAT_X) / CAT_SCALE + 6, (py - CAT_BASE) / CAT_SCALE) * CAT_SCALE;
}

function beastDistance(px, py) {
  const qx = LIGHT_X + (px - LIGHT_X) / SHADOW_SX;
  const qy = LIGHT_Y + (py - LIGHT_Y) / SHADOW_SY;
  return catDistance(qx, qy) * ((SHADOW_SX + SHADOW_SY) * 0.5);
}

/* ------------------------------------------------------------------ *
 * Precomputed layers: nebula (half res), stars and dust
 * ------------------------------------------------------------------ */

const NEB_W = SIZE / 2;
const nebula = new Float32Array(NEB_W * NEB_W);
for (let y = 0; y < NEB_W; y++) {
  for (let x = 0; x < NEB_W; x++) {
    const a = fbm(x / 150, y / 150, 5);
    const b = fbm((x + 480) / 62, (y - 260) / 62, 4);
    // a slow band of light across the sky, so it is not the same everywhere
    const band = Math.exp(-Math.pow((y - (18 + 0.46 * x)) / 66, 2));
    nebula[y * NEB_W + x] =
      Math.max(0, a - 0.5) * 1.7 + Math.max(0, b - 0.66) * 0.5 + band * (0.30 + 0.70 * a) * 1.25;
  }
}

function nebulaAt(x, y) {
  const fx = clamp(x / 2, 0, NEB_W - 1.001);
  const fy = clamp(y / 2, 0, NEB_W - 1.001);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const i = iy * NEB_W + ix;
  const a = nebula[i];
  const b = nebula[i + 1];
  const c = nebula[i + NEB_W];
  const d = nebula[i + NEB_W + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

const stars = [];
for (let i = 0; i < 620; i++) {
  const r = 0.7 + Math.pow(rnd(), 2.6) * 2.1;
  stars.push({
    x: rnd() * W,
    y: Math.pow(rnd(), 0.72) * HORIZON * SS,
    r,
    b: 0.10 + Math.pow(rnd(), 2.4) * 1.05,
    tint: rnd(),
    flare: rnd() < 0.035
  });
}

// Dust drifting in the shaft of light: a fan opening out of the doorway, toward the viewer.
const motes = [];
for (let i = 0; i < 170; i++) {
  const t = Math.pow(rnd(), 0.5);
  const x = (OPEN_L + LEAF_FREE_X) / 2 + (rnd() - 0.4) * (60 + t * 620);
  const y = 660 + t * 340 + (rnd() - 0.5) * 80;
  if (x < 90 || x > 950 || y > 1006) continue;
  motes.push({ x: x * SS, y: y * SS, r: 0.8 + rnd() * 2.4, b: 0.15 + rnd() * 0.7 });
}

/* ------------------------------------------------------------------ *
 * Shading
 * ------------------------------------------------------------------ */

function shadeFloor(x, y, out) {
  const d = y - HORIZON;
  const fade = Math.exp(-d / 340);
  out[0] = 0.021 + 0.014 * fade;
  out[1] = 0.020 + 0.015 * fade;
  out[2] = 0.031 + 0.027 * fade;

  // haze gathered along the horizon, where the floor runs out of sight
  const haze = Math.exp(-d / 46) * 0.30;
  out[0] += haze * 0.16;
  out[1] += haze * 0.20;
  out[2] += haze * 0.34;

  // perspective lines running away to the vanishing point
  const persp = 300 / (d + 6);
  const vx = (x - 500) * persp;
  const a = Math.abs(((vx * 0.30) % 1) - 0.5) * 2;
  const b = Math.abs(((Math.log(d + 8) * 1.05) % 1) - 0.5) * 2;
  const g = (Math.max(0, 1 - a * 7) + Math.max(0, 1 - b * 11) * 0.7) * clamp(1 - d / 430, 0, 1) * 0.9;
  out[0] += g * 0.022;
  out[1] += g * 0.030;
  out[2] += g * 0.050;

  // the pool of light thrown forward out of the gap
  const apexX = (OPEN_L + LEAF_FREE_X) / 2;
  const dy = y - (OPEN_B - 10);
  if (dy > 0) {
    const t = clamp(dy / 300, 0, 1);
    const halfW = 34 + 900 * Math.pow(t, 1.08);
    const arm = 1 - clamp(Math.abs(x - (apexX + 150 * t)) / halfW, 0, 1);
    const s = Math.pow(arm, 1.8) * Math.exp(-t * 1.35) * 2.5;
    const along = clamp((x - OPEN_L + 40) / 260, 0, 1);
    out[0] += s * (0.62 + 0.42 * along);
    out[1] += s * (0.40 + 0.30 * along);
    out[2] += s * (0.20 + 0.14 * along);
    // the hot streak the two edges of the gap throw closest to the threshold
    const streak = Math.exp(-Math.abs(x - apexX) / 62) * Math.exp(-t * 4.4) * 1.5;
    out[0] += streak * 0.95;
    out[1] += streak * 0.66;
    out[2] += streak * 0.30;
  }

  // a little grit on the ground so the light has something to fall across
  const grit = (nebulaAt(x * 0.42 + 160, y * 0.42 + 190) - 0.06) * 0.5;
  out[0] *= 1 + grit;
  out[1] *= 1 + grit;
  out[2] *= 1 + grit * 0.9;

  // the shadow, cast into that light, softest far from its source
  const bd = beastDistance(x, y);
  if (bd < 40) {
    const reach = clamp(Math.hypot(x - LIGHT_X, y - LIGHT_Y) / 700, 0, 1);
    const a2 = cover(bd, 4 + 8 * reach);
    if (a2 > 0) {
      const k = 1 - a2 * (0.92 - 0.24 * reach);
      out[0] *= k;
      out[1] *= k * 0.995;
      out[2] *= k * 0.98;
    }
  }
}

function shadeDoor(x, y, out, cov) {
  const midY = (OPEN_T + OPEN_B) / 2;
  const halfY = (OPEN_B - OPEN_T) / 2 + FRAME;
  const jambL = sdBox(x - (OPEN_L - FRAME / 2), y - midY, FRAME / 2, halfY);
  const jambR = sdBox(x - (OPEN_R + FRAME / 2), y - midY, FRAME / 2, halfY);
  const lintel = sdBox(x - 494, y - (OPEN_T - FRAME / 2), (OPEN_R - OPEN_L) / 2 + FRAME, FRAME / 2);
  const sill = sdBox(x - 494, y - (OPEN_B + FRAME / 2), (OPEN_R - OPEN_L) / 2 + FRAME, FRAME / 2);
  const frame = Math.min(Math.min(jambL, jambR), Math.min(lintel, sill));
  const leaf = sdConvex(x, y, [
    [OPEN_R, OPEN_T],
    [OPEN_R, OPEN_B],
    [LEAF_FREE_X, LEAF_FREE_B],
    [LEAF_FREE_X, LEAF_FREE_T]
  ]);

  // the leaf first: it is nearer the viewer than the frame it hangs on
  const ba = cover(leaf, 1.3);
  if (ba > 0) {
    const d2 = clamp((x - LEAF_FREE_X) / (OPEN_R - LEAF_FREE_X), 0, 1);
    const sh = 0.052 + 0.30 * Math.pow(1 - d2, 1.6);
    out[0] = out[0] * (1 - ba) + ba * sh;
    out[1] = out[1] * (1 - ba) + ba * sh * 0.74;
    out[2] = out[2] * (1 - ba) + ba * sh * 0.57;
    const edge = clamp(1 - Math.abs(leaf) / 2.2, 0, 1);
    if (edge > 0.001) {
      out[0] += edge * ba * 1.25;
      out[1] += edge * ba * 0.86;
      out[2] += edge * ba * 0.42;
    }
    const kn = cover(sdCircle(x - (LEAF_FREE_X + 40), y - 588, 7), 1.3);
    if (kn > 0) {
      out[0] = out[0] * (1 - kn) + kn * 1.35;
      out[1] = out[1] * (1 - kn) + kn * 1.05;
      out[2] = out[2] * (1 - kn) + kn * 0.60;
    }
    cov[0] = Math.max(cov[0], ba);
  }

  const fa = cover(frame, 1.4);
  if (fa > 0) {
    const inner = clamp((x - (OPEN_L - FRAME)) / (FRAME * 1.6), 0, 1);
    const base = 0.048 + 0.030 * inner;
    out[0] = out[0] * (1 - fa) + fa * (base + 0.085 * inner * inner);
    out[1] = out[1] * (1 - fa) + fa * base;
    out[2] = out[2] * (1 - fa) + fa * base;
    cov[0] = Math.max(cov[0], fa);
  }

  // the thickness of the wall the door stands in: a shadowed reveal just inside the opening
  const inSliver2 = x > OPEN_L && x < LEAF_FREE_X && y > OPEN_T && y < OPEN_B;
  if (!inSliver2 && x > OPEN_L - 2 && x < OPEN_R + 2 && y > OPEN_T - 2 && y < OPEN_B + 2) {
    const inset = Math.min(Math.min(x - OPEN_L, OPEN_R - x), Math.min(y - OPEN_T, OPEN_B - y));
    if (inset < 16) {
      const k = 1 - 0.62 * Math.pow(1 - clamp(inset / 16, 0, 1), 1.5);
      out[0] *= k;
      out[1] *= k;
      out[2] *= k * 0.98;
    }
  }

  // contact shadow where the frame meets the ground, and a soft halo outside it
  if (frame > 0 && frame < 40) {
    const weight = 0.18 + 0.5 * clamp((y - OPEN_T) / (OPEN_B - OPEN_T), 0, 1);
    const k = 1 - (1 - clamp(frame / 40, 0, 1)) * 0.42 * weight;
    out[0] *= k;
    out[1] *= k;
    out[2] *= k * 0.99;
  }
}

const tmp = [0, 0, 0];
const covTmp = [0];

function shade(px, py, out) {
  const x = px / SS;
  const y = py / SS;

  if (y < HORIZON) {
    const t = clamp((HORIZON - y) / HORIZON, 0, 1);
    const n = nebulaAt(x, y);
    let r = 0.030 + 0.014 * (1 - t) + 0.012 * t;
    let g = 0.040 + 0.022 * (1 - t) + 0.020 * t;
    let b = 0.092 + 0.090 * (1 - t) + 0.050 * t;
    const glow = Math.exp(-Math.hypot(x - 494, y - 430) / 470);
    r += n * 0.085 * (0.55 + glow);
    g += n * 0.048 * (0.55 + glow);
    b += n * 0.145 * (0.65 + glow);
    r += glow * 0.012;
    g += glow * 0.014;
    b += glow * 0.034;
    out[0] = r;
    out[1] = g;
    out[2] = b;
  } else {
    shadeFloor(x, y, out);
  }

  // light streaming out of the gap, before anything stands in front of it
  if (y > OPEN_T - 4 && y < OPEN_B && x > OPEN_L - 6 && x < LEAF_FREE_X) {
    const ty = clamp((y - OPEN_T) / (OPEN_B - OPEN_T), 0, 1);
    const hot = 0.52 + 0.46 * Math.pow(ty, 0.8);
    const across = (x - OPEN_L) / (LEAF_FREE_X - OPEN_L);
    const soft = clamp(across / 0.10, 0, 1) * clamp((1 - across) / 0.10, 0, 1);
    const k = Math.max(0.30, soft) * (1.18 - 0.24 * Math.abs(across - 0.42));
    out[0] = Math.max(out[0], 1.78 * hot * k);
    out[1] = Math.max(out[1], 1.52 * hot * k);
    out[2] = Math.max(out[2], 1.10 * hot * k);
  }

  covTmp[0] = 0;
  if (x > OPEN_L - FRAME * 3 && x < OPEN_R + FRAME * 3 && y > OPEN_T - FRAME * 3 && y < OPEN_B + FRAME * 3) {
    shadeDoor(x, y, out, covTmp);
  }

  // the cat, backlit, standing on the threshold in the light, in front of the door
  const cd = catDistance(x, y);
  if (cd < 8) {
    const ca = cover(cd, 1.7);
    if (ca > 0) {
      const lx = (x - CAT_X) / CAT_SCALE + 6;
      const ly = (y - CAT_BASE) / CAT_SCALE;
      const left = catSdf(lx - 2.2, ly) - catSdf(lx, ly);
      const up = catSdf(lx, ly - 2.2) - catSdf(lx, ly);
      const rim = clamp(1 - Math.abs(cd) / 6.5, 0, 1) * clamp(0.55 + left * 1.1 + up * 0.5, 0, 1.6);
      out[0] = out[0] * (1 - ca) + ca * 0.035;
      out[1] = out[1] * (1 - ca) + ca * 0.030;
      out[2] = out[2] * (1 - ca) + ca * 0.042;
      out[0] += rim * 0.78;
      out[1] += rim * 0.52;
      out[2] += rim * 0.25;
      covTmp[0] = Math.max(covTmp[0], ca);
    }
  }

  // the glow the whole doorway throws on everything near it
  const gr = Math.hypot(x - (OPEN_L + LEAF_FREE_X) / 2, y - 500);
  const near = 1 / (1 + (gr / 118) * (gr / 118));
  const far = 1 / (1 + (gr / 400) * (gr / 400));
  const occl = 1 - covTmp[0];
  out[0] += (near * 0.95 + far * 0.42) * 0.50 * occl;
  out[1] += (near * 0.66 + far * 0.26) * 0.50 * occl;
  out[2] += (near * 0.31 + far * 0.12) * 0.50 * occl;

  return covTmp[0];
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

const rBuf = new Float32Array(W * H);
const gBuf = new Float32Array(W * H);
const bBuf = new Float32Array(W * H);
const cBuf = new Float32Array(W * H);

for (let py = 0; py < H; py++) {
  const y = py / SS;
  for (let px = 0; px < W; px++) {
    tmp[0] = 0;
    tmp[1] = 0;
    tmp[2] = 0;
    const cov = shade(px, py, tmp);
    const i = py * W + px;
    rBuf[i] = tmp[0];
    gBuf[i] = tmp[1];
    bBuf[i] = tmp[2];
    cBuf[i] = cov;
  }
}

// Stars, stamped in their own little neighbourhoods (and never over the doorway).
for (let s = 0; s < stars.length; s++) {
  const st = stars[s];
  if (st.y > HORIZON * SS) continue;
  const rad = (st.flare ? 11 : 3.4) * st.r * SS;
  const x0 = Math.max(0, Math.floor(st.x - rad));
  const x1 = Math.min(W - 1, Math.ceil(st.x + rad));
  const y0 = Math.max(0, Math.floor(st.y - rad));
  const y1 = Math.min(H - 1, Math.ceil(st.y + rad));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const i = py * W + px;
      if (cBuf[i] > 0.4) continue;
      const dx = px - st.x;
      const dy = py - st.y;
      const dd = Math.hypot(dx, dy);
      let a = Math.exp(-(dd * dd) / (st.r * st.r * SS * SS * 0.55)) * st.b;
      a += Math.exp(-dd / (2.4 * SS)) * st.b * 0.14;
      if (st.flare) {
        const arm = Math.exp(-Math.abs(dx) / (5.5 * SS)) * Math.exp(-Math.abs(dy) / (0.9 * SS));
        const arm2 = Math.exp(-Math.abs(dy) / (5.5 * SS)) * Math.exp(-Math.abs(dx) / (0.9 * SS));
        a += (arm + arm2) * st.b * 0.32;
      }
      if (a < 0.002) continue;
      rBuf[i] += a * (0.86 + st.tint * 0.30);
      gBuf[i] += a * 0.93;
      bBuf[i] += a * (1.12 - st.tint * 0.26);
    }
  }
}

// Dust in the beam, in front of everything.
for (let m = 0; m < motes.length; m++) {
  const mo = motes[m];
  const rad = 3.2 * mo.r * SS;
  const x0 = Math.max(0, Math.floor(mo.x - rad));
  const x1 = Math.min(W - 1, Math.ceil(mo.x + rad));
  const y0 = Math.max(0, Math.floor(mo.y - rad));
  const y1 = Math.min(H - 1, Math.ceil(mo.y + rad));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const i = py * W + px;
      const dd = Math.hypot(px - mo.x, py - mo.y);
      const a = Math.exp(-(dd * dd) / (mo.r * mo.r * SS * SS * 0.45)) * mo.b;
      if (a < 0.002) continue;
      rBuf[i] += a * 1.15;
      gBuf[i] += a * 0.86;
      bBuf[i] += a * 0.50;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Bloom, tone, dither, encode
 * ------------------------------------------------------------------ */

function boxBlur(src, dst, radius) {
  const tmpBuf = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += src[y * W + clamp(x, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      tmpBuf[y * W + x] = acc / span;
      acc += src[y * W + clamp(x + radius + 1, 0, W - 1)] - src[y * W + clamp(x - radius, 0, W - 1)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmpBuf[clamp(y, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      dst[y * W + x] = acc / span;
      acc += tmpBuf[clamp(y + radius + 1, 0, H - 1) * W + x] - tmpBuf[clamp(y - radius, 0, H - 1) * W + x];
    }
  }
}

const bright = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
const glow = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
const wide = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
const src = [rBuf, gBuf, bBuf];
for (let c = 0; c < 3; c++) {
  const s = src[c];
  const d = bright[c];
  for (let i = 0; i < W * H; i++) {
    const l = 0.2126 * rBuf[i] + 0.7152 * gBuf[i] + 0.0722 * bBuf[i];
    d[i] = l > 0.55 ? s[i] * ((l - 0.55) / l) : 0;
  }
  boxBlur(d, glow[c], 16);
  boxBlur(glow[c], wide[c], 52);
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];
const px3 = Buffer.alloc(SIZE * SIZE * 3);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const o = (y * SIZE + x) * 3;
    const dither = (BAYER[y & 3][x & 3] / 16 - 0.469) / 128;
    const vig = 1 - 0.32 * Math.pow(Math.hypot((x - SIZE / 2) / (SIZE / 2), (y - SIZE / 2) / (SIZE / 2)) / 1.414, 2.2);
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = (y * SS + sy) * W + (x * SS + sx);
          v += src[c][i] + glow[c][i] * 0.70 + wide[c][i] * 0.95;
        }
      }
      v /= SS * SS;
      v = 1 - Math.exp(-v * 1.20);
      px3[o + c] = clamp(v * vig + dither, 0, 1) * 255;
    }
  }
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 3 + 1)] = 0;
  px3.copy(raw, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'entry.png'), png);
console.log(`entry.png ${png.length} bytes`);
