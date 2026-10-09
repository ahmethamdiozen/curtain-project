# Perde Giydirme — Tasarım (Spec)

Tarih: 2026-10-09 · Durum: onaylandı (bölüm 1 ve yaklaşım A sohbette onaylandı; kalan bölümler "tüm fazları tamamla" talimatıyla yürütülüyor)

## 1. Amaç ve kapsam

Ticari ürün (perde satıcısı). Kullanıcı odasının fotoğrafını yükler, perde tipini/desenini seçer,
perde fotoğrafa gerçekçi biçimde yerleştirilir, renk anında değiştirilir.

Başarı ölçütleri:
- Perde duvar düzlemine perspektif-doğru oturur; desen gerçek ölçüde (cm) tekrar eder.
- Öndeki eşyalar (koltuk, masa, bitki…) perdenin önünde kalır.
- Duvardaki ışık/gölge perdeye aktarılır.
- Renk/köşe/perde değişimi sunucuya gitmeden, etkileşimli hızda (≤ 1 kare) güncellenir.
- Önce web (React + TS); mobil (React Native) aynı API ve aynı `engine` paketini kullanır.

Kapsam dışı (ilk sürüm): mevcut perdenin silinmesi (inpainting), çoklu pencereye aynı anda perde,
gerçek ürün kataloğu (placeholder dokular kullanılır), kullanıcı hesabı/kayıt, fiyatlandırma.

## 2. Mimari (Yaklaşım A: sunucu analiz eder, istemci render eder)

```
[Tarayıcı / Mobil]                                   [Sunucu: FastAPI + PyTorch]
 foto yükle ──── POST /api/analyze (multipart) ───▶  EXIF düzelt → çalışma çözünürlüğü
                                                     SegFormer-B5 (ADE20K) → logit
                                                     → grup maskeleri (soft)
                                                     → pencere köşe önerileri
                                                     → gölge haritası
 ◀────────────── "sahne paketi" (JSON) ────────────  → EXIF odak uzaklığı (px)
 engine (saf TS):
   köşeler + en(cm) + odak → en/boy → homografi (cm ⇄ px)
   WebGL2 shader: perde tipi(cm uzayı) → desen → LAB renk → pile gölgesi
                  → duvar gölge haritası → occluder/sınır maskesi → kompozit
```

Model fotoğraf başına **bir kez** çalışır. Köşe sürükleme, perde/desen/renk değişimi tamamen istemcide.

### Repo yapısı
```
server/                 Python 3.12, FastAPI
  curtain_server/       kütüphane: segmentation, groups, windows, shading, api
  scripts/              segment_visualize.py (faz 1 CLI)
  tests/
packages/engine/        saf TS (DOM/React bağımsız; WebGL2 context dışarıdan verilir)
apps/web/               React + Vite + TS
assets/samples/         açık lisanslı test fotoğrafları (+ CREDITS.md)
assets/fabrics/         placeholder kumaş dokuları (gri tonlu, tekrarlanabilir)
```

## 3. Segmentasyon ve maskeler (onaylandı)

- Model: `nvidia/segformer-b5-finetuned-ade-640-640`. Cihaz: cuda → mps → cpu.
- Ön işleme: EXIF transpose; çalışma çözünürlüğü uzun kenar ≤ 1280 px (tüm maskeler ve istemci bu
  çözünürlükte çalışır); model girdisi kısa kenar 640, en/boy korunarak, 32'nin katına yuvarlanır;
  ImageNet normalizasyonu.
- Logit'ler çalışma çözünürlüğüne bilinear büyütülür, **sonra** argmax/softmax alınır.
- Sınıf ID'leri koda yazılmaz; `model.config.id2label` adıyla eşlenir.
- Gruplar (soft maske = gruptaki sınıfların softmax olasılık toplamı):
  - **surface** (perde üstünü örter): wall, windowpane, curtain, blind, painting, mirror, radiator, column, …
  - **limit** (perde burada kesilir): floor, ceiling
  - **occluder**: surface ∪ limit dışındaki her şey
  - **window** (surface alt kümesi): windowpane, blind
  - **curtain** (bilgi amaçlı, mevcut perde uyarısı için): curtain
