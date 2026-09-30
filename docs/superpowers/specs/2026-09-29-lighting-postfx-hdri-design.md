# Faz 1 — Işık, post-processing ve HDRI

- **Tarih:** 2026-09-29
- **Durum:** Uygulandı (bkz. "Uygulama sonucu")
- **Dal:** `feat/visual-lighting-postfx` (`feat/real-3d-table-tennis` üzerinden)

## Bağlam

Frontend görsel iyileştirmesi üç ayrı alt projeye bölündü; her biri kendi
spec → plan → uygulama döngüsünden geçer:

1. **Faz 1 (bu belge):** ışık düzeni, post-processing, HDRI.
2. Faz 2: Blender'da masa, raket ve salon modelleri + ışık bake'i.
3. Faz 3: IK'li oyuncu karakterleri.

Bugünkü durum: sahne tamamen prosedürel Three.js (r179). Ortam ışığı
`RoomEnvironment` (0.3), ışıklar hemisphere + key + fill + iki spot, ACES tone
mapping, dokular canvas'ta çiziliyor. Post-processing ve ikili asset yok.
`low`/`high` kalite ayarı ve dokunmatik/dikey ekran desteği var.

## Hedef

- **Görünüm:** WTT yayın havası — tribünler karanlıkta, kort sahne gibi soğuk
  beyaz üst ışıkla aydınlık, güçlü kontrast, hafif bloom ve vinyet.
- **Performans:** masaüstünde (`high`) tam zincir; mobilde (`low` / "Fast")
  ucuz zincir.
- **Kapsam dışı:** modeller, bake, karakterler, WebGPU geçişi, simülasyon
  (`packages/core`) değişiklikleri. Yalnızca sunum katmanı değişir; yerel ve
  çevrimiçi modlar aynen çalışır.

## Seçilen yaklaşım

`postprocessing` (pmndrs, `^6.39`, three `>=0.168 <0.187` ile uyumlu) +
`n8ao` (`^2`). Efektler tek bir tam ekran geçişte birleştirilir; N8AO yarım
çözünürlükte hızlı ve düşük gürültülü AO verir.

Reddedilenler: three `examples/jsm` geçişleri (her efekt ayrı geçiş,
`UnrealBloomPass` pahalı ve seçici bloom zor); `WebGPURenderer` + TSL (materyal
katmanı göçü gerektirir, ayrı bir proje).

## Mimari

Yeni klasör `web/src/game/render/`:

| Birim | Görev | Arayüz |
|---|---|---|
| `render/profile.ts` | Kalite → ayar tablosu (piksel oranı, gölge haritası boyutu, açık efektler, grading değerleri). Saf veri. | `renderProfile(quality: Quality): RenderProfile` |
| `render/environment.ts` | HDRI'yi yükler (`RGBELoader` → `PMREMGenerator`; r179'da `HDRLoader` henüz yok) ve `scene.environment`'a koyar. Yüklenene kadar ve hata durumunda `RoomEnvironment` kalır. | `loadEnvironment(scene, url, baker, look?, load?): { ready: Promise<void>; dispose(): void }` — PMREM işi `pmremBaker(renderer)` arkasında, böylece WebGL'siz test edilebilir |
| `render/postfx.ts` | `EffectComposer`'ı kurar ve sahiplenir. | `createPostFx(renderer, scene, camera, profile): PostFx` — `render(dt)`, `setSize(w, h)`, `enabled`, `dispose()` |
| `world/arena.ts` → `createLights` | WTT düzenine göre yeniden kurulur. | `createLights(profile: RenderProfile)` (gölge haritası boyutu profilden) |

`GameRenderer` değişiklikleri:

- `renderer.render(scene, camera)` → `postfx.render(dt)`.
- `resize()` composer'ı da boyutlar; `dispose()` composer'ı ve ortam
  yükleyicisini de bırakır.
