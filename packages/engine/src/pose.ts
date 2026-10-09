import { invert3 } from './homography';
import type { Mat3, Vec2 } from './types';

export type Vec3 = [number, number, number];

/**
 * Camera pose relative to the wall. World: cm, wall plane z = 0, window [0,W]×[0,H], x right,
 * y down, room on the z < 0 side. Camera coordinates follow OpenCV: x right, y down, z forward.
 * X_cam = R · X_world + t.
 */
export interface Pose {
  R: Mat3; // row-major rotation
  t: Vec3;
  focalPx: number;
  pp: Vec2;
}

const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Nearest rotation by Newton polar iteration R ← (R + R⁻ᵀ)/2. */
function orthonormalize(m: Mat3): Mat3 | null {
  let r = m;
  for (let i = 0; i < 12; i++) {
    const inv = invert3(r);
    if (!inv) return null;
    const it = transpose(inv);
    r = r.map((v, k) => (v + it[k]) / 2);
  }
  return r;
}

/** Decompose the cm→px homography of the wall plane into a camera pose (Zhang). */
export function poseFromHomography(cmToPx: Mat3, focalPx: number, pp: Vec2): Pose | null {
  const [cx, cy] = pp;
  const f = focalPx;
  // M = K⁻¹ · H
  const H = cmToPx;
  const M = [0, 1, 2].map((c) => {
    const x = H[c], y = H[3 + c], w = H[6 + c];
    return [(x - cx * w) / f, (y - cy * w) / f, w] as Vec3;
  });
  const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
  let lambda = 2 / (norm(M[0]) + norm(M[1]));
  if (!Number.isFinite(lambda)) return null;
  if (M[2][2] * lambda < 0) lambda = -lambda; // wall must be in front of the camera
  const r1 = M[0].map((v) => v * lambda) as Vec3;
  const r2 = M[1].map((v) => v * lambda) as Vec3;
  const t = M[2].map((v) => v * lambda) as Vec3;
  const r3: Vec3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  const R = orthonormalize([r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]]);
  if (!R || R.some((v) => !Number.isFinite(v))) return null;
  return { R, t, focalPx: f, pp };
}

export function toCamera(pose: Pose, X: Vec3): Vec3 {
  const R = pose.R;
  return [
    R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + pose.t[0],
    R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + pose.t[1],
    R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + pose.t[2],
  ];
}

export function projectPoint(pose: Pose, X: Vec3): Vec2 {
  const c = toCamera(pose, X);
  return [pose.pp[0] + (pose.focalPx * c[0]) / c[2], pose.pp[1] + (pose.focalPx * c[1]) / c[2]];
}

/** Camera centre in world coordinates: C = −Rᵀ t. */
export function cameraCenter(pose: Pose): Vec3 {
  const Rt = transpose(pose.R), t = pose.t;
  return [0, 1, 2].map((i) => -(Rt[i * 3] * t[0] + Rt[i * 3 + 1] * t[1] + Rt[i * 3 + 2] * t[2])) as Vec3;
}
