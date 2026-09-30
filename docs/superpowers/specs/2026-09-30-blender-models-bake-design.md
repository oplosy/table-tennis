# Faz 2 — Blender modelleri ve ışık bake'i

- **Tarih:** 2026-09-30
- **Durum:** Uygulandı (bkz. "Uygulama sonucu"). Kullanıcının isteğiyle plan belgesi yazılmadan uygulandı.
- **Dal:** `feat/blender-models` (`feat/real-3d-table-tennis` dalına birleştirildi)
- **Önceki faz:** `2026-09-29-lighting-postfx-hdri-design.md` (uygulandı)

## Bağlam

Faz 1 ışık düzenini, post zincirini ve HDRI'yi getirdi. Masa, file, raket ve
salon hâlâ `web/src/game/world/` altında Three.js kutu ve silindirlerinden
kuruluyor. Bu faz onları Blender'da modellenmiş GLB'lerle değiştirir ve salonun
ışığını lightmap'e bake eder. Faz 3 (IK'li oyuncu karakterleri) ayrı bir
döngüdür.

Eski GLB hattı (`tools/create_blender_assets.py`, `AssetLoader.ts`) yeniden
yazımda silindi; geri getirilmez, yerine bu tasarım geçer.

## Kararlar

| Konu | Karar |
|---|---|
| Modelleme | Canlı: Blender oturumunda MCP üzerinden adım adım. Kaynak `.blend` repo'ya girer. |
| Bake kapsamı | Salon lightmap'i; masa ve rakete yalnızca AO dokusu. Top ve raket gölgesi gerçek zamanlı kalır. |
| Bütçe | Model + doku toplamı ≤ 6 MB (ortam haritası hariç, o bugünkü 1,7 MB'ın yerine geçer). |
| Bağlama | Parça başına GLB + ayrı lightmap dokusu. |

Reddedilenler: tek `scene.glb` (her değişiklikte tümü yeniden dışa aktarılır,
parça parça yedek zorlaşır); betikle üretim ve hazır modeller (kullanıcı canlı
modellemeyi seçti).

## Kapsam dışı

Oyuncu karakterleri ve IK (Faz 3), `packages/core` ve `server` değişiklikleri,
WebGPU, `low` katmanı için ayrı düşük çözünürlüklü dokular, KTX2 hattı.
File bezi, top, top izi ve vuruş efektleri yordamsal kalır.

## Asset hattı

### Kaynak

- `tools/blender/rally_assets.blend`. `.gitignore`'daki `tools/*.blend*`
  satırı yalnızca `.blend1` yedeklerini dışlayacak şekilde daraltılır.
- Dokular dosyaya gömülmez; `tools/blender/textures/` altında durur.
- Koleksiyonlar: `Table`, `Paddle`, `Arena`. Her biri bir GLB'dir.
- Eksenler: Blender Z-yukarı modellenir, glTF dışa aktarımı Y-yukarıya çevirir.
  Oyunun koordinatları: masa uzun ekseni Z, genişliği X, yukarı Y; masa merkezi
  orijinde, zemin y = 0.

### Ad sözleşmesi

| Model | Düğümler | Malzemeler |
|---|---|---|
| `table.glb` | `table_top`, `table_frame`, `net_post_L`, `net_post_R` | `table_surface`, `table_lines`, `metal` |
| `paddle.glb` | `blade`, `handle` | `rubber_forehand`, `rubber_backhand`, `wood`, `handle`, `accent` |
| `arena.glb` | `floor`, `barriers`, `stands`, `lamps` | her ağda ikinci UV kanalı (`TEXCOORD_1`, lightmap) |

Raket gerçek ölçüde modellenir; ekrandaki 1,35 kat büyütme kodda kalır. Kökü
bıçağın merkezindedir, sap −Y yönündedir (bugünkü `PaddleView` ile aynı).

### Dışa aktarım ve sıkıştırma

- `tools/blender/export.py`: her koleksiyonu aynı ayarlarla GLB'ye yazar
  (uygulanmış dönüşümler, ikinci UV, WebP dokular).
- `npm run assets:optimize`: `@gltf-transform/cli` (geliştirme bağımlılığı) ile
  meshopt sıkıştırma ve doku yeniden boyutlandırma.
- Çıktı: `web/src/assets/models/{table,paddle,arena}.glb` ve
  `arena_lightmap.webp`. `?url` ile içe aktarılır (hash'li ad, kalıcı önbellek).

### Bütçe dağılımı

| Parça | Doku | Tahmin |
|---|---|---|
| Masa | 2k renk + pürüzlülük/AO + normal | ~1,5 MB |
| Raket | 2k renk + pürüzlülük/AO + normal | ~1,2 MB |
| Salon | 1k renk atlası + 2k lightmap | ~1,5 MB |
| Geometri (meshopt) | ~50–80 bin üçgen | ~1 MB |

## Oyuna bağlama

### Yükleyici — `web/src/game/world/assets.ts`

- `GLTFLoader` + `MeshoptDecoder` ile üç GLB ve lightmap paralel yüklenir.
- Oyun beklemez: modeller gelene kadar ve hata durumunda yordamsal masa, raket
  ve salon görünür; her model geldiğinde kendi parçasının yerine geçer.
- Yükleme sürerken `dispose()` çağrılırsa (kalite değişimi) sonuç atılır ve
  kaynaklar bırakılır. Yükleyici sahte bir okuyucu ile test edilebilir olmalı
  (`render/environment.ts`'teki dikiş düzeni).

### Salon: ışıksız malzeme + lightmap + gölge yakalayıcı

Three.js'te ışıklar nesne bazında kapatılamaz; salon ışıklı kalırsa hem
lightmap'ten hem gerçek zamanlı ışıklardan aydınlanır. Bu yüzden:

- Salon malzemeleri `MeshBasicMaterial`: renk dokusu × lightmap
  (`lightMap.channel = 1`). Gerçek zamanlı ışıkların salona maliyeti kalmaz.
- Zeminin hemen üstünde şeffaf bir `ShadowMaterial` düzlemi yalnızca hareketli
  nesnelerin (top, raketler) gölgesini gösterir.
- Masanın zemindeki gölgesi lightmap'te bake'lidir; masa zemine gerçek zamanlı
  gölge atmaz (çift gölge olmasın).
- Tavan lambaları Faz 1'deki gibi HDR parlaklıkta kalır (bloom).

### Masa ve raket: ışıklı PBR

- Faz 1'in ışıkları (key, kort yıkaması, rim) bunları aydınlatır; AO dokusu
  glTF `occlusionTexture` ile gelir.
- Masa üstü top ve raket gölgesini gerçek zamanlı alır.
- Raket tek modeldir, iki kez kullanılır; lastik, sap ve vurgu renkleri kodda
  malzeme adına göre atanır. Tutuş değiştirme ve savurma aynı pivot yapısıyla
  korunur. "Top menzilde" parlaması yordamsal kalır.
- File direkleri ve kelepçeler masa modeline geçer; file bezi ve beyaz bant
  yordamsal kalır.

### Ortam haritası

Blender'da masa üstünden salonun 360° render'ı (1k, `.hdr`) alınır ve
`web/src/assets/env/arena_1k.hdr`'nin yerine geçer. `ARENA_LOOK.intensity`
yeniden ayarlanır; `env/README.md` güncellenir.

### Kalite katmanları

İki katman aynı modelleri ve dokuları kullanır.

## Bake

- Blender'da Faz 1 düzeni kurulur: tepeden key, dört kort ışığı, iki rim,
  tavan lambaları.
- Salon: Cycles ile ikinci UV kanalına 2k lightmap (doğrudan + dolaylı ışık,
  masanın zemin gölgesi dahil).
- Masa ve raket: AO, pürüzlülük dokusunun kanalına paketlenir.
- **Bilinen risk:** Blender ve Three.js ışık birimleri farklıdır; bake
  parlaklığı oyundakiyle sayısal olarak birebir tutmaz. Görsel olarak
  eşleştirilir; son ayar kodda tek bir lightmap yoğunluğu değeridir.

## Hata yönetimi

- Bir GLB yüklenemezse o parça yordamsal kalır, tek `console.warn`; diğer
  parçalar etkilenmez.
- Lightmap yüklenemezse salon yordamsal haline döner (lightmap'siz ışıksız
  malzeme siyah olurdu).
- Beklenen düğüm veya malzeme eksikse model reddedilir ve yedek kalır.

## İş sırası

| # | Adım | Çıktı |
|---|---|---|
| 1 | Hat iskeleti | `.blend`, koleksiyonlar, `export.py`, ölçü testi (önce kırmızı) |
| 2 | Masa | `table.glb` |
| 3 | Raket | `paddle.glb` |
| 4 | Salon | `arena.glb` |
| 5 | Bake | Salon lightmap'i, masa ve raket AO'su |
| 6 | Ortam haritası | Salonun 360° render'ı |
| 7 | Oyuna bağlama | Yükleyici, yedek, gölge yakalayıcı, ışık ayarı |
| 8 | Doğrulama ve dokümanlar | Ölçümler, görüntüler, `architecture.md` |

Canlı modelleme yeniden üretilemediği ve `.blend` git'te incelenemediği için
adım 2, 3, 4 ve 5'in sonunda kullanıcıya Blender görüntüsü gönderilir ve onay
alınır.

## Test ve doğrulama

Birim testleri (vitest, `web/`):

- **Ölçü sözleşmesi:** GLB'ler `@gltf-transform/core` ile okunur ve
  `packages/core` sabitleriyle karşılaştırılır (±1 mm): masa üstü
  1,525 × 0,025 × 2,74 m, üst yüzü y = 0,76; file direkleri x = ±0,915.
- **Ad sözleşmesi:** beklenen düğümler, malzemeler, salon ağlarında
  `TEXCOORD_1`.
- **Yükleyici:** hata durumunda yedeğin kalması; dispose sonrası gelen
  sonucun atılması; kaynakların bırakılması.
- **Bütçe:** `web/src/assets/models/` toplamı 6 MB'ı aşarsa test kırılır.

Tarayıcı:

- Önce/sonra görüntüleri: yörünge, oyuncu kamerası, dikey; High ve Fast.
- Kare süresi: faz öncesi commit, Faz 1'in son hali ve bu fazın sonu ölçülür.
- Top masada ve zeminde gölge bırakıyor; masanın zemin gölgesi çift değil.
- Kalite değiştirme ve yarıda kesilen yükleme: hata ve sızıntı yok.

Kapılar: `npm test`, `npm run typecheck`, `npm run build`.

## Başarı ölçütleri

1. Masa, raket ve salon yakın çekimde gerçek nesneler gibi görünüyor
   (kullanıcı onayıyla).
2. Ölçü testi yeşil.
3. Model + doku toplamı ≤ 6 MB.
4. Kare süresi Faz 1'in son halinden kötü değil.
5. Asset'ler yüklenemediğinde oyun yordamsal modellerle oynanabilir kalıyor.

## Uygulama sonucu (2026-09-30)

Tasarımdan sapmalar:

- **Salon için renk atlası yok.** Yüzeyler düz malzeme rengi kullanır; kort
  zemini, bariyer yazıları, logo panelleri ve ekranlar oyunun canvas
  dokularıyla boyanır. Zenginlik lightmap'ten gelir.
- **İki tür bake.** Büyük yüzeyler (zemin, bariyerler, duvarlar, sahne duvarı,
  hakem masası) 2k lightmap'te; koltuklar, kafes kirişler ve spotlar gibi çok
  parçalı nesneler köşe noktası renklerinde. Binlerce küçük parça lightmap'in
  çoğunu boşa harcardı.
- **Masa AO'su doku değil, köşe noktası rengi.** Rakete AO bake edilmedi
  (dışbükey bir nesne, kazanç yok). Masa ve rakette doku yok; düz renkli
  malzemeler.
- **Sıkıştırma Blender'da.** 5.2'nin dışa aktarıcısında meshopt yerleşik;
  `gltf-transform` komut satırı aracı eklenmedi.
- **Ek düğümler:** `net_clamp_L/R`, `hall`, `rig`, `umpire_desk`,
  `towel_box_home/away`, `backstage_home/away`, `backwall_home/away`,
  `screen_home/away`.
- **Bariyerler** kullanıcı geri bildirimiyle yeniden modellendi: dolgulu gövde,
  yuvarlak üst kenar, gömülü reklam yüzü, kauçuk taban, köşe parçaları.
- **Uç alanlar** kullanıcı geri bildirimiyle eklendi: sponsor duvarı, LED
  ekran, spot kuleleri, yayın kamerası.

Ölçümler (Intel UHD tümleşik GPU, 1280x720, 300 kare):

| | Faz 1 sonu | Faz 2 sonu |
|---|---|---|
| Zincir kapalı | 6,6 ms | 4,4 ms |
| High, AO'suz | 15,5 ms | 10,2 ms |
| High, AO'lu | 18,7 ms | 15,0 ms |

Boyut: `arena.glb` 1,03 MB, `arena_lightmap.webp` 0,48 MB, `table.glb`
0,18 MB, `paddle.glb` 0,04 MB; toplam 1,73 MB (bütçe 6 MB). Ortam haritası
1,0 MB (öncekinin yerine, 1,7 MB'tan).

Sonradan eklenenler: ekranlarda ve hakem tabelasında canlı skor
(`world/scoreboard.ts`); rakette canvas'a çizilen lastik pürüzü ve ahşap damarı.
Yapılmayanlar: zemin ve masa için doku çalışması.
