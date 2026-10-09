# Perde Giydirme (curtain)

Kullanıcı odasının fotoğrafını yükler → perde tipi/desen seçer → perde duvara perspektif-doğru,
gerçek ölçekte, ışık/gölgesiyle yerleşir → renk anında değişir. Ticari ürün (perde satıcısı).
Önce web (React + TS), sonra mobil (React Native) — ikisi aynı API'yi ve aynı `packages/engine`'i kullanır.

Ayrıntılı tasarım: `docs/superpowers/specs/2026-10-09-perde-giydirme-design.md`

## Mimari (tek cümle)

Sunucu fotoğraf başına **bir kez** segmentasyon + analiz yapıp bir "sahne paketi" döner;
köşe düzeltme, perde/desen seçimi ve renk değişimi tamamen istemcide (WebGL2) çalışır.

```
server/ (Python 3.12, FastAPI, PyTorch)
  curtain_server/
    segmentation.py   SegFormer-B5 ADE20K → logit → sınıf haritası + grup olasılıkları
    groups.py         ADE20K etiket adı → grup (surface / limit / occluder / window / curtain)
    imageio.py        EXIF düzeltme, çalışma çözünürlüğü, odak uzaklığı (px)
    windows.py        pencere maskesi → 4 köşe önerisi (TL,TR,BR,BL)
    shading.py        duvar parlaklığından düşük frekanslı gölge haritası
    analyze.py        hepsini birleştirip sahne paketi üretir
    api.py            FastAPI: POST /api/analyze, GET /api/health
  scripts/segment_visualize.py   maskeleri panel olarak görselleştirir (faz 1)
packages/engine/ (saf TS — React/DOM bağımsız; three.js'e canvas+context dışarıdan verilir)
    homography.ts aspect.ts scene.ts   köşeler → homografi, en/boy
    pose.ts                            homografi + odak → kamera pozu (R, t)
    drape.ts                           perde mesh'leri (6 aile + korniş), saf diziler, fold AO
    floor.ts                           maskelerden duvar–zemin çizgisi (cm)
    matching.ts                        light istatistikleri → pozlama, beyaz dengesi
    renderer.ts  shaders/composite.ts  three.js: 3B perde → gölge yakalayıcılar → kompozit
apps/web/ (React + Vite + TS)  yükleme, editör, köşe tutamakları, katalog/renk paneli
assets/samples/  açık lisanslı test fotoğrafları (CREDITS.md'de atıflar)
assets/fabrics/  placeholder gri tonlu tekrarlanabilir kumaş dokuları (scripts ile üretilir)
assets/demo/     örneklerin önceden hesaplanmış sahne paketleri (statik Pages demosu)
```

