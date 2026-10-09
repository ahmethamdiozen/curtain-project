/**
 * Curtain geometry in window cm space (wall z = 0, room z < 0, y down). Pure functions that
 * return plain arrays so they can be tested without WebGL and fed to any renderer.
 */
import type { Family } from './catalog';

export interface MeshData {
  positions: Float32Array;
  /** Fabric coordinates in cm (u across the unfolded fabric, v down). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Vertices per row for grid meshes. */
  cols?: number;
  /** Cavity / ambient occlusion per vertex (1 = open, lower = inside a fold). */
  ao?: Float32Array;
}

export interface CurtainModel {
  /** Meshes drawn with the catalog fabric material. */
  fabric: MeshData[];
  /** Rods, rings, cassettes, rails — neutral hardware material. */
  hardware: MeshData[];
}

export interface DrapeParams {
  widthCm: number;
  heightCm: number;
  /** Wall–floor junction in window cm (y). */
  floorY: number;
  /** Family-specific 0–1: closing (fon), drop (stor/zebra/jaluzi), tieback height (kruvaze). */
  amount: number;
  seed?: number;
}

export const ROD_Y = -13;
export const HEAD_Y = -10;
export const OVERHANG = 18;
const HEM_GAP = 1.5;

type Vec3 = [number, number, number];

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Pleat profile z(s) over [0, width]: alternating half-waves with random widths (0.7–1.3 × period).
 * Amplitude is proportional to each half-wave's width, so slopes match at the joins (C1).
 */
export function foldProfile(width: number, period: number, depthRatio: number, seed: number): (s: number) => number {
  const r = rng(seed);
  const widths: number[] = [];
  let total = 0;
  while (total < width) {
    const w = period * (0.7 + 0.6 * r());
    widths.push(w);
    total += w;
  }
  const k = width / total;
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    widths[i] *= k;
    starts.push(acc);
    acc += widths[i];
  }
  return (s: number) => {
    if (s <= 0 || s >= width) return 0;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const w = widths[lo];
    return (lo % 2 ? -1 : 1) * depthRatio * w * Math.sin((Math.PI * (s - starts[lo])) / w);
  };
}

/** Grid mesh; u is the cumulative arc length per row rescaled to the top row (inextensible cloth). */
function grid(cols: number, rows: number, at: (c: number, r: number) => Vec3, vOf?: (p: Vec3, r: number) => number): MeshData {
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) positions.set(at(c, r), (r * cols + c) * 3);
  let topLen = 0;
  for (let r = 0; r < rows; r++) {
    const arc = [0];
    for (let c = 1; c < cols; c++) {
      const i = (r * cols + c) * 3, j = i - 3;
      arc.push(arc[c - 1] + Math.hypot(positions[i] - positions[j], positions[i + 1] - positions[j + 1], positions[i + 2] - positions[j + 2]));
    }
    if (r === 0) topLen = arc[cols - 1] || 1;
    const scale = topLen / (arc[cols - 1] || 1);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      uvs[i * 2] = arc[c] * scale;
      uvs[i * 2 + 1] = vOf ? vOf([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]], r) : positions[i * 3 + 1] - HEAD_Y;
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      indices.set([a, d, b, b, d, e], k);
      k += 6;
    }
  return { positions, uvs, indices, cols };
}

function merge(meshes: MeshData[]): MeshData {
  const nv = meshes.reduce((s, m) => s + m.positions.length / 3, 0);
  const ni = meshes.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), indices = new Uint32Array(ni);
  const ao = new Float32Array(nv).fill(1);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo * 3);
    uvs.set(m.uvs, vo * 2);
    if (m.ao) ao.set(m.ao, vo);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo;
    vo += m.positions.length / 3;
    io += m.indices.length;
  }
  return { positions, uvs, indices, ao };
}

/**
 * Cavity shading for pleated grids: per row, vertices pushed back toward the wall sit inside a
 * fold and see less of the room. Also darkens the gathered heading under the rod.
 */
