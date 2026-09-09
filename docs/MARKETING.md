# Marketing analitikasi — rasmiy API'lar

Instagram, Google Ads, YouTube va Google Business Profile ko‘rsatkichlarini
**rasmiy API** orqali yig‘adi. 2GIS uchun CSV import.

```bash
hamroh marketing manbalar        # nima ulangan
hamroh marketing ulash           # Google uchun rozilik havolasi
hamroh marketing sync --days=7   # ma'lumot yig'ish
hamroh marketing report --html   # diagrammali hisobot
```

Har kuni 06:30 da avtomatik yig‘adi (oxirgi 3 kun — platformalar kechagi
raqamlarni keyin tuzatadi).

## Nega skrejping yo‘q

Sahifani «qirqib olish» yoki avtomat brauzer bilan kabinetga kirish
Instagram va Google shartlarini buzadi. Amalda bu ikki narsaga olib keladi:
hisob bloklanadi, va bloklangan hisob bilan reklama ham to‘xtaydi.

Shuning uchun bu yerda faqat rasmiy API, faqat siz bergan ruxsat bilan,
faqat **o‘qish** uchun. 2GIS API bermaydi — u yerda CSV eksport ishlatiladi,
avtomat emas.

## Google: bitta rozilik, uchta xizmat

Ads, YouTube va Business Profile bitta Google hisobiga tayanadi.

**1. Google Cloud da OAuth mijozi** (agar kalendar uchun qilgan bo‘lsangiz, o‘shani ishlating):

- console.cloud.google.com → APIs & Services → Credentials
- Create credentials → OAuth client ID → **Web application**
- Authorized redirect URIs ga qo‘shing:
  - `http://127.0.0.1:7391/oauth/google/callback` (lokal)
  - `https://sizning-domen.uz/oauth/google/callback` (server)

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**2. Kerakli API'larni yoqing** (APIs & Services → Library):

| API | Nima uchun |
| --- | --- |
| Google Ads API | xarajat, bosish, konversiya |
| YouTube Analytics API | ko‘rish, ko‘rish vaqti, obunachi |
| Business Profile Performance API | qo‘ng‘iroq, yo‘nalish so‘rovi |

**3. Rozilik bering:**

```bash
hamroh marketing ulash
```

Havolani brauzerda oching. Panelda ham bor: **Sozlamalar → Marketing manbalari**.

> Avval faqat kalendarga ruxsat bergan bo‘lsangiz — **qayta rozilik kerak**.
> Eski token marketing API'larini ochmaydi, chunki ruxsatlar rozilik paytida
> belgilanadi. Xato `403` bo‘lib ko‘rinadi.

## Google Ads

Qo‘shimcha ikkita narsa kerak:

```
GOOGLE_ADS_DEVELOPER_TOKEN=...     # Google Ads → Tools → API Center
GOOGLE_ADS_CUSTOMER_ID=1234567890  # chiziqchasiz ham, chiziqcha bilan ham bo'ladi
GOOGLE_ADS_LOGIN_CUSTOMER_ID=      # faqat MCC orqali kirsangiz
```

Developer token boshida **test rejimida** bo‘ladi — u faqat test hisoblar bilan
ishlaydi. Haqiqiy hisob uchun Google'dan **Basic access** so‘rash kerak
(ariza bir necha kun ko‘riladi). Bu Google tomonidagi qadam, kodga aloqasi yo‘q.

Olinadigan metrikalar: xarajat (`cost`), bosishlar (`clicks`),
ko‘rsatishlar (`views`), konversiyalar (`leads`) — kunlar kesimida,
barcha kampaniyalar yig‘indisi.

## YouTube

```
YOUTUBE_CHANNEL_ID=      # bo'sh bo'lsa — token egasining kanali
```

Faqat **o‘z kanalingiz** statistikasi olinadi. Boshqa odamning kanali uchun
Analytics API ruxsat bermaydi.

Metrikalar: `views`, `watch_time` (daqiqa), `followers` (yangi obunachilar).