- Mevcut perde silinmez; `curtain` oranı eşik üstündeyse istemci uyarı gösterir.

## 4. Geometri

- **Köşe önerisi (sunucu):** window maskesi (p>0.5) → morfolojik kapama → bağlı bileşenler
  (alan ≥ %0.5) → her bileşen için konveks zarf → `approxPolyDP` ile 4 köşe (epsilon artırılarak);
  olmazsa `minAreaRect`. Köşe sırası her yerde **TL, TR, BR, BL** (saat yönü, görüntü px).
  En büyük bileşen varsayılan; tüm adaylar döner, istemci seçtirebilir.
- **Kullanıcı düzeltmesi (istemci):** 4 köşe sürüklenebilir.
- **Ölçek:** kullanıcı pencere enini cm girer (varsayılan 120).
- **En/boy oranı:** Zhang & He (dikdörtgen + bilinen odak) yöntemiyle köşelerden tahmin.
  Odak: EXIF `FocalLengthIn35mmFilm` → `f_px = f35 / 43.27 × köşegen_px`; yoksa f35 = 26 mm
  (tipik telefon ana kamerası). Tahmin sayısal olarak bozuksa (dejenere/yakın-cephe) piksel
  en/boy oranına düşülür. Kullanıcı boyu elle girerse o kullanılır.
- **Homografi:** pencere dikdörtgeni cm uzayında `[0,W]×[0,H]` (y aşağı) → 4 köşe. DLT ile 3×3 H,
  shader'a `H⁻¹` (px → cm) verilir. Tüm perde geometrisi **cm uzayında** tanımlanır.
- **Düşey sınırlar:** perde üstü korniş hattından (pencere üstü −15 cm) başlar, aşağı doğru sınırsız
  uzanır ve `limit` maskesi (zemin/tavan) ile kesilir — zemin görünmüyorsa görüntü sonuna iner.

## 5. Gölge haritası (sunucu)

