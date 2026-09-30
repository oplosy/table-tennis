# Mimari

## Genel bakış

Proje üç paketli bir npm workspace'tir. Hepsi TypeScript'tir; oyunun kalbi
tarayıcıda ve sunucuda **aynı kodla** çalışır.

```text
             ┌──────────────────────────┐
             │      packages/core       │  deterministik simülasyon
             │ physics · shot · match   │
             │ ai · timeline · protocol │
             └──────┬─────────────┬─────┘
                    │             │
        ┌───────────▼───┐   ┌─────▼──────────────┐
        │     web       │   │      server        │
        │ React + three │◄─►│ Node + ws          │
        │ LocalSession  │ WS│ Room · MatchSession│
        │ OnlineSession │   │ (otoriter)         │
        └───────────────┘   └────────────────────┘
```

Önceki sürümdeki Go sunucusu kaldırıldı. Sebep: fizik sunucuda Go'da, istemcide
TypeScript'te iki kez yazılmak zorundaydı ve istemci topu yalnızca 100 ms geriden
interpolasyonla gösterebiliyordu. Artık tek simülasyon her yerde çalışıyor; bu da
hem bilgisayara karşı gecikmesiz oyunu hem de online'da topun anlık
gösterilmesini mümkün kılıyor.

## Koordinatlar ve birimler

- Metre ve saniye. Orijin filenin tam altında, zeminde.
- `x` masanın genişliği, `y` yukarı, `z` masanın uzunluğu.
- `home` oyuncusu `z > 0` yarısını, `away` oyuncusu `z < 0` yarısını savunur.
- Simülasyon **gerçek zamanda saniyede 240 tick** ilerler. Her tick
  `timeScale / 240` simüle saniyedir; `timeScale < 1` oyunu yörüngeleri
  değiştirmeden yavaşlatır (Rahat / Normal / Hızlı).

## Fizik (`physics.ts`)

- Yerçekimi, hızın karesiyle orantılı hava direnci, Magnus kuvveti
  (`ω × v`), dönüşün zamanla sönmesi.
- Masa, file ve zemin çarpışmaları önceki konuma göre **süpürülerek** (swept)
  hesaplanır; hızlı top içinden geçemez.
- Masada sekme: dikey geri sekme katsayısı + ince cidarlı küre için sürtünmeli
  kayma modeli. Topspin top ileri atılır, backspin frenlenir.
- File: gövdeye çarpan top hızını kaybeder; banda (cord) değen top normal
  vektörü etrafında yansır — "fileden dönen" toplar kendiliğinden oluşur.
- Yalnızca `+ - * / sqrt` kullanılır; V8 (tarayıcı ve Node) bit düzeyinde aynı
  sonucu üretir.

## Vuruş (`shot.ts`)

Kontrolcüler (fare, yapay zekâ, ağ) hiçbir zaman hız vektörü üretmez; yalnızca
bir **niyet** (`ShotIntent`: hedef x, derinlik, güç, falso, yan falso) üretir.

`planShot` niyeti hedef noktaya çevirir, yatay hızı güçten belirler ve dikey
hızı **aynı entegratörle ileri simülasyon + ikiye bölme** ile çözer; böylece top
tam hedefe düşer. Hata modeli:

- gelen topun hızı ve falsosu, raketin merkezinden uzak temas ve yüksek güç
  sapmayı büyütür;
- nadiren "kaçan vuruş" olur (fileye ya da uzun);
- `netAssist` yardımı fileye takılacak kıl payı vuruşları biraz yükseltir.

`planServe` önce kendi yarı sahada, sonra rakip yarıda seken yasal servis
yörüngesini tarama + daraltma ile bulur.

## Kurallar (`match.ts`)

`Match`, tamamen deterministik bir durum makinesidir:

```text
pre_serve → toss → rally → dead → (pre_serve | game_over → pre_serve | match_over)
```

