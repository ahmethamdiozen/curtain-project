import { useMemo, useRef, useState } from 'react';
import {
  buildGeometry,
  CATALOG,
  findFloorCm,
  FAMILIES,
  isConvexQuad,
  type CurtainItem,
  type Family,
  type Geometry,
  type Quad,
  type RenderMode,
} from '@curtain/engine';
import { analyzePhoto, analyzeSample, type LoadedScene } from './api';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { Uploader } from './components/Uploader';

const DEFAULT_WIDTH_CM = 120;
const initialAmounts = Object.fromEntries(
  (Object.keys(FAMILIES) as Family[]).map((f) => [f, FAMILIES[f].amountDefault]),
) as Record<Family, number>;

export default function App() {
  const [scene, setScene] = useState<LoadedScene | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowIndex, setWindowIndex] = useState(0);
  const [corners, setCorners] = useState<Quad | null>(null);
  const [widthCm, setWidthCm] = useState(DEFAULT_WIDTH_CM);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [item, setItem] = useState<CurtainItem>(CATALOG[0]);
  const [colorHex, setColorHex] = useState(CATALOG[0].defaultColor);
  const [colorTouched, setColorTouched] = useState(false);
  const [amounts, setAmounts] = useState(initialAmounts);
  const [editCorners, setEditCorners] = useState(false);
  const [mode, setMode] = useState<RenderMode>('render');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastGeometry = useRef<Geometry | null>(null);

  const analyze = async (load: () => Promise<LoadedScene>) => {
    setBusy(true);
    setError(null);
    try {
      const s = await load();
      setScene(s);
      setWindowIndex(0);
      setCorners(s.data.windows[0].corners);
      setHeightCm(null);
      setEditCorners(s.data.windows[0].fallback);
      lastGeometry.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const geometry = useMemo(() => {
    if (!scene || !corners) return null;
    const g = buildGeometry({
      corners,
      widthCm,
      heightCm,
      focalPx: scene.data.focalPx,
      imageSize: [scene.data.width, scene.data.height],
    });
    if (g) lastGeometry.current = g;
    return g ?? lastGeometry.current;
  }, [scene, corners, widthCm, heightCm]);

  // Wall–floor junction in window cm; when the floor isn't visible the curtain runs past the frame.
  const floorY = useMemo(() => {
    if (!scene || !geometry) return 0;
    const found = findFloorCm(scene.masks, geometry.cmToPx, geometry.widthCm, geometry.heightCm);
    return found ?? geometry.heightCm + 150;
  }, [scene, geometry]);

  if (!scene || !corners) {
    return (
      <main className="app app-empty">
        <Uploader
          busy={busy}
          error={error}
          onFile={(f, n) => analyze(() => analyzePhoto(f, n))}
          onSample={(n) => analyze(() => analyzeSample(n))}
        />
      </main>
    );
  }

  const d = scene.data;
  const cornersInvalid = !isConvexQuad(corners);
  const win = d.windows[windowIndex];

  const download = () => {
    canvasRef.current?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `perde-${item.id}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };

  return (
    <main className="app">
      <section className="stage">
        <header className="stage-bar">
          <button className="btn btn-ghost" onClick={() => setScene(null)}>
            Yeni fotoğraf
          </button>
          {d.windows.length > 1 && (
            <label className="window-pick">
              Pencere
              <select
                value={windowIndex}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setWindowIndex(i);
                  setCorners(d.windows[i].corners);
                }}
              >
                {d.windows.map((_, i) => (
                  <option key={i} value={i}>
                    {i + 1}. pencere
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        <Stage
          scene={scene}
          state={{ geometry, item, colorHex, amount: amounts[item.family], floorY, mode }}
          corners={corners}
          editCorners={editCorners}
          cornersInvalid={cornersInvalid}
          onCorners={setCorners}
          canvasRef={canvasRef}
        />

        <div className="messages" aria-live="polite">
          {win.fallback && (
            <p className="msg msg-warn">Pencere bulunamadı. Köşeleri pencerenin dört köşesine sürükleyin.</p>
          )}
          {cornersInvalid && (
            <p className="msg msg-warn">Köşeler kesişiyor. Sıra sol üst, sağ üst, sağ alt, sol alt olmalı.</p>
          )}
          {d.existingCurtainFrac > 0.02 && (
            <p className="msg">
              Fotoğrafta mevcut bir perde var. Yeni perde onu tamamen kapatmazsa kenarlarda görünmeye devam eder.
            </p>
          )}
        </div>

        <footer className="toolbar">
          <button
            className={`btn${editCorners ? ' btn-on' : ''}`}
            aria-pressed={editCorners}
            onClick={() => setEditCorners((v) => !v)}
          >
            {editCorners ? 'Köşeleri onayla' : 'Köşeleri düzelt'}
          </button>
          <button
            className="btn"
            onPointerDown={() => setMode('original')}
            onPointerUp={() => setMode('render')}
            onPointerLeave={() => mode === 'original' && setMode('render')}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setMode('original')}
            onKeyUp={() => setMode('render')}
          >
            Basılı tut: perdesiz
          </button>
          <button
            className={`btn${mode === 'masks' ? ' btn-on' : ''}`}
            aria-pressed={mode === 'masks'}
            onClick={() => setMode((m) => (m === 'masks' ? 'render' : 'masks'))}
          >
            Algılanan eşyalar
          </button>
          <button className="btn btn-primary" onClick={download}>
            Görseli indir
          </button>
        </footer>
      </section>

      <Sidebar
        item={item}
        colorHex={colorHex}
        amount={amounts[item.family]}
        widthCm={widthCm}
        heightCm={heightCm}
        geometry={geometry}
        onItem={(it) => {
          setItem(it);
          if (!colorTouched) setColorHex(it.defaultColor);
        }}
        onColor={(hex) => {
          setColorHex(hex);
          setColorTouched(true);
        }}
        onAmount={(v) => setAmounts((a) => ({ ...a, [item.family]: v }))}
        onWidth={setWidthCm}
        onHeight={setHeightCm}
      />
    </main>
  );
}