- Çalışma görüntüsünün LAB L kanalı; geçerli bölge = surface ∧ ¬window ∧ ¬curtain (p>0.5).
- 1/8 çözünürlükte geçersiz bölgeler doldurulur (cv2.inpaint), Gauss bulanıklığı
  (σ ≈ uzun kenarın %1.5'i), çalışma çözünürlüğüne büyütülür.
- Normalizasyon: `S = L_smooth / median(L_smooth | geçerli)`, [0, 2] aralığına kırpılır,
  8 bit PNG olarak `S × 127.5` kodlanır. Shader'da doğrusal RGB'de çarpan olarak uygulanır.

## 6. Perde aileleri (istemci, GLSL, cm uzayı)

Ortak sözleşme: `familyEval(cm) → { alpha, fabricUV(cm), shade, opacity }`.

| Aile | Katalog örnekleri | Geometri |
|---|---|---|
| fon | Fon keten, Fon kadife, Fon çizgili | İki yan panel; dış kenar pencereden 20 cm taşar, panel eni ≈ pencerenin %35'i + taşma; pile periyodu ~11 cm (gürültülü), kosinüs gölge; opak |
| tul | Tül düz, Tül keten dokulu | Tüm genişlik (±15 cm), ince pile (~7 cm), opaklık ~0.45 |
| stor | Stor düz, Stor desenli | Pencere çerçevesi ±5 cm, üstte rulo bandı, iniş oranı (varsayılan %70), alt çıta |
| zebra | Zebra | Stor geometrisi + 7.5 cm'lik opak/şeffaf bantlar |
| jaluzi | Jaluzi ahşap, Jaluzi alüminyum | 5 cm lameller, silindirik lamel gölgesi, aralarda dar boşluk |
| kruvaze | Kruvaze klasik, Kruvaze tül | İki panel, iç kenar bağlama yüksekliğinde (%60 H) dışa çekilir (yumuşak eğri); pile fazı panel içindeki normalize konumdan (u ∈ [0,1]) hesaplanır → pileler bağlama noktasında toplanır (analitik deformasyon, mesh yok); bağ bandı |

Kenarlarda `fwidth` ile kenar yumuşatma.

## 7. Renk (LAB)

- Kumaş dokuları gri tonlu detay haritalarıdır (desen = parlaklık değişimi).
- Hedef renk sRGB hex → LAB. Çıktı: `a,b = hedef a,b`; `L = L_hedef + k·(L_doku − L_doku_ort)`
  (detay korunur, ortalama parlaklık hedefe gider). Sonra LAB → doğrusal RGB; pile gölgesi ve
  duvar gölge haritası doğrusal RGB'de çarpılır; occluder/limit maskesiyle alfa kompozit; sRGB çıktı.
- Renk değişimi yalnızca uniform günceller — model ve sunucu çağrısı yok.

## 8. API sözleşmesi

`POST /api/analyze` (multipart `file`) →
```json
{
  "width": 1280, "height": 960,
  "image": "data:image/jpeg;base64,...",          // EXIF düzeltilmiş çalışma görüntüsü
  "masks": { "occluder": "data:image/png;...", "limit": "...", "window": "...",
             "surface": "...", "curtain": "..." },   // 8 bit soft maskeler
  "shading": "data:image/png;...",
  "windows": [ { "corners": [[x,y]×4], "areaFrac": 0.08 } ],  // büyükten küçüğe, TL,TR,BR,BL
  "focalPx": 1234.5, "focalSource": "exif" | "default",
  "classStats": [ { "label": "wall", "frac": 0.41 } ],
  "existingCurtainFrac": 0.0,
  "timingsMs": { "inference": 812, "total": 1290 }, "device": "mps"
}
```
`GET /api/health` → `{ "ok": true, "device": "mps", "model": "..." }`.
Hatalar: 400 (görüntü okunamadı), 413 (> 20 MB).

## 9. Web uygulaması

Akış: yükle (veya örnek seç) → analiz (yükleniyor durumu) → editör.
Editör: WebGL kanvas + SVG köşe tutamakları (köşe düzenleme modu) · sağ panel: perde kataloğu
(aileye göre gruplu, 12 öğe), renk paleti (+ serbest renk seçici), pencere eni (cm), tahmini boy
(elle geçersiz kılınabilir), aileye özel ayar (stor iniş oranı, fon açıklığı), "önce/sonra"
karşılaştırma (basılı tut), maske görünümü (hata ayıklama), PNG indir, mevcut perde uyarısı.

## 10. Hata durumları

- Pencere bulunamazsa: görüntü ortasında varsayılan dikdörtgen önerilir, kullanıcı düzeltmeye yönlendirilir.
- Köşeler konveks değilse/kendini kesiyorsa: render durdurulmaz, uyarı gösterilir, son geçerli H kullanılır.
- En/boy tahmini dejenere: piksel oranına düşülür, `aspectSource = "pixel"` gösterilir.
- WebGL2 yoksa: açık hata mesajı.
- Sunucu hatası: kullanıcıya tekrar dene.

## 11. Test

- Sunucu (pytest): grup eşleme, EXIF döndürme, maske boyutları, köşe sıralama/çıkarma (sentetik
  maskeler), gölge haritası normalizasyonu, API sözleşmesi (model sahte/mock), gerçek modelle smoke test (işaretli).
- Engine (vitest): homografi (bilinen dönüşüm, ters), Zhang–He en/boy (sentetik kamera projeksiyonu),
  LAB ↔ sRGB gidiş-dönüş, katalog bütünlüğü.
- Uçtan uca: örnek fotoğraflarla sunucu + web çalıştırılıp tarayıcıda görsel doğrulama.

## 12. Fazlar

1. Segmentasyon kütüphanesi + `segment_visualize.py` (maske panelleri) — örnek fotoğraflar.
2. Analiz pipeline'ı (köşe, gölge, odak) + FastAPI.
3. `engine`: homografi, en/boy, LAB, katalog, WebGL renderer + 6 aile shader'ı.
4. Web uygulaması: yükleme, editör, köşe düzenleme, katalog/renk paneli, indirme.
5. Uçtan uca doğrulama ve ince ayar.
6. (Sonra) Mobil: React Native + aynı engine (expo-gl), aynı API.
