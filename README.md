# Perde Prova

Odanızın fotoğrafını yükleyin, perde tipini ve rengini seçin; perde duvara perspektif-doğru,
gerçek ölçekte, odanın ışığıyla ve öndeki eşyaların arkasında kalacak şekilde yerleşir.

**Demo:** https://ahmethamdiozen.github.io/curtain-project/ — örnek odalarla çalışır (analizler
önceden hesaplanmıştır). Kendi fotoğrafınızı denemek için analiz sunucusunu yerelde çalıştırın.

## Nasıl çalışır

- **Sunucu** (`server/`, Python + FastAPI): SegFormer-B5 (ADE20K) ile duvar, pencere, öndeki eşyalar
  ve zemin/tavan maskelerini çıkarır; pencere köşelerini önerir; duvardan gölge haritası hesaplar.
  Fotoğraf başına bir kez çalışır.
- **Motor** (`packages/engine/`, saf TypeScript): köşeler + pencere eni → homografi; perdeyi cm
  uzayında 6 aile (fon, tül, stor, zebra, jaluzi, kruvaze) olarak WebGL2'de çizer; rengi LAB'de
  parlaklığı koruyarak uygular. React'e bağımlı değildir, mobilde de kullanılacak.
- **Web** (`apps/web/`, React + Vite): yükleme, köşe düzeltme, kumaş kartelası, renk, ölçüler.

Mimari ve kurallar: [CLAUDE.md](CLAUDE.md) · Tasarım: [docs/superpowers/specs](docs/superpowers/specs/)

## Yerelde çalıştırma

```bash
python3.12 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
(cd server && .venv/bin/uvicorn curtain_server.api:app --port 8000)   # ilk açılışta model iner (~340 MB)

npm install
npm run dev                                                          # http://localhost:5173
```

Statik demoyu yeniden üretmek: `cd server && .venv/bin/python -m scripts.export_demo`.
Statik build'i canlı bir sunucuya bağlamak: `VITE_API_URL=https://sunucu-adresi npm run build`.

## Testler

```bash
(cd server && .venv/bin/pytest && .venv/bin/pytest -m model)
npm test
```

Örnek fotoğrafların kaynak ve lisansları: [assets/samples/CREDITS.md](assets/samples/CREDITS.md).
Kumaş dokuları `server/scripts/gen_fabrics.py` ile üretilmiş yer tutuculardır.
