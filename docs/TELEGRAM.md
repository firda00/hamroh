# Telegram bot

Botga oddiy tilda yozasiz yoki ovozli xabar yuborasiz — u tushunib bajaradi va javob qaytaradi.

## O‘rnatish

### 1. Bot yarating

Telegramda **@BotFather** ga yozing:

```
/newbot
```

Nom va username so‘raydi, oxirida token beradi: `123456789:AAH...`

### 2. O‘z chat ID ingizni bilib oling

`.env` ga tokenni qo‘ying, botga bir marta «salom» deb yozing, so‘ng:

```bash
npm run hamroh -- telegram poll
```

Chiqishda `(chat_id: 123456789)` ko‘rinadi — o‘shani `.env` ga yozing.

### 3. `.env`

```
TELEGRAM_BOT_TOKEN=123456789:AAH...
TELEGRAM_CHAT_ID=123456789
```

### 4. Ishga tushiring

```bash
npm run bot
```

## Xavfsizlik — birinchi navbatda o‘qing

Bot havolasi ochiq: kim topsa, unga yozishi mumkin. Shuning uchun **ruxsat ro‘yxati majburiy**.

- `TELEGRAM_CHAT_ID` — asosiy ruxsat
- `TELEGRAM_ALLOWED_IDS=111,222` — qo‘shimcha odamlar (vergul bilan)
- Ro‘yxat **bo‘sh bo‘lsa bot hech kimga javob bermaydi** — bu ataylab shunday qilingan

Ro‘yxatdan tashqaridagilar «Sizga ruxsat berilmagan» javobini oladi va jurnalga yoziladi.

Tashqariga chiqadigan buyruqlar (SMS, xabar yuborish, o‘chirish) **tugma bilan tasdiqlanadi**:

```
⚠️ Tasdiqlang:
SMS +998901234567: "ertaga soat 10 da kutamiz"
   [✅ Ha, bajar]  [❌ Yo‘q]
```

Tasdiq bir martalik — bosilgandan keyin o‘sha tugma qayta ishlamaydi.

## Nima qila oladi

**Oddiy gap** — tushunib bajaradi:

```
ertaga soat uchda Aziz aka bilan uchrashuv qo'y
ikki yuz ming so'm ovqatga sarfladim
instagramdan yangi mijoz keldi Nodira 998901234567
bugun rejam qanday
```

**Ovozli xabar** — Whisper matnga o‘giradi, keyin xuddi shunday bajaradi
(`HAMROH_STT=local` kerak, [VOICE.md](VOICE.md)).

**Tez buyruqlar** — Telegram menyusida ko‘rinadi:

| Buyruq | Nima |
| --- | --- |
| `/tong` | Ertalabki brifing |
| `/kun` | Kun yakuni va o‘sish darajasi |
| `/reja` | Bugungi ishlar ketma-ketligi |
| `/kurs` `/obhavo` | Valyuta kursi, ob-havo |
| `/moliya` | Bugungi kirim-chiqim |
| `/tolovlar` | To‘lanmagan majburiyatlar |
| `/lidlar` `/uchrashuvlar` | Bugungi lidlar, uchrashuvlar |
| `/yangilik` `/hisobot` | Yangiliklar, haftalik ko‘rsatkichlar |
| `/status` `/help` | Tizim holati, yordam |

TTS yoqilgan bo‘lsa javob **ovozli xabar** bo‘lib ham keladi.

Har kuni soat 08:00 da ertalabki brifing avtomatik yuboriladi.

## Sinash (Telegramsiz)

```bash
npm run hamroh -- bot test "ertaga soat uchda uchrashuv qo'y"
```

Xuddi botga yozgandek ishlaydi, lekin tarmoqqa chiqmaydi.

## Ikki rejim: polling va webhook

### Long polling (standart, tavsiya etiladi)

```bash
npm run bot
```

Bot Telegramga o‘zi ulanadi. **Ochiq port, domen, TLS — hech narsa kerak emas.**
Uy kompyuteri yoki NAT ortidagi serverda ham ishlaydi.

