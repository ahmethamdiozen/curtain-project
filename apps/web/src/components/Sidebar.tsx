import { CATALOG, FAMILIES, PALETTE, type CurtainItem, type Family, type Geometry } from '@curtain/engine';
import { assetUrl } from '../api';
import { MeasureInput } from './MeasureInput';

interface Props {
  item: CurtainItem;
  colorHex: string;
  amount: number;
  widthCm: number;
  heightCm: number | null;
  geometry: Geometry | null;
  onItem: (item: CurtainItem) => void;
  onColor: (hex: string) => void;
  onAmount: (v: number) => void;
  onWidth: (cm: number) => void;
  onHeight: (cm: number | null) => void;
}

const familyOrder = Object.keys(FAMILIES) as Family[];

function Swatch({ item, color, selected, onClick }: { item: CurtainItem; color: string; selected: boolean; onClick: () => void }) {
  return (
    <button className={`swatch${selected ? ' is-selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span className={`swatch-back${item.opacity < 1 ? ' is-sheer' : ''}`}>
        <span
          className="swatch-cloth"
          style={{
            backgroundColor: color,
            backgroundImage: `url(${assetUrl(`fabrics/${item.fabric}.png`)})`,
            backgroundSize: `${Math.max(18, item.repeatCm * 2.2)}px`,
            opacity: item.opacity < 1 ? 0.55 + item.opacity * 0.4 : 1,
          }}
        />
      </span>
      <span className="swatch-name">{item.name}</span>
    </button>
  );
}

export function Sidebar(p: Props) {
  const fam = FAMILIES[p.item.family];
  return (
    <aside className="sidebar">
      <section className="panel">
        <h2>Perde</h2>
        {familyOrder.map((f) => (
          <div key={f} className="family">
            <h3>{FAMILIES[f].name}</h3>
            <div className="swatch-row">
              {CATALOG.filter((c) => c.family === f).map((c) => (
                <Swatch
                  key={c.id}
                  item={c}
                  color={c.id === p.item.id ? p.colorHex : c.defaultColor}
                  selected={c.id === p.item.id}
                  onClick={() => p.onItem(c)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Renk</h2>
        <div className="palette" role="radiogroup" aria-label="Renk">
          {PALETTE.map((c) => (
            <button
              key={c.hex}
              role="radio"
              aria-checked={p.colorHex === c.hex}
              className={`chip${p.colorHex === c.hex ? ' is-selected' : ''}`}
              style={{ backgroundColor: c.hex }}
              title={c.name}
              aria-label={c.name}
              onClick={() => p.onColor(c.hex)}
            />
          ))}
          <label className="chip chip-custom" title="Özel renk">
            <input type="color" value={p.colorHex} onChange={(e) => p.onColor(e.target.value)} aria-label="Özel renk seç" />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Ölçüler</h2>
        <label className="tape">
          <span>Pencere eni</span>
          <span className="tape-field">
            <MeasureInput label="Pencere eni (cm)" value={p.widthCm} min={30} max={600} onCommit={(v) => v && p.onWidth(v)} />
            cm
          </span>
        </label>
        <label className="tape">
          <span>Pencere boyu</span>
          <span className="tape-field">
            <MeasureInput
              label="Pencere boyu (cm)"
              value={p.heightCm}
              min={30}
              max={400}
              optional
              placeholder={p.geometry ? String(Math.round(p.geometry.heightCm)) : ''}
              onCommit={p.onHeight}
            />
            cm
          </span>
        </label>
        <p className="note">
          {p.heightCm
            ? 'Boyu siz girdiniz. Silerseniz fotoğraftan tahmin edilir.'
            : p.geometry?.aspectSource === 'estimated'
              ? 'Boy, fotoğraftaki perspektiften tahmin edildi. Biliyorsanız yazın.'
              : 'Boy, köşelerin oranından hesaplandı. Biliyorsanız yazın.'}
        </p>
        {fam.amountLabel && (
          <label className="slider">
            <span>{fam.amountLabel}</span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={p.amount}
              onChange={(e) => p.onAmount(Number(e.target.value))}
            />
          </label>
        )}
      </section>
    </aside>
  );
}
