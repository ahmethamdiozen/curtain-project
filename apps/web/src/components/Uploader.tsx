import { useEffect, useRef, useState } from 'react';
import { assetUrl, listSamples, UPLOAD_ENABLED } from '../api';

interface Props {
  busy: boolean;
  error: string | null;
  onFile: (file: Blob, name: string) => void;
  onSample: (name: string) => void;
}

export function Uploader({ busy, error, onFile, onSample }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [samples, setSamples] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    listSamples().then(setSamples);
  }, []);

  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f, f.name);
  };

  return (
    <div className="uploader">
      <div
        className={`dropzone${drag ? ' is-drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (UPLOAD_ENABLED) take(e.dataTransfer.files);
        }}
      >
        <h1>Perdeyi duvarınızda görün</h1>
        <p>
          Pencerenin bulunduğu duvarı karşıdan çekin. Önündeki koltuk, masa ya da bitki sorun değil,
          perdenin önünde kalacaklar.
        </p>
        {UPLOAD_ENABLED ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Fotoğraf inceleniyor…' : 'Fotoğraf seç'}
          </button>
        ) : (
          <p className="demo-note">
            Bu demo sürümünde kendi fotoğrafınızı yükleyemezsiniz, aşağıdaki örnek odalarla deneyin.
          </p>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => take(e.target.files)}
        />
        {UPLOAD_ENABLED && <span className="hint">ya da fotoğrafı buraya sürükleyin</span>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {samples.length > 0 && (
        <div className="samples">
          <h2>{UPLOAD_ENABLED ? 'Elinizde fotoğraf yoksa bir örnekle deneyin' : 'Bir örnek oda seçin'}</h2>
          <div className="sample-row">
            {samples.map((s) => (
              <button key={s} className="sample" disabled={busy} onClick={() => onSample(s)}>
                <img src={assetUrl(`samples/thumbs/${s}`)} alt={`Örnek oda: ${s.replace('.jpg', '')}`} loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
