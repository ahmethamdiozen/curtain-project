import { describe, expect, it } from 'vitest';
import { estimateAspect, isConvexQuad, pixelAspect } from './aspect';
import type { Quad, Vec2 } from './types';

/** Project a world rectangle (width w, height h) seen by a rotated pinhole camera. */
function projectRect(w: number, h: number, yawDeg: number, pitchDeg: number, f: number, pp: Vec2): Quad {
  const ya = (yawDeg * Math.PI) / 180, pa = (pitchDeg * Math.PI) / 180;
  const pts: [number, number, number][] = [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]];
  return pts.map(([x, y, z]) => {
    // yaw around Y, then pitch around X, then push 5 units forward
    let X = x * Math.cos(ya) + z * Math.sin(ya);
    let Z = -x * Math.sin(ya) + z * Math.cos(ya);
    let Y = y * Math.cos(pa) - Z * Math.sin(pa);
    Z = y * Math.sin(pa) + Z * Math.cos(pa) + 5;
    return [pp[0] + (f * X) / Z, pp[1] + (f * Y) / Z] as Vec2;
  }) as Quad;
}

describe('estimateAspect (Zhang & He)', () => {
  const pp: Vec2 = [960, 540];

  it('recovers the true aspect under strong perspective', () => {
    const q = projectRect(1.5, 1.0, 30, 10, 1500, pp);
    expect(estimateAspect(q, 1500, pp)!).toBeCloseTo(1.5, 1);
    expect(Math.abs(estimateAspect(q, 1500, pp)! - 1.5) / 1.5).toBeLessThan(0.02);
  });

  it('recovers a tall window', () => {
    const q = projectRect(0.8, 1.6, -25, -8, 1200, pp);
    expect(Math.abs(estimateAspect(q, 1200, pp)! - 0.5) / 0.5).toBeLessThan(0.02);
  });

  it('frontal (no perspective) gives the pixel ratio', () => {
    const q: Quad = [[100, 100], [400, 100], [400, 300], [100, 300]];
    expect(estimateAspect(q, 1500, pp)!).toBeCloseTo(1.5, 6);
  });

  it('degenerate: returns null for a non-convex quad', () => {
    const q: Quad = [[100, 100], [400, 100], [150, 150], [100, 300]];
    expect(isConvexQuad(q)).toBe(false);
    expect(estimateAspect(q, 1500, pp)).toBeNull();
  });

  it('degenerate: returns null for a self-intersecting quad', () => {
    const q: Quad = [[100, 100], [400, 300], [400, 100], [100, 300]];
    expect(estimateAspect(q, 1500, pp)).toBeNull();
  });

  it('pixelAspect averages opposite edges', () => {
    expect(pixelAspect([[0, 0], [300, 0], [300, 200], [0, 200]])).toBeCloseTo(1.5, 6);
  });
});
