import { describe, expect, it } from 'vitest';
import { solveHomography } from './homography';
import { poseFromHomography, projectPoint, type Vec3 } from './pose';
import type { Quad, Vec2 } from './types';

function rot(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const Ry = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const Rx = [1, 0, 0, 0, Math.cos(p), -Math.sin(p), 0, Math.sin(p), Math.cos(p)];
  const m = (a: number[], b: number[]) =>
    [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  return m(Rx, Ry);
}

function truthProject(R: number[], t: Vec3, f: number, pp: Vec2, X: Vec3): Vec2 {
  const x = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0];
  const y = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1];
  const z = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
  return [pp[0] + (f * x) / z, pp[1] + (f * y) / z];
}

describe('poseFromHomography', () => {
  const f = 1100, pp: Vec2 = [640, 480], W = 120, H = 150;
  const rect: Quad = [[0, 0], [W, 0], [W, H], [0, H]];

  for (const [yaw, pitch] of [[0, 0], [28, 6], [-35, -10]]) {
    it(`recovers a camera (yaw ${yaw}, pitch ${pitch}) that reprojects off-plane points`, () => {
      const R = rot(yaw, pitch);
      const t: Vec3 = [-60, -40, 380];
      const corners = rect.map((p) => truthProject(R, t, f, pp, [p[0], p[1], 0])) as Quad;
      const Hm = solveHomography(rect, corners)!;
      const pose = poseFromHomography(Hm, f, pp)!;
      expect(pose).not.toBeNull();
      // R orthonormal
      const RRt = [0, 1, 2].map((i) => [0, 1, 2].map((j) => pose.R[i * 3] * pose.R[j * 3] + pose.R[i * 3 + 1] * pose.R[j * 3 + 1] + pose.R[i * 3 + 2] * pose.R[j * 3 + 2]));
      RRt.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 6)));
      expect(pose.t[2]).toBeGreaterThan(0); // wall in front of the camera
      for (const X of [[0, 0, 0], [W, H, 0], [-20, 30, -12], [W + 20, H + 80, -15], [60, -14, -12]] as Vec3[]) {
        const a = projectPoint(pose, X), b = truthProject(R, t, f, pp, X);
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.5);
      }
    });
  }

  it('room side is negative z: a point in front of the wall is closer to the camera', () => {
    const R = rot(10, 0);
    const t: Vec3 = [-60, -40, 380];
    const corners = rect.map((p) => truthProject(R, t, f, pp, [p[0], p[1], 0])) as Quad;
    const pose = poseFromHomography(solveHomography(rect, corners)!, f, pp)!;
    const depth = (X: Vec3) => pose.R[6] * X[0] + pose.R[7] * X[1] + pose.R[8] * X[2] + pose.t[2];
    expect(depth([60, 75, -12])).toBeLessThan(depth([60, 75, 0]));
  });
});
