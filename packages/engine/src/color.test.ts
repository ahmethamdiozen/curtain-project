import { describe, expect, it } from 'vitest';
import { hexToRgb01, labToSrgb, rgb01ToHex, srgbToLab } from './color';

describe('color', () => {
  it('white is L=100, a=b=0', () => {
    const [L, a, b] = srgbToLab([1, 1, 1]);
    expect(L).toBeCloseTo(100, 2);
    expect(a).toBeCloseTo(0, 2);
    expect(b).toBeCloseTo(0, 2);
  });

  it('sRGB red matches reference LAB', () => {
    const [L, a, b] = srgbToLab([1, 0, 0]);
    expect(L).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
  });

  it('round-trips through LAB', () => {
    for (const c of [[0.2, 0.5, 0.7], [0.9, 0.1, 0.3], [0.05, 0.05, 0.05]] as [number, number, number][]) {
      const back = labToSrgb(srgbToLab(c));
      back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 5));
    }
  });

  it('hex helpers', () => {
    expect(hexToRgb01('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(rgb01ToHex([1, 128 / 255, 0])).toBe('#ff8000');
    expect(hexToRgb01('abc')).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255]);
  });
});