Rally sırasında `expect` alanı sıradaki yasal olayı tutar (`server_side`,
`receiver_side`, `hit`). Masa/file/zemin temasları bu beklentiye göre sayıya
çevrilir: servis hatası, file, aut, çift sekme, kendi yarı sahası, kaçırılan top,
let. Sayı 1,25 sn "ölü top" süresinden sonra yazılır; bu pencere online'da geç
gelen vuruşların hâlâ kabul edilebilmesini sağlar. Hareketsiz kalan oyuncu için
10 sn sonra otomatik servis atılır.

## Temas (`paddle.ts`, `driver.ts`)

Raket, topun geldiği yarıda dikey bir düzlem olarak ele alınır. Top ile raket
düzlemi bir tick içinde birbirini geçtiğinde ve yatay mesafe erişim içinde
olduğunda temas oluşur (`sweepContact`). Raket yüksekliği görseldir; topa doğru
kendiliğinden yükselir. `tickWithControllers` her tick için: kontrolcüleri
günceller → servis isteklerini uygular → maçı ilerletir → temasları vuruşa
çevirir.

## Yapay zekâ (`ai.ts`)

Gelen topu aynı fizikle ileri simüle eder, kendi yarısında sektikten sonraki
tepe noktasını seçer, tepki süresinden sonra sınırlı hızla oraya gider ve
rakibin raketinden uzağa nişan alır. Zorluk seviyeleri tepki süresi, hız,
konumlanma hatası, güç aralığı ve isabetle ayrılır. Denge
`npm run bench` ile ölçülür (ör. orta–orta: sayı başına ~7 vuruş).

## Online (`timeline.ts`, `server/`, `OnlineSession.ts`)