function withFoldAO(m: MeshData, strength = 0.6): MeshData {
  const cols = m.cols!, rows = m.positions.length / 3 / cols;
  const ao = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    let zmin = Infinity, zmax = -Infinity;
    for (let c = 0; c < cols; c++) {
      const z = m.positions[(r * cols + c) * 3 + 2];
      zmin = Math.min(zmin, z);
      zmax = Math.max(zmax, z);
    }
    const range = zmax - zmin;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const depth = range > 1 ? (m.positions[i * 3 + 2] - zmin) / range : 0;
      const heading = 0.8 + 0.2 * smooth((m.positions[i * 3 + 1] - HEAD_Y) / 5);
      ao[i] = (1 - strength * Math.pow(depth, 1.3)) * heading;
    }
  }
  return { ...m, ao };
}

/** Mirroring x reverses triangle orientation; swap two indices per triangle to keep faces toward the room. */
function flipWinding(m: MeshData): MeshData {
  const indices = m.indices.slice();
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return { ...m, indices };
}

const flatAO = (m: MeshData): MeshData => ({ ...m, ao: new Float32Array(m.positions.length / 3).fill(1) });

// ---------- hardware primitives ----------
function box(min: Vec3, max: Vec3): MeshData {
  const faces: [Vec3, Vec3, Vec3, Vec3][] = [];
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const P = (x: number, y: number, z: number): Vec3 => [x, y, z];
  faces.push([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)]); // back
  faces.push([P(x0, y0, z1), P(x0, y1, z1), P(x1, y1, z1), P(x1, y0, z1)]); // front (toward wall)
  faces.push([P(x0, y0, z0), P(x0, y0, z1), P(x1, y0, z1), P(x1, y0, z0)]); // top
  faces.push([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]); // bottom
  faces.push([P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1), P(x0, y0, z1)]); // left
  faces.push([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)]); // right
  const positions = new Float32Array(faces.flatMap((f) => f.flat()));
  const indices = new Uint32Array(faces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]));
  return { positions, uvs: new Float32Array((positions.length / 3) * 2), indices };
}

/** Surface of revolution around an axis parallel to x: radius(t) for t ∈ [0,1] along x0→x1. */
function lathe(x0: number, x1: number, y: number, z: number, radius: (t: number) => number, along = 12, around = 16): MeshData {
  return grid(around + 1, along + 1, (c, r) => {
    const t = r / along, a = (c / around) * Math.PI * 2, rad = radius(t);
    return [x0 + (x1 - x0) * t, y + rad * Math.cos(a), z + rad * Math.sin(a)];
  });
}

const sphere = (c: Vec3, rad: number) =>
  lathe(c[0] - rad, c[0] + rad, c[1], c[2], (t) => rad * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)), 10, 14);

/** Ring around the rod (axis along x). */
function torusX(c: Vec3, R: number, r: number): MeshData {
  return grid(17, 9, (i, j) => {
    const a = (i / 16) * Math.PI * 2, b = (j / 8) * Math.PI * 2;
    const rr = R + r * Math.cos(b);
    return [c[0] + r * Math.sin(b), c[1] + rr * Math.cos(a), c[2] + rr * Math.sin(a)];
  });
}

function rodHardware(W: number, z: number, ringXs: number[]): MeshData[] {
  const x0 = -OVERHANG - 8, x1 = W + OVERHANG + 8;
  return [
    lathe(x0, x1, ROD_Y, z, () => 1.3, 2, 16),
    sphere([x0 - 2, ROD_Y, z], 2.6),
    sphere([x1 + 2, ROD_Y, z], 2.6),
    ...ringXs.map((x) => torusX([x, ROD_Y, z], 2.6, 0.35)),
  ];
}

