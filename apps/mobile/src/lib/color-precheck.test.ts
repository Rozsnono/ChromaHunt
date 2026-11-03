import { encode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { base64ToBytes } from './base64';
import { blockThreshold, hintFor, precheckFromJpeg } from './color-precheck';

function solid(hex: string, w = 24, h = 32): Uint8Array {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4);
  return new Uint8Array(encode({ data, width: w, height: h }, 90).data);
}

describe('precheckFromJpeg', () => {
  it('scores a matching photo high and a different colour near zero', () => {
    expect(precheckFromJpeg(solid('#d32f2f'), '#d32f2f')?.closeness).toBeGreaterThan(90);
    expect(precheckFromJpeg(solid('#1976d2'), '#d32f2f')?.closeness).toBeLessThan(10);
  });
  it('returns null for data that is not a JPEG', () => {
    expect(precheckFromJpeg(new Uint8Array([1, 2, 3]), '#d32f2f')).toBeNull();
  });
});

describe('hints and blocking', () => {
  it('classifies closeness relative to the server threshold', () => {
    expect(hintFor(70, 55)).toBe('close');
    expect(hintFor(45, 55)).toBe('almost');
    expect(hintFor(10, 55)).toBe('far');
  });
  it('blocks only clearly wrong photos', () => {
    expect(blockThreshold(55)).toBe(40);
    expect(blockThreshold(10)).toBe(0);
  });
});

describe('base64ToBytes', () => {
  it('decodes padded, unpadded and data-URI input', () => {
    const hello = [104, 101, 108, 108, 111];
    expect([...base64ToBytes('aGVsbG8=')]).toEqual(hello);
    expect([...base64ToBytes('aGVsbG8')]).toEqual(hello);
    expect([...base64ToBytes('data:image/jpeg;base64,YWJj')]).toEqual([97, 98, 99]);
  });
  it('rejects invalid characters', () => {
    expect(() => base64ToBytes('@@@@')).toThrow();
  });
});
