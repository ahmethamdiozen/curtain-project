# 3B Perde ve Fotoğrafa Uydurma — Tasarım (Spec)

Tarih: 2026-10-09 · Durum: onaylandı (sohbette, yaklaşım B) · Önceki: `2026-10-09-perde-giydirme-design.md`

## Sorun

Kullanıcı geri bildirimi: perde "Paint'le yapıştırılmış" gibi, ortama uymuyor. Teşhis:
1. Kıvrımlar sadece ton dalgası; ışık yönü pencereyle ilişkisiz.
2. Silüet kusursuz dikdörtgen (dalgalı kenar, tırtıllı etek, toplanmış üst yok).
3. Ortamla etkileşim yok: duvara/zemine gölge, korniş altı karartma, pencere tarafında ışık yok.
4. Ton/renk sahneye uymuyor (siyah seviyesi 14 vs fotoğraf 1, beyaz dengesi yok, gren yok).
5. Derinlik yok — perde duvar düzlemine boyanmış.

## Çözüm (yaklaşım B)

Perde gerçek 3B mesh olarak, fotoğraftan çıkarılan kamera pozuyla three.js'te çizilir; sonra
fotoğrafın ışık/ton/gren istatistikleriyle uydurularak maskelerle kompozit edilir.

### 1. Kamera pozu (`packages/engine/src/pose.ts`)
- Dünya: cm; duvar z=0, pencere `[0,W]×[0,H]`, x sağ, y aşağı, oda z<0 (kamera tarafı).
- `K⁻¹·H = λ[r1 r2 t]`, λ = 2/(‖K⁻¹h1‖+‖K⁻¹h2‖), işaret t_z>0 olacak şekilde; r3 = r1×r2;
  R SVD ile ortonormalleştirilir. Kamera koordinatı OpenCV (x sağ, y aşağı, z ileri).
- three.js: görünüm = diag(1,−1,−1)·[R|t]; projeksiyon K'den (asal nokta görüntü merkezi).
- Test: sentetik kamera → 4 köşe geri izdüşümü ≤ 0.5 px; R ortonormal; kamera duvarın önünde.

### 2. Geometri (`drape.ts`, saf fonksiyonlar; pozisyon/uv/indeks dizileri)
- Ortak: korniş y=−12, perde üstü y=−10, duvar boşluğu 12 cm (z≈−12), etek = zemin − 1.5 cm.
- Kıvrım profili: tohumlu, genişliği 0.7–1.3×P değişen yarım dalgalar; derinlik yukarıda
  0.6×, aşağıda 1.2× (açılma); panel aşağıda %5 genişler; etek tırtıllı (kıvrım fazına bağlı).
- UV: satır boyunca kümülatif yay uzunluğu (cm) → desen kıvrıma girer.
- Aileler: fon (2 panel, P≈11, A≈4.5), tül (tam genişlik, P≈7, A≈2.5, opaklık), stor (düz,
  z=−4, kaset + alt çıta), zebra (stor + bant opaklığı), jaluzi (lameller 25° eğik, 4.5 cm aralık,
  ip merdiven), kruvaze (panel iç kenarı bağlama noktasına toplanır; kıvrım fazı panel içi
  normalize konumdan → kıvrımlar toplanır; bağ bandı).
- Donanım: korniş borusu + uç topları + halkalar (fon/tül/kruvaze).

### 3. Zemin çizgisi (`floor.ts`)
- Pencere altından aşağı cm adımlarla yürüyerek, üstü surface, altı limit olan geçişi arar;
  arada occluder varsa o sütun atlanır; medyan. Bulunamazsa H + 150 cm.

### 4. Işık ve gölge
- Işık birimleri: kameraya bakan albedo=1 yüzey ≈ 1 ışınım alır; kompozitte
  `exposure = wallLum / 0.7` ile fotoğraf seviyesine ölçeklenir, × gölge haritası S.
- Pencere spot ışığı (pencere merkezi, z=−5, odaya doğru), oda ışığı (kamera üstü/yanı,
  yumuşak gölge yayan directional), yarıküre ortam ışığı.
- Gölge yakalayıcılar: duvar (z=0) ve zemin düzlemi (ShadowMaterial) ayrı render hedefine.
- Arka aydınlanma: pencere maskesi üstündeki kumaş, fotoğraftaki arka parlaklıkla × geçirgenlik.
- Materyal: MeshPhysicalMaterial; renk LAB'den shader enjeksiyonuyla (anında değişim);
  dokudan bump; kadife sheen, metal metalness.

### 5. Fotoğrafa uydurma (sunucu `light` istatistikleri + kompozit)
- Sunucu: `light = { wallRgb (doğrusal ort.), wallLum (medyan), windowLum, blackLum (p1),
  whiteLum (p99), noiseSigma (8-bit, duvar yüksek-geçiren MAD) }`.
- Kompozit: beyaz dengesi (duvar kromasının %60'ı), exposure, siyah nokta tabanı, gren
  (σ eşleşmeli), MSAA kenarlar; occluder/limit maskeleri korunur; gölge yalnızca
  occluder olmayan piksellere.

### Değişmeyenler
Maskeler, anında renk, köşe düzeltme, statik demo, engine'in React'ten bağımsızlığı
(three.js `{canvas, context}` ile; mobilde expo-gl).

## Test
- vitest: poz, geometri sınırları/UV/etek, zemin çizgisi, renk/uydurma matematiği.
- pytest: light istatistikleri (sentetik gürültü/renk), API şeması.
- Playwright: 5 örnek × aileler; gerçek perdeyle siyah seviyesi/gren karşılaştırması.