## Google Business Profile

```
GBP_LOCATION_ID=12345678901234567890
```

Joy raqamini Business Profile Manager havolasida ko‘rasiz. `locations/12345`
yoki shunchaki `12345` — ikkalasi ham bo‘ladi.

Metrikalar: `calls` (qo‘ng‘iroq tugmasi), `routes` (yo‘nalish so‘rovi),
`clicks` (saytga o‘tish), `views` (qidiruv va xaritadagi ko‘rsatishlar yig‘indisi).

## Instagram

Google'dan mustaqil — Meta'ning o‘z tokeni.

**Shart:** hisob **Business** yoki **Creator** bo‘lishi va Facebook sahifasiga
ulangan bo‘lishi kerak. Shaxsiy hisobda Insights API umuman ishlamaydi —
bu Meta cheklovi, uni aylanib o‘tib bo‘lmaydi.

- developers.facebook.com → ilova yarating (turi: Business)
- Instagram Graph API qo‘shing
- Ruxsatlar: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`
- Graph API Explorer da uzoq muddatli token oling (60 kun)

```
INSTAGRAM_ACCESS_TOKEN=IGQ...
INSTAGRAM_USER_ID=17841400000000000
INSTAGRAM_METRICS=reach            # vergul bilan: reach,views
```

Token **60 kunda tugaydi** — muddati tugashidan oldin yangilash kerak.
Tugagan token `401` beradi va `manbalar` da ko‘rinadi.

## 2GIS

2GIS ochiq statistika API bermaydi. Kabinetdan CSV yuklang:

```bash
hamroh marketing import ./2gis-sentabr.csv
```

Ustunlar: `date;platform;metric;value`. `platform` ustuniga `2gis` yozing.

## Qanday tekshirish

```bash
hamroh marketing manbalar
```

```
Platforma   Holat        Izoh
──────────  ───────────  ─────────────────────────────────────────
instagram   ✅ ulangan   Business hisob 17841400000000000, metrikalar: reach
google_ads  ✅ ulangan   hisob 1234567890
youtube     ✅ ulangan   token egasining kanali
gbp         — ulanmagan  GBP_LOCATION_ID va Google OAuth kerak
2gis        — ulanmagan  2GIS ochiq API bermaydi. Kabinetdan CSV...
```

Bitta platforma ishlamasa qolganlari to‘xtamaydi — `sync` har birini alohida
sinaydi va xatoni platformaning **o‘z so‘zlari bilan** ko‘rsatadi:

```
✗  instagram: HTTP 400 · Invalid OAuth access token · hisob Business/Creator ekanini tekshiring
```

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| `403 · ruxsat yetarli emas` | Rozilik marketing ruxsatlarisiz berilgan — `marketing ulash` ni qayta bajaring |
| `401 · token eskirgan` | Instagram tokeni 60 kunda tugaydi; Google refresh token bekor qilingan |
| Ads: `DEVELOPER_TOKEN_NOT_APPROVED` | Test rejimidagi token — Google'dan Basic access so‘rang |
| Ads: `USER_PERMISSION_DENIED` | Hisob shu Google akkauntga biriktirilmagan yoki MCC id kerak |
| Instagram: `Insights not available` | Hisob shaxsiy — Business/Creator ga o‘tkazing |
| YouTube bo‘sh qaytdi | Kanal shu hisobga tegishli emas, yoki tanlangan kunlarda ma’lumot yo‘q |
| GBP bo‘sh qaytdi | Joy tasdiqlanmagan, yoki oxirgi kunlar hali hisoblanmagan (GBP 2-3 kun kechikadi) |

## Ma'lumot qayerda saqlanadi

Bitta jadval: `marketing_metrics(date, platform, metric, value, account)`.
Kalit `(date, platform, metric, account)` — qayta `sync` qilsangiz eski qiymat
yangilanadi, dublikat bo‘lmaydi.

Shu sababli `sync` ni xohlagancha ko‘p marta ishga tushirish xavfsiz.
