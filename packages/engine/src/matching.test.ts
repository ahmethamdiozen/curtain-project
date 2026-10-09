import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT, exposureFrom, lightOrDefault, whiteBalance, windowRatio } from './matching';

describe('matching', () => {
  it('fills missing light stats with defaults (old scene packages)', () => {
    expect(lightOrDefault(undefined)).toEqual(DEFAULT_LIGHT);
    expect(lightOrDefault({ wallLum: 0.3 }).wallLum).toBe(0.3);
    expect(lightOrDefault({ windowLum: null }).windowLum).toBeNull();
  });

  it('exposure stays bounded for very dark and very bright walls', () => {
    const dark = exposureFrom({ ...DEFAULT_LIGHT, wallLum: 0.005, whiteLum: 0.9 });
    const bright = exposureFrom({ ...DEFAULT_LIGHT, wallLum: 0.95, whiteLum: 0.98 });
    expect(dark).toBeGreaterThan(0.1);
    expect(bright).toBeLessThan(1);
    expect(exposureFrom({ ...DEFAULT_LIGHT, wallLum: 0.2 })).toBeGreaterThan(exposureFrom({ ...DEFAULT_LIGHT, wallLum: 0.1 }));
  });

  it('white balance is neutral for a grey wall and warm for a warm wall', () => {
    whiteBalance({ ...DEFAULT_LIGHT, wallRgb: [0.2, 0.2, 0.2] }).forEach((v) => expect(v).toBeCloseTo(1, 3));
    const [r, g, b] = whiteBalance({ ...DEFAULT_LIGHT, wallRgb: [0.186, 0.146, 0.108] });
    expect(r).toBeGreaterThan(1);
    expect(b).toBeLessThan(1);
    expect(b).toBeGreaterThanOrEqual(0.7);
    // luminance preserved
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 2);
  });

  it('window ratio is clamped and defaults to 1 without a window', () => {
    expect(windowRatio({ ...DEFAULT_LIGHT, windowLum: null })).toBe(1);
    expect(windowRatio({ ...DEFAULT_LIGHT, wallLum: 0.01, windowLum: 0.9 })).toBe(12);
  });
});
