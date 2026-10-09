import { describe, expect, it } from 'vitest';
import { CATALOG, FABRICS, FAMILIES, PALETTE } from './catalog';
import { hexToRgb01 } from './color';

describe('catalog', () => {
  it('has 10–15 items with unique ids', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(CATALOG.length).toBeLessThanOrEqual(15);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
  });

  it('covers every family and only known fabrics', () => {
    const fams = new Set(CATALOG.map((c) => c.family));
    for (const f of Object.keys(FAMILIES)) expect(fams.has(f as never)).toBe(true);
    for (const c of CATALOG) {
      expect(FABRICS).toContain(c.fabric);
      expect(c.repeatCm).toBeGreaterThan(0);
      expect(c.opacity).toBeGreaterThan(0);
      expect(c.opacity).toBeLessThanOrEqual(1);
      expect(() => hexToRgb01(c.defaultColor)).not.toThrow();
    }
  });

  it('palette colors are valid hex', () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(12);
    for (const p of PALETTE) expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
