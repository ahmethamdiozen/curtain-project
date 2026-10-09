import { useEffect, useRef, useState } from 'react';
import { CurtainRenderer, FABRICS, type Geometry, type Quad, type RenderState } from '@curtain/engine';
import { assetUrl, loadImage, type LoadedScene } from '../api';
import { CornerHandles } from './CornerHandles';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const PLACEHOLDER_GEOMETRY: Geometry = {
  widthCm: 1, heightCm: 1, aspectSource: 'pixel', cmToPx: IDENTITY, pxToCm: IDENTITY,
};

interface Props {
  scene: LoadedScene;
  state: Omit<RenderState, 'geometry'> & { geometry: Geometry | null };
  corners: Quad;
  editCorners: boolean;
  cornersInvalid: boolean;
  onCorners: (q: Quad) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function Stage({ scene, state, corners, editCorners, cornersInvalid, onCorners, canvasRef }: Props) {
  const renderer = useRef<CurtainRenderer | null>(null);
  const [fabricsReady, setFabricsReady] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const { width, height } = scene.data;

  // Create the renderer once per canvas and load all fabric tiles.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) {
      setGlError('Tarayıcınız WebGL2 desteklemiyor. Güncel Chrome, Safari ya da Firefox ile açın.');
      return;
    }
    let r: CurtainRenderer;
    try {
      r = new CurtainRenderer(canvas, gl);
    } catch (e) {
      setGlError(`Görüntüleyici başlatılamadı: ${(e as Error).message}`);
      return;
    }
    renderer.current = r;
    let alive = true;
    Promise.all(FABRICS.map((id) => loadImage(assetUrl(`fabrics/${id}.png`)).then((img) => alive && r.setFabric(id, img))))
      .then(() => alive && setFabricsReady(true))
      .catch((e) => setGlError((e as Error).message));
    return () => {
      alive = false;
      r.dispose();
      renderer.current = null;
    };
  }, [canvasRef]);

  useEffect(() => {
    renderer.current?.setScene({
      width,
      height,
      photo: scene.photo,
      occluder: scene.occluder,
      limit: scene.limit,
      window: scene.window,
      shading: scene.shading,
      focalPx: scene.data.focalPx,
      light: scene.data.light,
    });
  }, [scene, width, height, fabricsReady]);

  useEffect(() => {
    if (!fabricsReady) return;
    // Without a usable window quad there is no curtain to place; still show the photo.
    const next: RenderState = state.geometry
      ? { ...state, geometry: state.geometry }
      : { ...state, geometry: PLACEHOLDER_GEOMETRY, mode: 'original' };
    if (import.meta.env.DEV) {
      // Debug hook for headless visual checks: window.__curtain.rerender()
      (window as unknown as Record<string, unknown>).__curtain = { renderer: renderer.current, rerender: () => renderer.current?.render(next) };
    }
    const id = requestAnimationFrame(() => renderer.current?.render(next));
    return () => cancelAnimationFrame(id);
  });

  return (
    <div
      className="stage-frame"
      style={{ aspectRatio: `${width} / ${height}`, ['--ratio' as string]: width / height }}
    >
      <canvas ref={canvasRef} width={width} height={height} aria-label="Perde uygulanmış oda fotoğrafı" />
      {editCorners && (
        <CornerHandles width={width} height={height} corners={corners} invalid={cornersInvalid} onChange={onCorners} />
      )}
      {glError && <p className="stage-error" role="alert">{glError}</p>}
    </div>
  );
}
