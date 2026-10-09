export type Family = 'fon' | 'tul' | 'stor' | 'zebra' | 'jaluzi' | 'kruvaze';
export const FABRICS = ['linen', 'velvet', 'stripe', 'damask', 'check', 'sheer', 'wood', 'metal'] as const;
export type FabricId = (typeof FABRICS)[number];

export interface CurtainItem {
  id: string;
  name: string;
  family: Family;
  fabric: FabricId;
  /** Real-world size of one texture tile, in cm. */
  repeatCm: number;
  defaultColor: string;
  /** 1 = opaque; < 1 = sheer, the photo shows through. */
  opacity: number;
}

export interface FamilyInfo {
  name: string;
  /** Shown as the slider label when the family uses `amount`; null when it has no slider. */
  amountLabel: string | null;
  amountDefault: number;
}

export const FAMILIES: Record<Family, FamilyInfo> = {
  fon: { name: 'Fon perde', amountLabel: 'Kapanma', amountDefault: 0.5 },
  tul: { name: 'Tül', amountLabel: null, amountDefault: 0 },
  stor: { name: 'Stor', amountLabel: 'İniş', amountDefault: 0.7 },
  zebra: { name: 'Zebra', amountLabel: 'İniş', amountDefault: 0.8 },
  jaluzi: { name: 'Jaluzi', amountLabel: 'İniş', amountDefault: 0.85 },
  kruvaze: { name: 'Kruvaze', amountLabel: 'Bağlama yüksekliği', amountDefault: 0.6 },
};

export const CATALOG: CurtainItem[] = [
  { id: 'fon-keten', name: 'Fon Keten', family: 'fon', fabric: 'linen', repeatCm: 8, defaultColor: '#c9b9a0', opacity: 1 },
  { id: 'fon-kadife', name: 'Fon Kadife', family: 'fon', fabric: 'velvet', repeatCm: 10, defaultColor: '#5b2c3c', opacity: 1 },
  { id: 'fon-cizgili', name: 'Fon Çizgili', family: 'fon', fabric: 'stripe', repeatCm: 24, defaultColor: '#34495e', opacity: 1 },
  { id: 'fon-damask', name: 'Fon Damask', family: 'fon', fabric: 'damask', repeatCm: 32, defaultColor: '#b08d57', opacity: 1 },
  { id: 'tul-duz', name: 'Tül Düz', family: 'tul', fabric: 'sheer', repeatCm: 4, defaultColor: '#f4f1ea', opacity: 0.45 },
  { id: 'tul-keten', name: 'Tül Keten Dokulu', family: 'tul', fabric: 'linen', repeatCm: 6, defaultColor: '#ece5d8', opacity: 0.6 },
  { id: 'stor-duz', name: 'Stor Düz', family: 'stor', fabric: 'linen', repeatCm: 10, defaultColor: '#d8d2c8', opacity: 1 },
  { id: 'stor-ekose', name: 'Stor Ekose', family: 'stor', fabric: 'check', repeatCm: 20, defaultColor: '#6b7d5c', opacity: 1 },
  { id: 'zebra', name: 'Zebra', family: 'zebra', fabric: 'linen', repeatCm: 8, defaultColor: '#e6dfd2', opacity: 1 },
  { id: 'jaluzi-ahsap', name: 'Jaluzi Ahşap', family: 'jaluzi', fabric: 'wood', repeatCm: 30, defaultColor: '#8b5a2b', opacity: 1 },
  { id: 'jaluzi-aluminyum', name: 'Jaluzi Alüminyum', family: 'jaluzi', fabric: 'metal', repeatCm: 20, defaultColor: '#bfc4c9', opacity: 1 },
  { id: 'kruvaze-klasik', name: 'Kruvaze Klasik', family: 'kruvaze', fabric: 'velvet', repeatCm: 10, defaultColor: '#7a1f2b', opacity: 1 },
  { id: 'kruvaze-tul', name: 'Kruvaze Tül', family: 'kruvaze', fabric: 'sheer', repeatCm: 4, defaultColor: '#f2eee6', opacity: 0.5 },
];

export const PALETTE: { name: string; hex: string }[] = [
  { name: 'Kırık beyaz', hex: '#f2eee6' },
  { name: 'Krem', hex: '#e8dcc4' },
  { name: 'Bej', hex: '#c9b9a0' },
  { name: 'Vizon', hex: '#9c8a78' },
  { name: 'Açık gri', hex: '#c4c6c8' },
  { name: 'Antrasit', hex: '#3d4045' },
  { name: 'Lacivert', hex: '#23324f' },
  { name: 'Petrol', hex: '#1f5560' },
  { name: 'Adaçayı', hex: '#8fa58a' },
  { name: 'Zeytin', hex: '#6b6b3a' },
  { name: 'Hardal', hex: '#c8962e' },
  { name: 'Kiremit', hex: '#b5583a' },
  { name: 'Gül kurusu', hex: '#c08b8b' },
  { name: 'Bordo', hex: '#7a1f2b' },
  { name: 'Mürdüm', hex: '#5b2c3c' },
  { name: 'Ceviz', hex: '#6b4429' },
];
