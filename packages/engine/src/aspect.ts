import type { Quad, Vec2 } from './types';

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** True when the quad (TL, TR, BR, BL) is strictly convex and consistently clockwise on screen. */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Width/height from average opposite edge lengths in pixels (no perspective correction). */
export function pixelAspect(q: Quad): number {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return w / h;
}

/**
 * Real-world width/height of a rectangle seen as quad q, given the focal length in pixels and the
 * principal point (Zhang & He, "Whiteboard scanning and image enhancement", 2007).
 * Returns null for degenerate quads.
 */
export function estimateAspect(q: Quad, focalPx: number, pp: Vec2): number | null {
  if (!isConvexQuad(q) || !(focalPx > 0)) return null;
  const h = (p: Vec2): V3 => [p[0] - pp[0], p[1] - pp[1], 1];
  // Paper notation: m1=(0,0) m2=(w,0) m3=(0,h) m4=(w,h)
  const m1 = h(q[0]), m2 = h(q[1]), m3 = h(q[3]), m4 = h(q[2]);
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3) || k2 <= 0 || k3 <= 0) return null;
  const n2: V3 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3: V3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const f2 = focalPx * focalPx;
  const num = (n2[0] ** 2 + n2[1] ** 2) / f2 + n2[2] ** 2;
  const den = (n3[0] ** 2 + n3[1] ** 2) / f2 + n3[2] ** 2;
  const aspect = Math.sqrt(num / den);
  return Number.isFinite(aspect) && aspect > 0.1 && aspect < 10 ? aspect : null;
}
