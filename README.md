# Rally — Table Tennis

Tarayıcıda çalışan, gerçek fizikli 3D masa tenisi. Bilgisayara karşı ya da bir
arkadaşınla online oynanır.

- **Gerçek ölçüler ve fizik:** ITTF masası (2,74 × 1,525 m, file 15,25 cm),
  40 mm top; yerçekimi, hava direnci, Magnus etkisi (topspin/backspin/yan
  falso), masada sürtünmeli sekme, file bandına çarpıp dönen toplar.
- **Vuruş kontrolü:** raket fareyi/parmağı takip eder; vuruş anındaki raket
  hızı gücü ve falsoyu, yana hareket yönü belirler. Geri çekerek kesme (chop),
  yüksek topta sert vuruşla smaç.
- **Kurallar:** 11'de biten, 2 fark gereken setler; iki serviste bir servis
  değişimi, 10–10'dan sonra her sayıda; filede kalan servis (let), çift sekme,
  kendi yarı sahaya düşen top, aut.
- **Rakipler:** Kolay / Orta / Zor / Pro. Yapay zekâ aynı fizikle topun
  yolunu tahmin eder, sınırlı hızla koşar, hata yapar.
- **Online:** oda kodu veya davet linki; sunucu otoriter, istemciler aynı
  deterministik simülasyonu çalıştırır, gecikmeli vuruşlar geri sarılarak
  (rollback) doğru tick'e yerleştirilir.

## Kurulum

Node.js 20+ gerekir.

```powershell
npm install
npm run dev
```

`npm run dev` oyun sunucusunu (`:8080`) ve Vite'ı (`:5173`) birlikte başlatır.
Tarayıcıda <http://localhost:5173> adresini aç. Bilgisayara karşı oyun sunucu
olmadan da çalışır; online oyun için sunucu gerekir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `npm run dev` | Sunucu + istemci geliştirme modu |
| `npm test` | Çekirdek, sunucu ve istemci testleri |
| `npm run typecheck` | Tüm paketlerde TypeScript kontrolü |
| `npm run build` | `web/dist` ve `server/dist/server.js` üretir |
| `npm start` | Derlenmiş sunucuyu başlatır; `web/dist`'i de sunar |
| `npm run bench -- hard medium 20` | Yapay zekâ maçlarıyla denge ölçümü |

## Yayına alma

Tek süreç yeterli: sunucu hem API/WebSocket'i hem de derlenmiş istemciyi sunar.

```powershell
npm run build
$env:PORT = "8080"
npm start
```

veya Docker ile:

```powershell
docker build -t rally .
docker run -p 8080:8080 rally
```

İstemci farklı bir adresteki sunucuya bağlanacaksa derlemeden önce
`VITE_SERVER_URL` ayarlanır (ör. `https://rally.example.com`).

## Proje yapısı

```text
packages/core   Paylaşılan deterministik simülasyon: fizik, vuruş çözücü,
                kurallar, yapay zekâ, rollback zaman çizelgesi, protokol tipleri
server          Node.js + ws: odalar, otoriter maç döngüsü, HTTP API, statik dosyalar
web             React + three.js: 3D salon, kamera, kontroller, HUD ve menüler
```

Ayrıntılar için [architecture.md](architecture.md).
