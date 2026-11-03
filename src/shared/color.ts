/**
 * Color math shared by the backend (authoritative verification) and the mobile app
 * (UX-only pre-check).
 *
 * Pipeline: sRGB -> linear RGB -> XYZ (D65) -> CIELAB, CIEDE2000 distance, seeded k-means
 * for the dominant colour and the documented closeness mapping.
 */

export type Lab = readonly [number, number, number];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** D65 reference white. */
const WHITE = { x: 0.95047, y: 1.0, z: 1.08883 } as const;
const EPSILON = 216 / 24389; // (6/29)^3
const KAPPA_INV = 1 / (3 * (6 / 29) ** 2);

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Parses `#rrggbb` (the leading `#` is optional). Throws on invalid input. */
export function hexToRgb(hex: string): Rgb {
  const match = HEX_RE.exec(hex.trim());
  if (!match || !match[1]) throw new Error(`Invalid hex color: ${hex}`);
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (n: number): string =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : t * KAPPA_INV + 4 / 29;
}

/** sRGB (0-255 channels) to CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;
  const fx = labF(x / WHITE.x);
  const fy = labF(y / WHITE.y);
  const fz = labF(z / WHITE.z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): Lab {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

/** CIELAB (D65) back to sRGB, clamped to the gamut. Used to render cluster centroids. */
export function labToRgb([l, a, b]: Lab): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (f: number): number => (f ** 3 > EPSILON ? f ** 3 : (f - 4 / 29) / KAPPA_INV);
  const x = inv(fx) * WHITE.x;
  const y = inv(fy) * WHITE.y;
  const z = inv(fz) * WHITE.z;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const gamma = (c: number): number => {
    const v = Math.max(0, Math.min(1, c));
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  };
  return { r: gamma(lr), g: gamma(lg), b: gamma(lb) };
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (radians: number): number => (radians * 180) / Math.PI;

/** CIEDE2000 colour difference (Sharma, Wu, Dalal 2005 reference formulation). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2));

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else {
    hBarP = (h1p + h2p + (h1p + h2p < 360 ? 360 : -360)) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63));
  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;
  const rT = -Math.sin(rad(2 * dTheta)) * rC;

  const termL = dLp / sL;
  const termC = dCp / sC;
  const termH = dHp / sH;
  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rT * termC * termH);
}

/** Deltas at or below this value are a perfect (100) match. */
export const CLOSENESS_FULL_DELTA_E = 5;
/** Width of the linear ramp between 100 and 0 points. Zero points at ΔE = 40. */
export const CLOSENESS_RAMP = 35;

/**
 * Maps a ΔE2000 distance to a 0-100 closeness score:
 * `clamp(100 * (1 - (ΔE - 5) / 35), 0, 100)`.
 * ΔE <= 5 -> 100, ΔE >= 40 -> 0, linear in between. A default threshold of 55 therefore
 * accepts ΔE up to roughly 20.75.
 */
export function closenessFromDeltaE(deltaE: number): number {
  const raw = 100 * (1 - (deltaE - CLOSENESS_FULL_DELTA_E) / CLOSENESS_RAMP);
  return Math.max(0, Math.min(100, raw));
}

/** Small, fast, seedable PRNG (mulberry32) so k-means is deterministic in tests. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Cluster {
  center: Lab;
  /** Sum of the weights of the member points. */
  weight: number;
}

export interface KMeansOptions {
  k?: number;
  maxIterations?: number;
  seed?: number;
}

/**
 * Weighted k-means in CIELAB with seeded k-means++ initialisation.
 * `points` is a flat [L, a, b, L, a, b, ...] array; `weights` has one entry per point.
 * Returns the clusters sorted by descending weight.
 */
export function kMeansLab(
  points: Float64Array,
  weights: Float64Array,
  { k = 4, maxIterations = 20, seed = 1 }: KMeansOptions = {},
): Cluster[] {
  const n = points.length / 3;
  if (n === 0) return [];
  const rng = createRng(seed);
  const kk = Math.min(k, n);
  const centers = initCenters(points, weights, kk, rng);
  const assignment = new Int32Array(n).fill(-1);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const best = nearestCenter(points, i, centers);
      if (best !== assignment[i]) {
        assignment[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
    recomputeCenters(points, weights, assignment, centers);
  }

  const sums = new Float64Array(kk);
  for (let i = 0; i < n; i++) sums[assignment[i] as number] = (sums[assignment[i] as number] ?? 0) + (weights[i] ?? 0);
  const clusters: Cluster[] = [];
  for (let c = 0; c < kk; c++) {
    const weight = sums[c] ?? 0;
    if (weight > 0) {
      clusters.push({ center: [centers[c * 3] ?? 0, centers[c * 3 + 1] ?? 0, centers[c * 3 + 2] ?? 0], weight });
    }
  }
  return clusters.sort((a, b) => b.weight - a.weight);
}

function distSq(points: Float64Array, i: number, centers: Float64Array, c: number): number {
  const dl = (points[i * 3] ?? 0) - (centers[c * 3] ?? 0);
  const da = (points[i * 3 + 1] ?? 0) - (centers[c * 3 + 1] ?? 0);
  const db = (points[i * 3 + 2] ?? 0) - (centers[c * 3 + 2] ?? 0);
  return dl * dl + da * da + db * db;
}

function nearestCenter(points: Float64Array, i: number, centers: Float64Array): number {
  let best = 0;
  let bestDist = Infinity;
  for (let c = 0; c < centers.length / 3; c++) {
    const d = distSq(points, i, centers, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function pickWeighted(weights: Float64Array, rng: () => number): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i] ?? 0;
  let target = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i] ?? 0;
    if (target <= 0) return i;
  }
  return weights.length - 1;
}