// ---------- families ----------
function pleatedPanel(opts: {
  x0: number; width: number; mirror?: boolean; W: number; gap: number; hemY: number;
  period: number; ratio: number; seed: number; flare: number;
}): { mesh: MeshData; rings: number[] } {
  const { x0, width, W, gap, hemY, period, ratio, seed, flare } = opts;
  const prof = foldProfile(width, period, ratio, seed);
  const sway = rng(seed + 99)() * 6;
  const cols = Math.max(24, Math.ceil(width / 0.7) + 1);
  const rows = Math.max(24, Math.ceil((hemY - HEAD_Y) / 2.2) + 1);
  const mesh = grid(cols, rows, (c, r) => {
    const u = c / (cols - 1), vn = r / (rows - 1);
    const s = u * width;
    const depth = 0.55 + 0.65 * smooth(vn * 1.3);
    let y = HEAD_Y + vn * (hemY - HEAD_Y);
    const z = -gap + prof(s) * depth;
    if (r === rows - 1) y -= 1.2 * Math.abs(prof(s)) / (ratio * period); // scalloped hem
    let x = x0 + s * (1 + flare * vn) + 0.8 * vn * Math.sin(y * 0.035 + sway);
    if (opts.mirror) x = W - x;
    return [x, y, z];
  });
  const rings: number[] = [];
  for (let s = 1.5; s < width; s += period * 1.8) rings.push(opts.mirror ? W - (x0 + s) : x0 + s);
  return { mesh: withFoldAO(opts.mirror ? flipWinding(mesh) : mesh), rings };
}

function fon(p: DrapeParams): CurtainModel {
  const W = p.widthCm, hemY = p.floorY - HEM_GAP, seed = p.seed ?? 1;
  const width = OVERHANG + Math.max(p.amount * W * 0.5, 12);
  const common = { x0: -OVERHANG, width, W, gap: 12, hemY, period: 11, ratio: 0.42, flare: 0.05 };
  const left = pleatedPanel({ ...common, seed });
  const right = pleatedPanel({ ...common, seed: seed + 17, mirror: true });
  return { fabric: [left.mesh, right.mesh], hardware: rodHardware(W, -12, [...left.rings, ...right.rings]) };
}

function tul(p: DrapeParams): CurtainModel {
  const W = p.widthCm, hemY = p.floorY - HEM_GAP;
  const panel = pleatedPanel({
    x0: -OVERHANG, width: W + 2 * OVERHANG, W, gap: 8, hemY, period: 7, ratio: 0.3, seed: (p.seed ?? 1) + 5, flare: 0,
  });
  return { fabric: [panel.mesh], hardware: rodHardware(W, -8, panel.rings.filter((_, i) => i % 2 === 0)) };
}

const shadeDrop = (p: DrapeParams, head: number) => -head + (p.heightCm + head + 6) * Math.min(1, Math.max(0.05, p.amount));

function stor(p: DrapeParams): CurtainModel {
  const W = p.widthCm, top = -2, drop = Math.min(shadeDrop(p, 2), p.floorY - 4);
  const cols = 32, rows = Math.max(8, Math.ceil((drop - top) / 3) + 1);
  const cloth = grid(cols, rows, (c, r) => {
    const x = -5 + (c / (cols - 1)) * (W + 10), vn = r / (rows - 1), y = top + vn * (drop - top);
    // slight belly in the middle and soft ripples from the roll
    const z = -4 - 0.5 * Math.sin(Math.PI * (c / (cols - 1))) * Math.sin(Math.PI * vn) - 0.12 * Math.sin(x * 0.21 + y * 0.05);
    return [x, y, z];
  }, (pt) => pt[1] - top);
  return {
    fabric: [flatAO(cloth)],
    hardware: [
      box([-6, -9, -7.5], [W + 6, -1, -0.5]),
      lathe(-5.5, W + 5.5, drop + 1.1, -4, () => 1.1, 2, 12),
    ],
  };
}

function jaluzi(p: DrapeParams): CurtainModel {
  const W = p.widthCm, drop = Math.min(shadeDrop(p, 6), p.floorY - 4);
  // 40° tilt: each slat spans ~3.8 cm vertically, leaving thin light gaps at a 4.6 cm pitch.
  const pitch = 4.6, chord = 5, tilt = (40 * Math.PI) / 180, zc = -6;
  const slats: MeshData[] = [];
  for (let i = 0, y = 1; y < drop - 1; i++, y += pitch) {
    const slat = grid(2, 7, (c, r) => {
      const t = r / 6 - 0.5, q = t * chord;
      return [-3 + c * (W + 6), y + q * Math.cos(tilt), zc + q * Math.sin(tilt) - 0.35 * (1 - 4 * t * t)];
    }, (_, r) => i * 7.3 + (r / 6) * chord);
    // the upper edge tucks under the previous slat
    slat.ao = Float32Array.from({ length: 14 }, (_, k) => 0.5 + 0.5 * Math.floor(k / 2) / 6);
    slats.push(slat);
  }
  const strings = [10, W / 2, W - 10].flatMap((x) => [
    box([x - 0.12, -1, zc - 2.6], [x + 0.12, drop, zc - 2.4]),
    box([x - 0.12, -1, zc + 2.0], [x + 0.12, drop, zc + 2.2]),
  ]);
  return {
    fabric: [merge(slats)],
    hardware: [box([-4, -6, -9.5], [W + 4, -1, -2.5]), box([-3.5, drop, -8.5], [W + 3.5, drop + 2, -3.5]), ...strings],
  };
}

