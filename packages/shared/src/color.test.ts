import { describe, expect, it } from 'vitest';
import {
  centerWeights,
  closenessFromDeltaE,
  deltaE2000,
  dominantColor,
  evaluateColorMatch,
  hexToLab,
  hexToRgb,
  kMeansLab,
  labToRgb,
  rgbToHex,
  rgbToLab,
  type Lab,
} from './color';

/** Reference pairs from Sharma, Wu, Dalal (2005), "The CIEDE2000 Color-Difference Formula". */
const SHARMA: Array<[Lab, Lab, number]> = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

describe('hex / rgb conversion', () => {
  it('parses and formats hex colours', () => {
    expect(hexToRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
  });

  it('rejects malformed hex values', () => {
    expect(() => hexToRgb('#12345')).toThrow();
    expect(() => hexToRgb('zzzzzz')).toThrow();
  });
});

describe('sRGB -> CIELAB', () => {
  it('maps white and black to the expected lightness', () => {
    const white = rgbToLab(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1])).toBeLessThan(0.1);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });

  it('matches known values for pure red', () => {
    const [l, a, b] = hexToLab('#ff0000');
    expect(l).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
  });

  it('round-trips through labToRgb', () => {
    for (const hex of ['#336699', '#e8c547', '#0a0a0a', '#f4f4f4']) {
      expect(rgbToHex(labToRgb(hexToLab(hex)))).toBe(hex);
    }
  });
});

describe('deltaE2000', () => {
  it.each(SHARMA)('matches the Sharma reference pair %#', (lab1, lab2, expected) => {
    expect(deltaE2000(lab1, lab2)).toBeCloseTo(expected, 3);
    expect(deltaE2000(lab2, lab1)).toBeCloseTo(expected, 3);
  });

  it('is zero for identical colours', () => {
    expect(deltaE2000([40, 10, -20], [40, 10, -20])).toBe(0);
  });
});

describe('closenessFromDeltaE', () => {
  it('maps the documented anchor points', () => {
    expect(closenessFromDeltaE(0)).toBe(100);
    expect(closenessFromDeltaE(5)).toBe(100);
    expect(closenessFromDeltaE(22.5)).toBeCloseTo(50, 5);
    expect(closenessFromDeltaE(40)).toBe(0);
    expect(closenessFromDeltaE(80)).toBe(0);
  });

  it('puts the default threshold (55) at about ΔE 20.75', () => {
    expect(closenessFromDeltaE(20.75)).toBeCloseTo(55, 5);
  });
});

function solidImage(hex: string, size = 8): Uint8Array {
  const { r, g, b } = hexToRgb(hex);
  const out = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) out.set([r, g, b], i * 3);
  return out;
}

describe('kMeansLab', () => {
  const points = new Float64Array([
    50, 0, 0, 51, 1, 0, 49, -1, 0, // cluster A
    80, 40, 40, 81, 39, 41, // cluster B
  ]);
  const weights = new Float64Array(5).fill(1);

  it('is deterministic for a given seed', () => {
    const first = kMeansLab(points, weights, { k: 2, seed: 7 });
    const second = kMeansLab(points, weights, { k: 2, seed: 7 });
    expect(second).toEqual(first);
  });

  it('separates two obvious clusters and sorts by weight', () => {
    const clusters = kMeansLab(points, weights, { k: 2, seed: 3 });
    expect(clusters).toHaveLength(2);
    expect(clusters[0]?.weight).toBe(3);
    expect(clusters[0]?.center[0]).toBeCloseTo(50, 5);
    expect(clusters[1]?.center[0]).toBeCloseTo(80.5, 5);
  });

  it('handles fewer points than clusters', () => {
    const clusters = kMeansLab(new Float64Array([10, 0, 0]), new Float64Array([1]), { k: 4 });
    expect(clusters).toHaveLength(1);
  });
});

describe('dominantColor / evaluateColorMatch', () => {
  it('returns the colour of a solid image', () => {
    expect(dominantColor(solidImage('#33aa55'), 8, 8).hex).toBe('#33aa55');
  });

  it('gives a perfect score for an exact match', () => {
    const result = evaluateColorMatch(solidImage('#cc2222'), 8, 8, '#cc2222');
    expect(result.deltaE).toBeCloseTo(0, 1);
    expect(result.closeness).toBe(100);
  });

  it('scores a different hue near zero', () => {
    const result = evaluateColorMatch(solidImage('#2244cc'), 8, 8, '#cc2222');
    expect(result.closeness).toBe(0);
  });

  it('prefers the centre subject over a larger background (centre weighting)', () => {
    const size = 16;
    const img = new Uint8Array(size * size * 3);
    const red = hexToRgb('#d02020');
    const grey = hexToRgb('#808080');
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const centre = x >= 4 && x < 12 && y >= 4 && y < 12;
        const c = centre ? red : grey;
        img.set([c.r, c.g, c.b], (y * size + x) * 3);
      }
    }
    const weighted = evaluateColorMatch(img, size, size, '#d02020', { seed: 1 });
    expect(weighted.closeness).toBeGreaterThan(90);
    const flat = evaluateColorMatch(img, size, size, '#d02020', { seed: 1, centerWeighted: false });
    // The grey background covers 75% of the frame, so without weighting it dominates.
    expect(flat.closeness).toBeLessThan(55); // below the default acceptance threshold
  });

  it('is deterministic for the same seed', () => {
    const img = new Uint8Array(16 * 16 * 3).map((_, i) => (i * 37) % 256);
    expect(dominantColor(img, 16, 16, { seed: 5 })).toEqual(dominantColor(img, 16, 16, { seed: 5 }));
  });

  it('ignores near-black pixels for chromatic targets', () => {
    const size = 10;
    const img = new Uint8Array(size * size * 3);
    const red = hexToRgb('#c82828');
    for (let i = 0; i < size * size; i++) {
      // 70% black frame, 30% red
      const c = i % 10 < 7 ? { r: 2, g: 2, b: 2 } : red;
      img.set([c.r, c.g, c.b], i * 3);
    }
    const result = evaluateColorMatch(img, size, size, '#c82828', { centerWeighted: false });
    expect(result.closeness).toBeGreaterThan(90);
  });

  it('throws when the buffer is too small', () => {
    expect(() => dominantColor(new Uint8Array(3), 4, 4)).toThrow();
  });
});

describe('centerWeights', () => {
  it('is heaviest in the centre', () => {
    const w = centerWeights(9, 9);
    expect(w[4 * 9 + 4]).toBeGreaterThan(w[0] as number);
    expect(w[4 * 9 + 4]).toBeGreaterThan(0.95);
  });
});
