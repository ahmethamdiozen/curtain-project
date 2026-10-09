import { applyH } from './homography';
import type { Mat3 } from './types';

/** Single-channel 0–255 mask (row-major). */
export interface Mask {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MaskSet {
  surface: Mask;
  limit: Mask;
  occluder: Mask;
}

const at = (m: Mask, x: number, y: number) => m.data[Math.round(y) * m.width + Math.round(x)];

/**
 * Wall–floor junction below the window, in window cm (y). Walks down several columns until the
 * surface→floor transition; columns hidden by furniture are ignored (the floor seen in front of
 * a sofa is not on the wall plane). Returns null when no column sees the junction.
 */
export function findFloorCm(masks: MaskSet, cmToPx: Mat3, widthCm: number, heightCm: number): number | null {
  const { width, height } = masks.limit;
  const found: number[] = [];
  for (let k = 0; k <= 10; k++) {
    const x = -10 + (k / 10) * (widthCm + 20);
    let prevSurface = false;
    // Start inside the lower window: floor-length windows (balcony doors) end at the floor itself.
    for (let y = heightCm * 0.75; y < heightCm + 320; y += 0.5) {
      const [px, py] = applyH(cmToPx, [x, y]);
      if (!(px >= 0 && py >= 0 && px <= width - 1 && py <= height - 1)) break;
      if (at(masks.occluder, px, py) > 127) break;
      if (at(masks.limit, px, py) > 127) {
        if (prevSurface) found.push(y);
        break;
      }
      prevSurface = at(masks.surface, px, py) > 127;
    }
  }
  if (found.length < 2) return null;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}