function kruvazePanel(p: DrapeParams, mirror: boolean, seed: number): { panel: MeshData; band: MeshData } {
  const W = p.widthCm, H = p.heightCm, hemY = p.floorY - HEM_GAP;
  const outer = -OVERHANG, xTop = W / 2 + 8, xTie = outer + 24;
  const tieY = HEAD_Y + Math.min(0.95, Math.max(0.2, p.amount)) * (H + 12);
  const inner = (y: number) =>
    y < tieY
      ? xTop + (xTie - xTop) * Math.pow(Math.min(1, Math.max(0, (y - HEAD_Y) / (tieY - HEAD_Y))), 0.75)
      : xTie + Math.min((y - tieY) * 0.22, 20);
  const topWidth = xTop - outer;
  const prof = foldProfile(topWidth, 11, 0.42, seed);
  const cols = 72, rows = Math.max(40, Math.ceil((hemY - HEAD_Y) / 2) + 1);
  const front = mirror ? 0 : -0.8; // left panel lies over the right one at the top
  const panel = grid(cols, rows, (c, r) => {
    const u = c / (cols - 1), vn = r / (rows - 1);
    let y = HEAD_Y + vn * (hemY - HEAD_Y);
    const width = inner(y) - outer;
    const gather = Math.min(2, 1 + 0.3 * (topWidth / width - 1));
    const s = u * topWidth;
    let z = -12 + front + prof(s) * (0.55 + 0.5 * smooth(vn * 1.4)) * gather;
    z -= 3.5 * Math.exp(-(((y - tieY) / 11) ** 2)) * (1 - 0.6 * u); // gathered bulge at the tieback
    if (r === rows - 1) y -= Math.abs(prof(s)) / (0.42 * 11);
    let x = outer + u * width;
    if (mirror) x = W - x;
    return [x, y, z];
  });
  let minZ = 0;
  for (let i = 0; i < panel.positions.length; i += 3)
    if (Math.abs(panel.positions[i + 1] - tieY) < 4) minZ = Math.min(minZ, panel.positions[i + 2]);
  const band = grid(16, 3, (c, r) => {
    const u = c / 15, x0 = outer - 1, x1 = xTie + 3;
    const x = x0 + u * (x1 - x0);
    return [mirror ? W - x : x, tieY - 2.2 + r * 2.2, minZ - 0.8 - 1.2 * Math.sin(Math.PI * u)];
  });
  const fix = (m: MeshData) => (mirror ? flipWinding(m) : m);
  return { panel: withFoldAO(fix(panel), 0.55), band: flatAO(fix(band)) };
}

function kruvaze(p: DrapeParams): CurtainModel {
  const seed = p.seed ?? 1;
  const l = kruvazePanel(p, false, seed), r = kruvazePanel(p, true, seed + 23);
  const rings: number[] = [];
  for (let x = -OVERHANG + 1.5; x < p.widthCm / 2; x += 20) rings.push(x, p.widthCm - x);
  return { fabric: [l.panel, r.panel, l.band, r.band], hardware: rodHardware(p.widthCm, -12, rings) };
}

export function buildCurtain(family: Family, p: DrapeParams): CurtainModel {
  switch (family) {
    case 'fon': return fon(p);
    case 'tul': return tul(p);
    case 'stor':
    case 'zebra': return stor(p);
    case 'jaluzi': return jaluzi(p);
    case 'kruvaze': return kruvaze(p);
  }
}
