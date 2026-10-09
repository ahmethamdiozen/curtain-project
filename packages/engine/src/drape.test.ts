import { describe, expect, it } from 'vitest';
import { buildCurtain, foldProfile, type CurtainModel, type MeshData } from './drape';
import type { Family } from './catalog';

const W = 120, H = 140, floorY = H + 95;
const base = { widthCm: W, heightCm: H, floorY, seed: 3 };

function bounds(meshes: MeshData[]) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    }
  return b;
}

function validIndices(m: MeshData) {
  const n = m.positions.length / 3;
  expect(m.indices.length % 3).toBe(0);
  for (const i of m.indices) expect(i).toBeLessThan(n);
  expect(m.uvs.length / 2).toBe(n);
}

describe('foldProfile', () => {
  it('is zero at both ends, continuous and deterministic', () => {
    const p = foldProfile(80, 11, 0.42, 7);
    expect(Math.abs(p(0))).toBeLessThan(1e-9);
    expect(Math.abs(p(80))).toBeLessThan(0.5);
    for (let s = 0; s < 80; s += 0.25) expect(Math.abs(p(s + 0.25) - p(s))).toBeLessThan(0.6);
    expect(foldProfile(80, 11, 0.42, 7)(33)).toBe(p(33));
    expect(Math.max(...Array.from({ length: 320 }, (_, i) => Math.abs(p(i / 4))))).toBeGreaterThan(3);
  });
});

describe('buildCurtain', () => {
  const families: Family[] = ['fon', 'tul', 'stor', 'zebra', 'jaluzi', 'kruvaze'];
  for (const family of families) {
    it(`${family}: valid meshes hanging in front of the wall, above the floor`, () => {
      const m: CurtainModel = buildCurtain(family, { ...base, amount: 0.6 });
      expect(m.fabric.length).toBeGreaterThan(0);
      [...m.fabric, ...m.hardware].forEach(validIndices);
      const b = bounds([...m.fabric, ...m.hardware]);
      expect(b.maxZ).toBeLessThanOrEqual(0); // never behind the wall
      expect(b.maxY).toBeLessThanOrEqual(floorY);
      expect(b.minX).toBeGreaterThan(-40);
      expect(b.maxX).toBeLessThan(W + 40);
    });
  }

  it('fon: closing amount moves the inner panel edges toward the centre', () => {
    const open = bounds(buildCurtain('fon', { ...base, amount: 0.2 }).fabric.slice(0, 1));
    const closed = bounds(buildCurtain('fon', { ...base, amount: 1 }).fabric.slice(0, 1));
    expect(closed.maxX).toBeGreaterThan(open.maxX + 30);
    expect(closed.maxX).toBeGreaterThan(W / 2 - 8);
  });

  it('fon: hem reaches close to the floor and folds deepen toward the hem', () => {
    const m = buildCurtain('fon', { ...base, amount: 0.5 });
    const b = bounds(m.fabric);
    expect(b.maxY).toBeGreaterThan(floorY - 5);
    expect(b.minY).toBeLessThan(-8);
  });

  it('fon: texture u follows the unfolded fabric (monotonic along each row)', () => {
    const m = buildCurtain('fon', { ...base, amount: 0.5 }).fabric[0];
    const cols = m.cols!;
    for (let r = 0; r < m.positions.length / 3 / cols; r += 7)
      for (let c = 1; c < cols; c++) expect(m.uvs[(r * cols + c) * 2]).toBeGreaterThan(m.uvs[(r * cols + c - 1) * 2]);
  });

  it('stor: drop controls the length', () => {
    const short = bounds(buildCurtain('stor', { ...base, amount: 0.3 }).fabric);
    const long = bounds(buildCurtain('stor', { ...base, amount: 1 }).fabric);
    expect(long.maxY).toBeGreaterThan(short.maxY + 60);
    expect(long.maxY).toBeLessThanOrEqual(H + 8);
  });

  it('kruvaze: the panel is gathered narrow at the tieback', () => {
    const m = buildCurtain('kruvaze', { ...base, amount: 0.6 }).fabric[0];
    const tieY = -10 + 0.6 * (H + 12);
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3)
      if (Math.abs(m.positions[i + 1] - tieY) < 2) {
        minX = Math.min(minX, m.positions[i]);
        maxX = Math.max(maxX, m.positions[i]);
      }
    expect(maxX - minX).toBeLessThan(40);
  });

  it('jaluzi: has many slats', () => {
    const m = buildCurtain('jaluzi', { ...base, amount: 1 });
    expect(m.fabric[0].positions.length / 3).toBeGreaterThan(30 * 8);
  });
});

describe('cavity (ambient occlusion) attribute', () => {
  it('fon: fold valleys toward the wall are darker than crests', () => {
    const m = buildCurtain('fon', { ...base, amount: 0.5 }).fabric[0];
    expect(m.ao).toBeDefined();
    expect(m.ao!.length).toBe(m.positions.length / 3);
    const ao = Array.from(m.ao!);
    expect(Math.min(...ao)).toBeLessThan(0.65);
    expect(Math.max(...ao)).toBeGreaterThan(0.95);
    // the vertex closest to the wall in a mid row is among the darkest of that row
    const cols = m.cols!, r = 50;
    let deepest = 0;
    for (let c = 0; c < cols; c++) if (m.positions[(r * cols + c) * 3 + 2] > m.positions[(r * cols + deepest) * 3 + 2]) deepest = c;
    const rowAo = ao.slice(r * cols, (r + 1) * cols);
    expect(rowAo[deepest]).toBeLessThan(Math.min(...rowAo) + 0.05);
  });

  it('every family provides ao for every fabric mesh', () => {
    for (const f of ['fon', 'tul', 'stor', 'zebra', 'jaluzi', 'kruvaze'] as const)
      for (const m of buildCurtain(f, { ...base, amount: 0.6 }).fabric) expect(m.ao?.length).toBe(m.positions.length / 3);
  });
});

describe('winding', () => {
  // Average geometric normal of a mesh (from triangle winding) must face the room (−z) for every panel,
  // mirrored ones included — otherwise lighting and shadow-side culling disagree between panels.
  const avgNormalZ = (m: MeshData) => {
    let z = 0;
    const p = m.positions;
    for (let i = 0; i < m.indices.length; i += 3) {
      const [a, b, c] = [m.indices[i] * 3, m.indices[i + 1] * 3, m.indices[i + 2] * 3];
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1];
      z += ux * vy - uy * vx;
    }
    return z;
  };
  for (const f of ['fon', 'kruvaze'] as const)
    it(`${f}: all fabric panels face the room`, () => {
      for (const m of buildCurtain(f, { ...base, amount: 0.6 }).fabric) expect(avgNormalZ(m)).toBeLessThan(0);
    });
});
