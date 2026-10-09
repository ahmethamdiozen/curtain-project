import { describe, expect, it } from 'vitest';
import { findFloorCm, type MaskSet } from './floor';
import type { Mat3 } from './types';

// Frontal camera: 1 cm = 2 px, window top-left at (100, 60)
const cmToPx: Mat3 = [2, 0, 100, 0, 2, 60, 0, 0, 1];
const w = 400, h = 600;

function masks(floorPx: number | null, occluderRows?: [number, number]): MaskSet {
  const mk = () => ({ data: new Uint8Array(w * h), width: w, height: h });
  const surface = mk(), limit = mk(), occluder = mk();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (floorPx !== null && y >= floorPx) limit.data[i] = 255;
      else surface.data[i] = 255;
      if (occluderRows && y >= occluderRows[0] && y < occluderRows[1]) {
        occluder.data[i] = 255;
        surface.data[i] = 0;
      }
    }
  return { surface, limit, occluder };
}

describe('findFloorCm', () => {
  it('finds the wall–floor junction below the window', () => {
    // floor at px 460 → (460 − 60)/2 = 200 cm
    const y = findFloorCm(masks(460), cmToPx, 120, 140)!;
    expect(Math.abs(y - 200)).toBeLessThanOrEqual(1);
  });

  it('ignores columns where furniture hides the junction', () => {
    expect(findFloorCm(masks(460, [380, 470]), cmToPx, 120, 140)).toBeNull();
  });

  it('returns null when the floor is not visible', () => {
    expect(findFloorCm(masks(null), cmToPx, 120, 140)).toBeNull();
  });
});