- Sunucunun global bir tick saati vardır; istemciler ping/pong ile saati tahmin
  eder (en düşük RTT'li örneklerin medyanı, yumuşak düzeltme).
- Ağda yalnızca **eylemler** gider: `serve` ve `hit`, gerçekleştikleri tick ile.
  Raket konumları sadece görsel amaçlı 30 Hz aktarılır.
- `Timeline` son 1,5 sn'nin durumlarını ve eylem kaydını tutar. Geçmiş bir tick'e
  eylem gelirse o tick'e geri sarılır, eylem uygulanır ve bugüne kadar yeniden
  oynatılır.
- Vuruşu yapan istemci kendi raketini gecikmesiz görür ve vuruşu anında uygular;
  sunucu aynı eylemi kendi zaman çizelgesinde doğrular (sıra, temas noktasının
  topa yakınlığı, alanların sınırları) ve rakibe iletir. Reddedilirse istemciye
  `sync` gönderilir. Sunucu ayrıca 0,5 sn'de bir tam durum yollar.
- Bağlantısı kopan oyuncu için maç duraklatılır (maç saati ofsetlenir); 30 sn
  içinde dönmezse hükmen kaybeder.
- Rakibin vuruşu gecikmeli geldiğinde top görüntüsündeki sıçrama kısa bir
  harmanlamayla gizlenir.

## İstemci (`web/`)

- **Tek sahne:** `stage.ts` uygulama boyunca tek bir WebGL renderer tutar;
  sayfalar yalnızca oturumu değiştirir. Ana menünün arkasında iki yapay zekânın
  demo maçı döner.
- **Görsel dünya (`game/world/`):** masa, raket ve salon Blender'da modellenmiş
  GLB'lerdir (`src/assets/models/`); `assets.ts` onları oyunu bekletmeden yükler.
  Modeller gelene kadar ve yüklenemeyen her parça için aynı dosyalardaki
  yordamsal karşılıkları görünür. File bezi, top, top izi ve vuruş efektleri
  yordamsaldır; kort zemini, bariyer yazıları ve ekranlar canvas'a çizilir.
  - **Salon ışıksızdır:** ışığı Blender'da bake edilmiştir. Büyük yüzeyler
    ikinci UV kanalıyla ortak bir lightmap okur; koltuklar ve kafes kirişler
    gibi çok parçalı nesneler ışığı köşe noktası renklerinde taşır. Gerçek
    zamanlı ışıkların salona maliyeti yoktur.
  - **Gölgeler:** masanın zemindeki gölgesi lightmap'tedir; top ve raketlerin
    gölgesini kortun üstündeki şeffaf bir gölge yakalayıcı gösterir. Yakalayıcı,
    masanın ana ışığa göre zemine düşen izdüşümü kadar deliktir; yoksa top ve
    raket gölgeleri masanın içinden geçip altındaki zemine düşerdi. Salon
    modeli yüklenemezse masa kendi gölgesini gerçek zamanlı atar.
  - **Skor:** `scoreboard.ts` canlı skoru uç ekranlara ve hakem tabelasına
    çizer; adları sayfalar `stage.setNames` ile bildirir. Maç dışında (menüler,
    demo ralli) turnuva yazısı görünür.
  - **Masa ve raket ışıklıdır:** WTT yayın tarzı düzen (tepeden tek gölgeli
    key, kort yıkaması, rim) onları aydınlatır; masanın AO'su köşe noktası
    renklerindedir. Raket tek modeldir, oyuncuya göre kodda renklenir.
- **Asset hattı (`tools/blender/`):** kaynak `rally_assets.blend` (elle
  modellenir). `export.py` her koleksiyonu meshopt sıkıştırmalı GLB'ye yazar,
  `bake.py` salon ışığını ve masa AO'sunu bake eder, `render_env.py` salonun
  360° ortam haritasını çıkarır. Deneme ayarlarıyla (`RALLY_BAKE_SIZE`,
  `RALLY_BAKE_SAMPLES`, `RALLY_ENV_SAMPLES`) çalıştırılınca çıktı geçici
  klasöre gider; oyunun dosyaları ve `.blend` değişmez. `models.test.ts` GLB'leri `packages/core`
  ölçüleriyle (±1 mm), ad sözleşmesiyle ve 6 MB bütçeyle karşılaştırır.
- **Render (`game/render/`):** `profile.ts` kalite katmanını (piksel oranı,
  gölge, MSAA/FXAA, AO, bloom, grading) tanımlar. `environment.ts` HDRI'yi
  PMREM'e çevirir; yüklenene kadar ve hata durumunda `RoomEnvironment` kullanır.
  `postfx.ts` pmndrs `postprocessing` zinciridir: N8AO (yalnız High) → bloom +
  AgX + grading tek geçişte → FXAA (yalnız Fast). Grading kendi küçük efektimizdir
  (`grading.ts`): sonucu sıfırda sıkıştırır, çünkü negatif değerler bir sonraki
  efektin renk uzayı dönüşümünde NaN'a döner. Tuvalin yerleşim boyutu yokken
  çizim atlanır. `budget.ts` kare sürelerini izler; ortalama 18 ms'yi aşarsa
  (tümleşik GPU'lar) AO oturum boyunca kapatılır. Geliştirmede `rally.renderer.postfx.enabled = false` zinciri
  kapatır.
- **Kamera:** oyuncunun arkasında, raketi hafifçe takip eder; dikey ekranda
  geri çekilip görüş açısını genişletir.
- **Kontrol (`MouseController`):** işaretçi masanın biraz üstündeki yatay
  düzleme ışınla izdüşürülür; son ~80 ms'lik raket hızı vuruş niyetine çevrilir.
  Dokunmatikte raket parmağın biraz önünde tutulur.
- **Ses:** Web Audio ile sentezlenir (masa "tok", raket "pok", file, seyirci
  alkışı, set/maç akorları).
- **Arayüz:** React; per-frame veri React'e girmez, HUD yalnızca maç
  olaylarında yeniden çizilir.

## Testler

- `packages/core`: servis sırası, yasal servisler, vuruş isabeti, determinizm,
  tam maç, geçersiz vuruşların reddi, geç gelen eylemlerin rollback ile birebir
  aynı sonucu vermesi.
- `server`: oda API'si, maç başlatma ve eylem aktarımı, kopma/duraklatma,
  girdi temizleme.
- `web`: fare vuruşlarının yapay zekâya karşı masada kalma oranı.
