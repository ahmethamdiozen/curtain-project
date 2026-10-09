import { describe, expect, it } from 'vitest';
import { applyH } from './homography';
import { buildGeometry } from './scene';
import type { Quad } from './types';

const frontal: Quad = [[100, 100], [400, 100], [400, 300], [100, 300]];

describe('buildGeometry', () => {
  it('maps the window rectangle in cm onto the corners', () => {
    const g = buildGeometry({ corners: frontal, widthCm: 120, focalPx: 1500, imageSize: [1280, 960] })!;
    expect(g.aspectSource).toBe('estimated');
    expect(g.heightCm).toBeCloseTo(80, 4);
    const br = applyH(g.cmToPx, [120, 80]);
    expect(br[0]).toBeCloseTo(400, 4);
    expect(br[1]).toBeCloseTo(300, 4);
    const back = applyH(g.pxToCm, [250, 200]);
    expect(back[0]).toBeCloseTo(60, 4);
    expect(back[1]).toBeCloseTo(40, 4);
  });

  it('user height overrides the estimate', () => {
    const g = buildGeometry({ corners: frontal, widthCm: 120, heightCm: 150, focalPx: 1500, imageSize: [1280, 960] })!;
    expect(g.aspectSource).toBe('user');
    expect(g.heightCm).toBe(150);
  });

  it('returns null for a non-convex quad', () => {
    const bad: Quad = [[100, 100], [400, 100], [150, 150], [100, 300]];
    expect(buildGeometry({ corners: bad, widthCm: 120, focalPx: 1500, imageSize: [1280, 960] })).toBeNull();
  });
});
