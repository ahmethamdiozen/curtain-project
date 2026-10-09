import type { LightStats, Mask, MaskSet, Quad } from '@curtain/engine';

/** Analysis server origin; empty = same origin (dev proxy). */
const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
/** Static build (GitHub Pages): samples come with precomputed scene packages in /demo. */
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';
/** Uploading a new photo needs a live analysis server. */
export const UPLOAD_ENABLED = !STATIC_DEMO || API_URL !== '';

/** Resolve a file from the public dir (assets/) against the deploy base path. */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export interface DetectedWindow {
  corners: Quad;
  areaFrac: number;
  fallback: boolean;
  source: 'window' | 'window+curtain' | 'fallback';
}

export interface SceneResponse {
  width: number;
  height: number;
  image: string;
  masks: Record<'occluder' | 'limit' | 'window' | 'surface' | 'curtain', string>;
  shading: string;
  windows: DetectedWindow[];
  focalPx: number;
  focalSource: 'exif' | 'default';
  classStats: { label: string; frac: number }[];
  existingCurtainFrac: number;
  /** Absent in scene packages exported before the 3D renderer. */
  light?: LightStats;
  timingsMs: { inference: number; total: number };
  device: string;
}

export interface LoadedScene {
  data: SceneResponse;
  photo: HTMLImageElement;
  occluder: HTMLImageElement;
  limit: HTMLImageElement;
  window: HTMLImageElement;
  shading: HTMLImageElement;
  /** CPU copies of the masks (floor-line detection). */
  masks: MaskSet;
}

function maskData(img: HTMLImageElement): Mask {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const data = new Uint8Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return { data, width: c.width, height: c.height };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Görsel yüklenemedi: ${src.slice(0, 60)}`));
    img.src = src;
  });
}

export async function analyzePhoto(file: Blob, name = 'photo.jpg'): Promise<LoadedScene> {
  const body = new FormData();
  body.append('file', file, name);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/analyze`, { method: 'POST', body });
  } catch {
    throw new Error('Analiz sunucusuna ulaşılamadı. Sunucunun 8000 portunda çalıştığını kontrol edin.');
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => null);
    throw new Error(detail ?? `Analiz başarısız oldu (HTTP ${res.status}).`);
  }
  return loadScene((await res.json()) as SceneResponse);
}

async function loadScene(data: SceneResponse): Promise<LoadedScene> {
  const [photo, occluder, limit, window, surface, shading] = await Promise.all([
    loadImage(data.image),
    loadImage(data.masks.occluder),
    loadImage(data.masks.limit),
    loadImage(data.masks.window),
    loadImage(data.masks.surface),
    loadImage(data.shading),
  ]);
  const masks: MaskSet = { surface: maskData(surface), limit: maskData(limit), occluder: maskData(occluder) };
  return { data, photo, occluder, limit, window, shading, masks };
}

export async function listSamples(): Promise<string[]> {
  try {
    const res = await fetch(STATIC_DEMO ? assetUrl('demo/index.json') : `${API_URL}/api/samples`);
    return res.ok ? ((await res.json()) as string[]) : [];
  } catch {
    return [];
  }
}

/** Analyze a bundled sample: precomputed in static builds, sent to the server otherwise. */
export async function analyzeSample(name: string): Promise<LoadedScene> {
  if (STATIC_DEMO) {
    const res = await fetch(assetUrl(`demo/${name.replace(/\.jpg$/, '')}.json`));
    if (!res.ok) throw new Error(`Örnek bulunamadı: ${name}`);
    return loadScene((await res.json()) as SceneResponse);
  }
  const img = await fetch(assetUrl(`samples/${name}`));
  if (!img.ok) throw new Error(`Örnek fotoğraf bulunamadı: ${name}`);
  return analyzePhoto(await img.blob(), name);
}