Doimiy ishlashi uchun `systemd` (Ubuntu serverda):

```
[Unit]
Description=Hamroh bot
After=network.target

[Service]
WorkingDirectory=/opt/hamroh
ExecStart=/usr/bin/node src/cli.ts bot start
Restart=always
User=hamroh

[Install]
WantedBy=multi-user.target
```

### Webhook

Domen va HTTPS bo‘lsa:

```bash
npm run serve
```

```bash
npm run hamroh -- bot webhook --url=https://sizning-domen.uz/telegram --secret=uzun-tasodifiy-satr
```

`.env` ga `TELEGRAM_WEBHOOK_SECRET=uzun-tasodifiy-satr` qo‘ying — server har bir so‘rovni
shu bilan tekshiradi. Holatni ko‘rish: `bot webhook` (argumentsiz).
Qaytish: `bot stop-webhook`.

---

## Serverni Vercel'ga qo‘ysak bo‘ladimi?

Qisqa javob: **Hamroh uchun Vercel mos emas.** Sabablari aniq va texnik:

| Talab | Vercel'da | Nega muhim |
| --- | --- | --- |
| Doimiy jarayon (cron, eslatmalar) | Yo‘q — funksiyalar so‘rov kelganda uyg‘onadi | 16 ta cron vazifasi, har 10-15 daqiqalik eslatmalar ishlamaydi |
| Yoziladigan disk (SQLite) | Yo‘q — faqat `/tmp`, u ham har chaqiruvda tozalanadi | Butun ma'lumot bazasi shu faylda |
| Uzoq ishlaydigan so‘rov | 10-60 soniya chegara | Whisper va TTS bundan oshadi |
| GPU | Yo‘q | Lokal model va Whisper umuman ishlamaydi |
| Long polling | Yo‘q | `bot start` doimiy ulanishni talab qiladi |

Ya'ni Vercel'da faqat webhook qabul qiluvchi qism ishlashi mumkin edi, lekin u ham
bazasiz — har bir javob uchun ma'lumotni qayerdandir olish kerak.

### Nima qilish kerak

**1-variant — GPU server (agar oladigan bo‘lsangiz).** Hamroh o‘sha yerda,
Whisper va model bilan yonma-yon turadi. Qo‘shimcha to‘lov yo‘q, hammasi bir joyda,
ma'lumot chiqmaydi. Eng mantiqiy yechim.

**2-variant — arzon VPS.** GPU kerak bo‘lmasa (LLM `rules` yoki Claude API bo‘lsa),
oyiga ~$4–6 turadigan eng oddiy VPS yetadi: 1 vCPU, 1 GB RAM, 10 GB disk.
Hamroh nol bog‘liqlikli — faqat Node kerak, boshqa hech narsa.

**3-variant — o‘z kompyuteringiz.** Long polling NAT ortida ham ishlaydi.
Kompyuter yoqilgan paytda bot ishlaydi. Sinash uchun mutlaqo yetarli.

### Vercel qayerda foydali bo‘lardi

Kelajakda **veb-interfeys** qilsangiz — hisobotlarni brauzerda ko‘rish uchun.
U holda: Hamroh serverda ishlaydi va ma'lumotni beradi, Vercel esa faqat
ko‘rsatuvchi qatlam bo‘ladi. Lekin bu alohida ish, hozir shart emas.

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| Bot javob bermayapti | `TELEGRAM_CHAT_ID` to‘g‘rimi? Ro‘yxat bo‘sh bo‘lsa bot jim turadi |
| `409 Conflict` | Bir vaqtda ikkita `bot start` ishlayapti, yoki webhook o‘rnatilgan (`bot stop-webhook`) |
| Ovozli xabar matnga o‘girilmayapti | `HAMROH_STT=local` va Whisper serveri ishlayaptimi ([VOICE.md](VOICE.md)) |
| Javob keladi, ovoz kelmaydi | `HAMROH_TTS` sozlanganmi ([VOICE.md](VOICE.md)) |
| Fayl yuklanmadi | Bot API cheklovi: 20 MB gacha |