function initCenters(points: Float64Array, weights: Float64Array, k: number, rng: () => number): Float64Array {
  const n = points.length / 3;
  const centers = new Float64Array(k * 3);
  const setCenter = (c: number, i: number): void => {
    centers[c * 3] = points[i * 3] ?? 0;
    centers[c * 3 + 1] = points[i * 3 + 1] ?? 0;
    centers[c * 3 + 2] = points[i * 3 + 2] ?? 0;
  };
  setCenter(0, pickWeighted(weights, rng));
  const scores = new Float64Array(n);
  for (let c = 1; c < k; c++) {
    for (let i = 0; i < n; i++) {
      let min = Infinity;
      for (let j = 0; j < c; j++) min = Math.min(min, distSq(points, i, centers, j));
      scores[i] = min * (weights[i] ?? 0);
    }
    setCenter(c, pickWeighted(scores, rng));
  }
  return centers;
}

function recomputeCenters(
  points: Float64Array,
  weights: Float64Array,
  assignment: Int32Array,
  centers: Float64Array,
): void {
  const k = centers.length / 3;
  const sums = new Float64Array(k * 3);
  const totals = new Float64Array(k);
  for (let i = 0; i < assignment.length; i++) {
    const c = assignment[i] as number;
    const w = weights[i] ?? 0;
    totals[c] = (totals[c] ?? 0) + w;
    for (let d = 0; d < 3; d++) sums[c * 3 + d] = (sums[c * 3 + d] ?? 0) + (points[i * 3 + d] ?? 0) * w;
  }
  for (let c = 0; c < k; c++) {
    const total = totals[c] ?? 0;
    if (total > 0) for (let d = 0; d < 3; d++) centers[c * 3 + d] = (sums[c * 3 + d] ?? 0) / total;
  }
}

/**
 * Radial weights for a width x height pixel grid: 1.0 in the centre, ~0.002 in the corners (sigma 0.2 of the frame).
 * The photo subject is expected near the centre, the background near the edges.
 */
export function centerWeights(width: number, height: number): Float64Array {
  const weights = new Float64Array(width * height);
  const sigma = 0.2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5) / width - 0.5;
      const dy = (y + 0.5) / height - 0.5;
      weights[y * width + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  return weights;
}

export interface DominantColorOptions extends KMeansOptions {
  /** Weight pixels by distance from the image centre (default true). */
  centerWeighted?: boolean;
  /**
   * Ignore near-black (L < 10) and near-white (L > 95) pixels, which carry no hue.
   * Skipped automatically when fewer than 5% of the pixels remain.
   */
  excludeExtremes?: boolean;
}

export interface DominantColor {
  lab: Lab;
  hex: string;
  /** Share (0-1) of the weighted pixels that belong to the dominant cluster. */
  share: number;
}

/**
 * Dominant colour of an interleaved RGB (3 bytes per pixel) buffer.
 * The dominant colour is the centroid of the heaviest k-means cluster.
 */
export function dominantColor(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  options: DominantColorOptions = {},
): DominantColor {
  const { centerWeighted = true, excludeExtremes = false, ...kmeans } = options;
  const total = width * height;
  if (rgb.length < total * 3) throw new Error('Pixel buffer is smaller than width * height * 3');
  const base = centerWeighted ? centerWeights(width, height) : new Float64Array(total).fill(1);

  const all = new Float64Array(total * 3);
  const keep: boolean[] = new Array<boolean>(total);
  let kept = 0;
  for (let i = 0; i < total; i++) {
    const [l, a, b] = rgbToLab(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
    all[i * 3] = l;
    all[i * 3 + 1] = a;
    all[i * 3 + 2] = b;
    keep[i] = !excludeExtremes || (l >= 10 && l <= 95);
    if (keep[i]) kept++;
  }
  const useFilter = excludeExtremes && kept >= total * 0.05;
  const points = new Float64Array((useFilter ? kept : total) * 3);
  const weights = new Float64Array(useFilter ? kept : total);
  let out = 0;
  for (let i = 0; i < total; i++) {
    if (useFilter && !keep[i]) continue;
    points.set([all[i * 3] ?? 0, all[i * 3 + 1] ?? 0, all[i * 3 + 2] ?? 0], out * 3);
    weights[out] = base[i] ?? 0;
    out++;
  }

  const clusters = kMeansLab(points, weights, kmeans);
  const top = clusters[0];
  if (!top) throw new Error('Cannot compute dominant colour of an empty image');
  const sum = clusters.reduce((acc, c) => acc + c.weight, 0);
  return { lab: top.center, hex: rgbToHex(labToRgb(top.center)), share: top.weight / sum };
}

export interface ColorEvaluation {
  dominantHex: string;
  deltaE: number;
  closeness: number;
  /** Share (0-1) of the weighted pixels covered by the dominant cluster. */
  dominanceShare: number;
}

/**
 * Compares a photo with the assigned colour. Near-black/white pixels are excluded from the
 * clustering only for chromatic targets (chroma >= 15), so black and white palette entries
 * remain reachable.
 */
export function evaluateColorMatch(
  rgb: ArrayLike<number>,
  width: number,
  height: number,
  targetHex: string,
  options: DominantColorOptions = {},
): ColorEvaluation {
  const target = hexToLab(targetHex);
  const chromatic = Math.hypot(target[1], target[2]) >= 15;
  const dominant = dominantColor(rgb, width, height, {
    k: 4,
    maxIterations: 20,
    excludeExtremes: chromatic,
    ...options,
  });
  const deltaE = deltaE2000(dominant.lab, target);
  return {
    dominantHex: dominant.hex,
    deltaE,
    closeness: closenessFromDeltaE(deltaE),
    dominanceShare: dominant.share,
  };
}
