import { estimateAspect, isConvexQuad, pixelAspect } from './aspect';
import { invert3, solveHomography } from './homography';
import type { Mat3, Quad, Vec2 } from './types';

export interface GeometryInput {
  corners: Quad;
  widthCm: number;
  /** User-entered height; overrides the estimate when set. */
  heightCm?: number | null;
  focalPx: number;
  imageSize: Vec2;
}

export interface Geometry {
  widthCm: number;
  heightCm: number;
  aspectSource: 'user' | 'estimated' | 'pixel';
  /** Window cm space ([0,W]×[0,H], y down) → image pixels. */
  cmToPx: Mat3;
  pxToCm: Mat3;
}

/** Returns null when the corners do not form a usable (convex) quad; callers keep the last geometry. */
export function buildGeometry(inp: GeometryInput): Geometry | null {
  const { corners, widthCm, focalPx, imageSize } = inp;
  if (!isConvexQuad(corners) || !(widthCm > 0)) return null;
  let heightCm: number;
  let aspectSource: Geometry['aspectSource'];
  if (inp.heightCm && inp.heightCm > 0) {
    heightCm = inp.heightCm;
    aspectSource = 'user';
  } else {
    const est = estimateAspect(corners, focalPx, [imageSize[0] / 2, imageSize[1] / 2]);
    aspectSource = est ? 'estimated' : 'pixel';
    heightCm = widthCm / (est ?? pixelAspect(corners));
  }
  const rect: Quad = [[0, 0], [widthCm, 0], [widthCm, heightCm], [0, heightCm]];
  const cmToPx = solveHomography(rect, corners);
  const pxToCm = cmToPx && invert3(cmToPx);
  if (!cmToPx || !pxToCm) return null;
  return { widthCm, heightCm, aspectSource, cmToPx, pxToCm };
}
