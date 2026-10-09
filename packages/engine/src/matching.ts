/** Photo statistics (from the server's `light` block) and how they map onto render parameters. */
export interface LightStats {
  /** Mean linear RGB of the bare wall. */
  wallRgb: [number, number, number];
  /** Median linear luminance of the wall. */
  wallLum: number;
  windowLum: number | null;
  blackLum: number;
  whiteLum: number;
  /** Grain in 8-bit sRGB units. */
  noiseSigma: number;
}

export const DEFAULT_LIGHT: LightStats = {
  wallRgb: [0.25, 0.25, 0.25],
  wallLum: 0.25,
  windowLum: null,
  blackLum: 0.003,
  whiteLum: 0.9,
  noiseSigma: 1.5,
};

export function lightOrDefault(l: Partial<LightStats> | null | undefined): LightStats {
  return { ...DEFAULT_LIGHT, ...(l ?? {}) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Assumed wall albedo: a white-ish painted wall. Dark walls are caught by the whiteLum floor. */
const WALL_ALBEDO = 0.55;

/**
 * Linear scale from render units (albedo-1 surface facing a unit light → 1) to photo units.
 * Bounded by the photo's highlights so dark-painted walls don't make every curtain black.
 */
export function exposureFrom(l: LightStats): number {
  const e = clamp(l.wallLum / WALL_ALBEDO, l.whiteLum * 0.2, l.whiteLum * 0.85);
  return clamp(e, 0.12, 0.95);
}

/** Scene illuminant tint from the wall's chroma, partially applied, luminance-normalised. */
export function whiteBalance(l: LightStats, strength = 0.6): [number, number, number] {
  const L = lum(l.wallRgb) || 1;
  let c = l.wallRgb.map((v) => clamp(1 + strength * (v / L - 1), 0.7, 1.4)) as [number, number, number];
  const n = lum(c);
  c = c.map((v) => v / n) as [number, number, number];
  return c;
}

/** How much brighter the window is than the wall (drives the window key light). */
export function windowRatio(l: LightStats): number {
  return l.windowLum === null ? 1 : clamp(l.windowLum / Math.max(l.wallLum, 1e-3), 1, 12);
}