- Renderer: `toneMapping = NoToneMapping` (tone mapping zincire taşınır),
  `antialias: false` (AA composer'da).
- Renderer ayarları (piksel oranı, gölge tipi) `renderProfile`'dan okunur.

Asset yeri: `web/src/assets/env/arena_1k.hdr` (`?url` ile içe aktarılır; böylece
`/assets/` altında hash'li adla, kalıcı önbellek başlığıyla servis edilir)
— (Poly Haven `dancing_hall`, 1k, 1.7 MB) ve kaynak + CC0 lisansını
yazan `README.md` aynı klasörde. Faz 2'de Blender'dan render edilen kendi
salon env map'i aynı klasöre gelir ve `loadEnvironment` URL'si değişir.

## Işık düzeni

| Işık | Ayar |
|---|---|
| `scene.environment` | Poly Haven `dancing_hall` (karanlık tavan, nötr LED ızgaraları; `circus_arena` kırmızı zemin yansıması yüzünden elendi), `environmentIntensity` ≈ 0.5, parlak bölge tepeye gelecek şekilde döndürülür. |
| Hemisphere | 0.55 → ≈ 0.12. |
| Key (tek gölge atan) | Masanın neredeyse tam üstünde, hafif ofsetli directional. Soğuk beyaz `#f3f6ff`. Gölge haritası 2048 (`high`) / 1024 (`low`). Kısa, keskin top/raket gölgesi derinlik algısı için korunur. |
| Kort yıkaması | 4 gölgesiz spot; kortta ışık havuzu, bariyerlere doğru sönümlenir. |
| Rim | Her iki uçta arkadan zayıf soğuk ışık; raket ve topu karanlık fondan ayırır. |
| Tavan ışık çubukları | Emissive, yoğunluk > 1. Bloom eşiğini yalnızca bunlar ve vuruş parlaması geçer. |

Tüm değerler başlangıç noktasıdır; görsel doğrulama sırasında ayarlanır.

## Post zinciri

| | `high` | `low` |
|---|---|---|
| AA | Composer MSAA ×4 | FXAA (ayrı, son `EffectPass`) |
| AO | N8AO, yarım çözünürlük | yok |
| Bloom | Mipmap bloom, eşik ≈ 0.9, yoğunluk ≈ 0.7 | Aynı, daha az mip seviyesi |
| Tone mapping | AgX | AgX |
| Grading | Kontrast +, doygunluk + (AgX düzlüğünü telafi), vinyet ≈ 0.35 | Aynı |
| Piksel oranı | ≤ 2 | ≤ 1.25 |

Bloom, tone mapping ve grading tek bir `EffectPass`'te birleşir. FXAA komşu
pikselleri örneklediği için bitmiş görüntü üzerinde ayrı bir geçişte çalışır. Grading LUT dosyası
değil, parametredir.

**Bilinen risk:** N8AO ile composer MSAA birlikte sorun çıkarırsa `high`,
SMAA + N8AO'ya düşer. Uygulamanın ilk adımında doğrulanır.

## Hata yönetimi

- HDRI yüklenemezse: `console.warn`, `RoomEnvironment` kalır, oyun beklemez.
- Yükleme sürerken `dispose()` çağrılırsa (kalite değişimi canvas'ı yeniden
  kurar) gelen sonuç atılır ve doku bırakılır.
- WebGL2 dalı yok: three r163'ten beri `WebGLRenderer` yalnızca WebGL2 ile
  çalışır, WebGL2'siz tarayıcıda renderer zaten kurulamaz (mevcut davranış).
- Geliştirme yardımı: `rally.renderer.postfx.enabled = false` doğrudan
  renderer ile çizer (önce/sonra ve performans karşılaştırması için).

## Test ve doğrulama

Birim testleri (vitest, `web/`):

- `profile.test.ts`: `high`'da AO + MSAA var, `low`'da yok; piksel oranı
  sınırları; gölge haritası boyutları; iki katmanın aynı grading'i paylaşması.
- `environment.test.ts`: sahte yükleyiciyle hata durumunda fallback'in
  kaldığı; dispose sonrası gelen sonucun atıldığı.
- `postfx` jsdom'da çizilemez; tarayıcı önizlemesinde smoke kontrolü yapılır.

Tarayıcı önizlemesi:

- Aynı `simulate()` karesinden önce/sonra ekran görüntüleri: demo yörüngesi ve
  oyuncu kamerası, yatay ve dikey.
- `renderer.info` + 300 karelik süre ölçümü: `high` ve `low`, postfx kapalıyken
  ölçülen değerle karşılaştırılır.
- Konsolda shader/WebGL uyarısı olmamalı.

Kapılar: `npm test`, `npm run typecheck`, `npm run build` yeşil.

## Başarı ölçütleri

1. `high`: masa/file altında temas gölgeleri, lambalarda bloom, karanlık
   tribün – aydınlık kort ayrımı ekran görüntülerinde net.
2. `low`: zincirin ek maliyeti postfx kapalıya göre ≲ 1 ms/kare.
3. Top okunabilirliği bugünkünden kötü değil, tercihen daha iyi.
4. Tüm kapılar yeşil.

## Dokümantasyon

`architecture.md` → İstemci bölümündeki "ikili asset yoktur" cümlesi ve görsel
dünya açıklaması güncellenir; `render/` klasörü eklenir. `CHANGELOG.md`'ye
kayıt düşülür.

## Uygulama sonucu (2026-09-30)

- Grading, kütüphanenin kontrast/doygunluk efektleri yerine sonucu sıfırda
  sıkıştıran tek bir `GradingEffect` ile yapılır (negatif değerler renk uzayı
  dönüşümünde NaN üretiyordu).
- Ayarlanan değerler: key 1.7, kort yıkaması 9, rim 0.35, hemisphere 0.12,
  ortam 0.15 (≈ 0.5 başlangıç değeri tribünleri fazla aydınlatıyordu).
- N8AO + composer MSAA ×4 birlikte çalışıyor; SMAA yedeğine gerek kalmadı.
- İlk açılışta dokunmatik cihazlar `low`, diğerleri `high` ile başlar.
- Ölçüm (Intel UHD tümleşik GPU, 1280×720): `high` +12 ms/kare (N8AO ≈ 8.5 ms),
  `low` +2.1 ms/kare. Başarı ölçütü 2 (`low` ≲ 1 ms) **karşılanmadı**; `high`
  bu GPU'da 60 fps'in altında kalıyor. Ayrık GPU'da ölçülmedi.
- Bunun için `high`, ortalama kare süresi 18 ms'yi aşarsa AO'yu oturum boyunca
  kapatır (aynı GPU'da 23.1 → 15.5 ms/kare, ~3.5 sn sonra).
