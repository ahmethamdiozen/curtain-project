import { describe, expect, it } from 'vitest';
import { applyH, invert3, solveHomography } from './homography';
import type { Quad, Vec2 } from './types';

const src: Quad = [[0, 0], [120, 0], [120, 150], [0, 150]];
const dst: Quad = [[210, 95], [530, 130], [515, 470], [225, 440]];

describe('homography', () => {
  it('maps the four source points exactly onto the destination', () => {
    const H = solveHomography(src, dst)!;
    src.forEach((p, i) => {
      const q = applyH(H, p);
      expect(q[0]).toBeCloseTo(dst[i][0], 6);
      expect(q[1]).toBeCloseTo(dst[i][1], 6);
    });
  });

  it('inverse round-trips arbitrary points', () => {
    const H = solveHomography(src, dst)!;
    const Hi = invert3(H)!;
    const pts: Vec2[] = [[10, 20], [60, 75], [-40, 200], [119, 1]];
    for (const p of pts) {
      const back = applyH(Hi, applyH(H, p));
      expect(back[0]).toBeCloseTo(p[0], 6);
      expect(back[1]).toBeCloseTo(p[1], 6);
    }
  });

  it('returns null for collinear (degenerate) points', () => {
    expect(solveHomography(src, [[0, 0], [1, 1], [2, 2], [3, 3]])).toBeNull();
  });
});