### Pipeline
1. **imageio**: EXIF transpose → uzun kenar ≤ 1280 px çalışma görüntüsü. Sonraki her şey bu çözünürlükte.
2. **segmentation**: model girdisi kısa kenar 640 (oran korunur, 32'nin katı) → logit'ler çalışma
   çözünürlüğüne bilinear büyütülür → **sonra** argmax/softmax.
3. **groups**: grup soft maskesi = gruptaki sınıfların softmax toplamı.
   - `surface` perdenin arkasında kalır (wall, windowpane, curtain, blind, painting, mirror, radiator…)
   - `limit` perde burada kesilir (floor, ceiling)
   - `occluder` = surface ∪ limit dışındaki **her şey** (liste yazma; bilinmeyen nesne önde kalsın)
   - `window` ⊂ surface (windowpane, blind) — köşe tespiti için
   - `curtain` mevcut perde — silinmez, sadece uyarı
4. **windows**: en büyük pencere bileşeninden 4 köşe; tüm adaylar döner. Kullanıcı istemcide düzeltir.
5. **shading**: duvar L kanalı, geçersiz bölgeler doldurulur, bulanıklaştırılır, medyana bölünür → S ∈ [0,2].
6. **light** (sunucu): duvar rengi/parlaklığı, pencere parlaklığı, siyah/beyaz nokta, gren → `light`.
7. **engine (istemci)**: köşeler + en (cm) + odak → en/boy → homografi → kamera pozu. Perde gerçek
   3B mesh olarak (duvardan 12 cm önde, zemin çizgisine kadar) three.js'te çizilir: pencere ışığı,
   oda ışığı (duvar/zemine gölge), yarıküre ortam; renk LAB shader enjeksiyonu. Kompozit:
   pozlama × beyaz dengesi × gölge haritası, arkadan aydınlanma, siyah nokta, gren, maskeler.

## Kurallar (değişmez)

- **Sınıf ID'si sabit yazma.** ADE20K sınıfları her zaman `model.config.id2label` üzerinden **etiket adıyla** eşlenir.
- **EXIF yönü her girişte düzeltilir** (`ImageOps.exif_transpose`). Atlanırsa maskeler dönük çıkar.
- **Argmax/softmax büyütmeden sonra.** Logit'ler önce çalışma çözünürlüğüne büyütülür.
- **Occluder bir dışlama tanımıdır** (surface ∪ limit dışı). Yeni sınıf eklerken surface/limit listesini düzenle.
- **Köşe sırası her yerde TL, TR, BR, BL** (görüntü pikseli, y aşağı). Sunucu, engine ve UI aynı sırayı kullanır.
- **Perde geometrisi cm uzayında tanımlanır.** Pencere = `[0,W]×[0,H]` cm, y aşağı, duvar z=0, oda z<0. Piksel cinsinden perde ölçüsü yazma.
- **Aynalanan mesh'lerin sarım yönü çevrilir** (`flipWinding`); tüm kumaş yüzleri odaya bakar.
- **Işıklar katman 0'da;** gölge yakalayıcı geçişi (katman 2) için gölge düşüren ışık `layers.enable(2)` olmalı.
- **Işık yönü pencereden gelir:** ana ışığı pencerenin dışına koyma — yan panellerde kontrastı sıfırlar.
- **Renk değişimi sunucuya gitmez ve modeli tekrar çalıştırmaz.** LAB'de: a,b hedef renkten; L = hedef L + doku detayı.
  Işık işlemleri (pile gölgesi, gölge haritası) doğrusal RGB'de çarpılır.
- **`packages/engine` React/DOM'a bağımlı olamaz** (WebGL2 context dışarıdan verilir) — mobil aynı paketi kullanacak.
- **Sunucu tek sahne paketi döner**, ek uç noktalarla istemciyi sunucuya bağımlı etkileşimlere zorlama.
- Kumaş dokuları **gri tonludur**; renk her zaman LAB ile uygulanır (renkli doku ekleme).
- Kod, tanımlayıcılar ve yorumlar İngilizce; kullanıcıya görünen metinler Türkçe.
- Public dir dosyalarına (`fabrics/`, `samples/`, `demo/`) her zaman `assetUrl()` ile eriş — Pages alt dizinde yayınlanır.

## Komutlar

```bash
# Sunucu (ilk kurulum: python3.12 -m venv server/.venv)
cd server && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m scripts.gen_fabrics       # assets/fabrics/*.png placeholder dokuları üretir
.venv/bin/python -m scripts.segment_visualize ../assets/samples/*.jpg --out ../out/segviz
.venv/bin/uvicorn curtain_server.api:app --port 8000 --reload
.venv/bin/pytest                    # hızlı testler (model gerektirmez)
.venv/bin/pytest -m model           # gerçek modelle smoke test (ilk sefer ~340 MB indirir)

# Engine + web (repo kökünden, npm workspaces)
npm install
npm test -w packages/engine
npm run dev -w apps/web             # http://localhost:5173, /api → :8000 proxy; assets/ public dir
npm run build -w apps/web

# Statik demo (GitHub Pages, .github/workflows/pages.yml): örnekler assets/demo/*.json'dan okunur
cd server && .venv/bin/python -m scripts.export_demo      # analiz/maske değişince yeniden üret
VITE_BASE=/curtain-project/ VITE_STATIC_DEMO=true npm run build -w apps/web
```

## Notlar

- Shader birim testi yok (vitest'te WebGL yok); shader değişikliği tarayıcıda (headless Chromium +
  SwiftShader yeterli) örnek fotoğraflarla görsel olarak doğrulanır. Dev modda `window.__curtain`
  ({renderer, rerender}) ışık/gölge denemeleri için açıktır. three.js ShaderMaterial'da `glslVersion`
  verme (gl_FragColor uyumluluğu kaybolur).
- Gölge haritası yalnızca `wall`/`column` piksellerinden, doğrusal luminans oranıyla hesaplanır.
- Mevcut perde varsa köşe önerisi `window ∪ curtain` maskesinden çıkar ve yan kenarlar dışa doğru dikeyleştirilir.

- Model: `nvidia/segformer-b5-finetuned-ade-640-640`; cihaz cuda → mps → cpu.
- Odak: EXIF `FocalLengthIn35mmFilm` → `f_px = f35 / 43.27 × köşegen_px`; yoksa 26 mm varsayılır.
- Mevcut perdenin silinmesi (inpainting), çoklu pencere ve gerçek katalog ilk sürüm kapsamı dışında.
