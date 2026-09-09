# Google Calendar

Uchrashuvlar ikki tomonlama sinxronlanadi: Hamroh'da qo'yganingiz Google'ga chiqadi,
Google'da qo'yganingiz Hamroh'ga tushadi va brifingda ko'rinadi.

```bash
hamroh kalendar add "Investor bilan" --at="ertaga 15:00"
```

```
📅 #7 Investor bilan — 2026-09-10 15:00–16:00 (1 kun qoldi) · Google Calendar ✓
```

## Qaysi usulni tanlash

| | OAuth (shaxsiy hisob) | Xizmat hisobi (server) |
| --- | --- | --- |
| Brauzer kerakmi | Ha, bir marta | Yo'q |
| Qaysi kalendar | Sizning asosiy kalendaringiz | Siz ulashgan kalendar |
| Sozlash | Osonroq | Bir-ikki qadam ko'proq |
| Muammosi | Token muddati (pastda o'qing) | `primary` ishlamaydi |

Kompyuteringizda ishlatsangiz — **OAuth**. Faqat serverda tursa — **xizmat hisobi**.

---

## 1-usul: OAuth (shaxsiy Gmail)

### Google Cloud tomoni

1. [console.cloud.google.com](https://console.cloud.google.com) → yangi loyiha yarating
2. **APIs & Services → Library** → «Google Calendar API» → **Enable**
3. **OAuth consent screen** → External → o'zingizni «Test users» ga qo'shing
4. **Credentials → Create credentials → OAuth client ID** → turi: **Desktop app**
5. `client_id` va `client_secret` ni `.env` ga:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
```

### Ruxsat olish

```bash
hamroh kalendar auth
```

Terminalda havola chiqadi — brauzerda oching, ruxsat bering. Google `127.0.0.1:8765` ga
qaytaradi, Hamroh kodni ushlab, refresh tokenni chiqaradi. Uni `.env` ga qo'ying:

```
HAMROH_GCAL=oauth
GOOGLE_REFRESH_TOKEN=1//0g...
```

Tekshirish:

```bash
hamroh kalendar gstatus
```

### ⚠️ Muhim: «Testing» rejimida token 7 kunda o'ladi

Google'da ilova **Testing** holatida bo'lsa, refresh token **7 kundan keyin bekor bo'ladi**
va har hafta qayta ruxsat berishga to'g'ri keladi.

Yechim: **OAuth consent screen → Publish app** (In production). Ilova tekshiruvdan
o'tmagani uchun ruxsat oynasida «Google hasn't verified this app» ogohlantirishi chiqadi —
o'zingizning ilovangiz bo'lgani uchun **Advanced → Go to … (unsafe)** deb davom etasiz.
Shundan keyin token muddatsiz ishlaydi.

Serverda ishlatmoqchi bo'lsangiz: `kalendar auth` ni **kompyuteringizda** yurgizing
(brauzer kerak), so'ng chiqqan `GOOGLE_REFRESH_TOKEN` ni server `.env` iga ko'chiring.

---

## 2-usul: Xizmat hisobi (brauzersiz)

Server uchun qulayroq: bir marta sozlanadi, token muddati muammosi yo'q.

1. Google Cloud → **IAM & Admin → Service Accounts → Create**
2. Yaratilgan hisobga kiring → **Keys → Add key → JSON** → fayl yuklanadi
3. Faylni serverga qo'ying va huquqini cheklang:

```bash
sudo install -o hamroh -g hamroh -m 600 gcal-key.json /opt/hamroh/gcal-key.json
```

4. **Kalendarni xizmat hisobiga ulashing** — bu qadamsiz hech narsa ishlamaydi:
   Google Calendar → kerakli kalendar → **Settings and sharing** →
   **Share with specific people** → xizmat hisobi emailini qo'shing
   (`...@...iam.gserviceaccount.com`) → huquq: **Make changes to events**

5. `.env`:

```
HAMROH_GCAL=service
GOOGLE_SERVICE_ACCOUNT_FILE=/opt/hamroh/gcal-key.json
GOOGLE_CALENDAR_ID=siz@gmail.com
```

### ⚠️ `primary` ishlamaydi

Xizmat hisobi uchun `primary` — bu **xizmat hisobining o'z kalendari**, sizniki emas.
Shuning uchun `GOOGLE_CALENDAR_ID` ga aniq kalendar ID sini yozing: shaxsiy kalendar
uchun bu sizning email manzilingiz, boshqa kalendarlar uchun — Settings sahifasidagi
«Calendar ID».

Xato qilsangiz Hamroh aytadi: `kalendar "primary" topilmadi — kalendarni xizmat hisobiga ulashdingizmi?`

---

## Sinxronizatsiya qanday ishlaydi

```
hamroh kalendar sync        (yoki har 20 daqiqada avtomatik)
   ↓  Google -> mahalliy    oxirgi 7 kun + keyingi 60 kun oynasi
   ↑  mahalliy -> Google    external_id yo'q hodisalar bir marta yuboriladi
```

Qoidalar qasddan sodda:

- **Google'dan kelgan hodisa uchun Google haqiqat manbai** — nomi yoki vaqti o'zgarsa,
  mahalliy nusxa yangilanadi
- **Mahalliy yaratilgan hodisa bir marta yuboriladi**, so'ng `external_id` saqlanadi va
  qayta yuborilmaydi
- **Bekor qilish ikkala tomonda** — `kalendar rm` Google'dan ham o'chiradi,
  Google'da o'chirilgani mahalliy `bekor` bo'ladi

Murakkab konflikt yechish ataylab qilinmadi: shaxsiy kalendarda ikki tomondan bir vaqtda
tahrirlash deyarli uchramaydi, lekin «aqlli» birlashtirish uchrashuvni yo'qotib qo'yishi mumkin.

Takrorlanuvchi hodisalar (`singleEvents=true`) alohida uchrashuv bo'lib tushadi —
shuning uchun «har dushanba yig'ilish» brifingda to'g'ri ko'rinadi.

## Buyruqlar

| Buyruq | Nima qiladi |
| --- | --- |
| `kalendar auth` | Ruxsat olish (bir marta, brauzer kerak) |
| `kalendar gstatus` | Ulanish va bog'langan hodisalar soni |
| `kalendar sync [--days=60]` | Qo'lda sinxronlash |
| `kalendar add ... --at=...` | Qo'shadi va darhol Google'ga yuboradi |
| `kalendar rm <id>` | Ikkala tomondan bekor qiladi |

Avtomatik: `kalendar.sync` har 20 daqiqada (`npm run daemon` ishlab tursa).

Ovozli buyruq orqali ham: «ertaga soat uchda Aziz aka bilan uchrashuv qo'y» —
mahalliy bazaga ham, Google'ga ham tushadi.

## ICS import bilan farqi

Eski `kalendar ics` buyrug'i ham qoldi — u **faqat o'qish** uchun (boshqa odamning
ochiq kalendari, konferensiya jadvali va h.k.). Yozish kerak bo'lsa — shu sahifadagi usul.

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| `client_id/secret/refresh_token to'liq emas` | `.env` da uchalasi ham bo'lishi kerak |
| `invalid_grant` | Token bekor qilingan yoki 7 kunlik «Testing» muddati tugagan — ilovani Publish qiling |
| `kalendar "primary" topilmadi` | Xizmat hisobi rejimida `GOOGLE_CALENDAR_ID` ga emailingizni yozing |
| `ruxsat yetarli emas` | Ulashishda «Make changes to events» tanlanganmi |
| `5 daqiqa ichida javob kelmadi` | Brauzerda ruxsat berilmadi; `kalendar auth` ni qayta yurgizing |
