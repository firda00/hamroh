# Hamroh

Shaxsiy AI yordamchi: yangiliklar, moliya, vazifalar, uchrashuvlar, hisobotlar,
marketing analitikasi, buxgalteriya, yuridik yordam va sog‘liq — bitta tizimda.

**Bosqich 1 (hozir):** LLM ulanmagan. Hamma narsa deterministik qoidalar bilan ishlaydi —
tez, bepul, internetsiz ham. **Bosqich 2:** bitta sozlama bilan Claude ulanadi va
xulosa/maslahatlar sifati oshadi — modullar kodiga tegilmaydi.

## Nega bunday qurilgan

- **Nol bog‘liqlik.** Runtime uchun `npm install` shart emas: baza — Node ichidagi
  `node:sqlite`, TypeScript to‘g‘ridan-to‘g‘ri Node tomonidan yuritiladi.
- **Ma’lumot sizniki.** Hammasi lokal SQLite faylida (`data/hamroh.db`). Bulut yo‘q.
- **LLM — almashtiriladigan qism.** Modullar `LlmProvider` interfeysi bilan gaplashadi;
  `rules` (bosqich 1) yoki `anthropic` (bosqich 2) — tanlov `.env` da.
- **Kalitsiz ishlaydi.** Valyuta kursi (CBU), ob-havo (Open-Meteo), yangiliklar (Google News RSS)
  — hech qanday API kalit talab qilmaydi.

## Tez boshlash

```bash
node --version    # v22.6+ kerak (v24 tavsiya)
```

```bash
git clone https://github.com/firda00/hamroh.git && cd hamroh
```

```bash
npm run sozlash
```

Savol-javob bilan `.env` to‘ldiriladi va ulanishlar darhol tekshiriladi
(Telegram tokeni, model serveri). Har savolda Enter — joriy qiymat qoladi.

Namuna ma’lumot bilan ko‘rish uchun:

```bash
npm run seed
```

```bash
npm run hamroh -- tong
```

Natija:

```
☀️  XAYRLI TONG — 2026-09-08, seshanba
══════════════════════════════════════════

· KUN MA’LUMOTI
   USD 11 789,33 so‘m · EUR 13 702,74
   Tashkent: 21…35°C, ochiq
· YANGILIKLAR
   [iqtisodiyot] O‘zbekistonda islohotlar bo‘yicha yangi kelishuv…
   [jahon] IMF / 3Q World Economic Outlook…
❗ BUGUNGI VAZIFALAR (4)
   ⚠️  KECHIKKAN: #1 Bank hujjatlarini topshirish
   14:30  #2 Yangi kurs uchun kontent yozish
· BUGUNGI UCHRASHUVLAR (1)
   15:00 — Investor bilan uchrashuv · Ofis, 3-qavat
❗ YAQIN TO‘LOVLAR
   Ofis arendasi — 5 000 000 UZS — 3 kun kechikdi
```

Kun oxirida:

```bash
npm run hamroh -- kun --html
```

## Kundalik buyruqlar

| Buyruq | Nima qiladi |
| --- | --- |
| `hamroh tong` | Ertalabki brifing: kurs, ob-havo, yangilik, vazifa, uchrashuv, to‘lov |
| `hamroh kun [--html]` | Kun yakuni: hisobot, o‘sish darajasi, kamchiliklar |
| `hamroh eslat` | Navbatdagi eslatmalarni yetkazish (konsol yoki Telegram) |
| `hamroh doctor` | Tizim holati: baza, ulanishlar, yozuvlar soni |
| `hamroh jobs` | Avtomatik vazifalar jadvali |
| `hamroh help <modul>` | Modul buyruqlari |

`npm run hamroh -- <buyruq>` ko‘rinishida yoki `node src/cli.ts <buyruq>` bilan chaqiriladi.

## Modullar

| Modul | Talab | Misol |
| --- | --- | --- |
| `bozor` | (2) Kurs va ob-havo | `hamroh bozor kurs --history=7` |
| `yangilik` | (1) Yangiliklar | `hamroh yangilik top --cat=jahon` |
| `vazifa` | (3) Vazifa va eslatma | `hamroh vazifa add "Bankka borish" --due="ertaga 10:00"` |
| `kalendar` | (4) Uchrashuvlar | `hamroh kalendar add "Investor" --at="ertaga 15:00"` |
| `hisobot` | (5) Kunlik hisobot | `hamroh hisobot kun --html` |
| `moliya` | (5) Kirim-chiqim | `hamroh moliya out 250k taksiga` (toifa o‘zi aniqlanadi) |
| `buxgalter` | (6) Buxgalteriya | `hamroh buxgalter list` |
| `yurist` | (7) Yuridik | `hamroh yurist check` |
| `lid` | (8) Lidlar, Excel | `hamroh lid export --today` |
| `hujjat` | (9) PDF/Word/taqdimot | `hamroh hujjat word "Shartnoma" --from=matn.md` |
| `telegram` | (10) Telegram | `hamroh telegram send "Salom"` |
| `ovoz` | (10) Ovoz → matn | `hamroh ovoz sync` |
| `gap` | Ovozli buyruq, suhbat | `hamroh gap matn "ertaga uchda uchrashuv qo‘y"` |
| `bot` | Telegram bot | `npm run bot` |
| `qongiroq` | Telefon qo‘ng‘irog‘i | `hamroh qongiroq brifing` |
| `sozlash` | Sozlash ustasi | `npm run sozlash` |
| `aloqa` | (11) Qo‘ng‘iroq va SMS | `hamroh aloqa calls --missed` |
| `oylik` | (12) Doimiy to‘lovlar | `hamroh oylik check` |
| `marketing` | (13) Marketing analitikasi | `hamroh marketing report --days=30 --html` |
| `mahsulot` | (14) Mahsulot va foyda | `hamroh mahsulot top` |
| `soglik` | (15) Sog‘liq | `hamroh soglik report --days=7` |
| `eslatma` | — | `hamroh eslatma list` |

To‘liq ro‘yxat: [docs/MODULES.md](docs/MODULES.md).

## Serverga o‘rnatish

```bash
curl -fsSL https://raw.githubusercontent.com/firda00/hamroh/main/scripts/install-vps.sh | sudo bash
```

Ubuntu 22.04/24.04: Node, kod, `.env`, systemd xizmatlari — hammasi bir buyruqda.
Qayta ishga tushirish xavfsiz, yangilash `--update` bilan.
Batafsil: [docs/VPS.md](docs/VPS.md).

## Telegram bot

```bash
npm run bot
```

Botga oddiy tilda yozasiz («ertaga soat uchda uchrashuv qo‘y») yoki ovozli xabar
yuborasiz — u tushunib bajaradi va javob qaytaradi (TTS yoqilgan bo‘lsa ovoz bilan).
`/tong`, `/kun`, `/reja`, `/kurs` kabi tez buyruqlar Telegram menyusida turadi.

Faqat `TELEGRAM_CHAT_ID` va `TELEGRAM_ALLOWED_IDS` dagilar foydalana oladi;
SMS va xabar yuborish kabi buyruqlar tugma bilan tasdiqlanadi.
O‘rnatish va xavfsizlik: [docs/TELEGRAM.md](docs/TELEGRAM.md).

Telegramsiz sinash:

```bash
npm run hamroh -- bot test "ertaga soat uchda uchrashuv qo‘y"
```

## Avtomatik ishlash

```bash
npm run daemon
```

Har daqiqada cron jadvalini tekshiradi: ertalabki brifing (08:00), kun yakuni (20:00),
oylik to‘lov eslatmalari, buxgalteriya uchun har oyning 10-kuni, oy oxirida sotuv hisoboti,
lidlarning kunlik Excel eksporti va boshqalar. Ro‘yxat: `hamroh jobs`.

Lokal HTTP API (kelajakdagi mobil/veb interfeys uchun):

```bash
npm run serve
```

## Bosqich 2 — LLM ulash

Uch rejim bor, modul kodi hech qaysisida o‘zgarmaydi:

| Rejim | Nima | Narx (oyiga, ~30 so‘rov/kun) |
| --- | --- | --- |
| `rules` | LLM'siz, deterministik (standart) | $0 |
| `local` | O‘z serveringizdagi model (Ollama va h.k.) | server narxi |
| `anthropic` | Claude API | ~$4–18 |

**Lokal model** (ma'lumot serverdan chiqmaydi):

```
HAMROH_LLM=local
HAMROH_LLM_URL=http://127.0.0.1:11434/v1
HAMROH_LLM_MODEL=qwen3:14b
```

Model tanlash, VRAM hisobi va narx solishtiruvi: [docs/LOCAL-LLM.md](docs/LOCAL-LLM.md).
Modelning o‘zbekcha sifatini tekshirish: `npm run eval`.

**Ovozli xabarlar** (Whisper, LLM dan mustaqil — alohida yoqiladi):

```
HAMROH_STT=local
HAMROH_STT_URL=http://127.0.0.1:8000/v1
HAMROH_STT_MODEL=Systran/faster-whisper-large-v3
HAMROH_STT_LANG=uz
```

Telegram ovozli xabarlari har 10 daqiqada matnga o‘giriladi.

**Ovozli buyruqlar** — aytilgan gap buyruqqa aylanadi va bajariladi:

```bash
hamroh gap matn "ertaga soat uchda Aziz aka bilan uchrashuv qo‘y"
```

```bash
hamroh gap ovoz ./buyruq.ogg --ovoz
```

Qoidaviy rejimda ham ishlaydi (uchrashuv, eslatma, kirim-chiqim, lid, kurs, ob-havo,
yangilik, reja, hisobot, to‘lovlar, sog‘liq), LLM ulansa — ancha ko‘proq gapni tushunadi.
Telegramga ovozli javob ham qaytaradi. O‘rnatish: [docs/VOICE.md](docs/VOICE.md).

**Claude API:**

```bash
npm install @anthropic-ai/sdk
```

`.env` faylida:

```
HAMROH_LLM=anthropic
ANTHROPIC_API_KEY=sk-ant-...
HAMROH_LLM_MODEL=claude-opus-5
```

Shundan keyin `moliya advise`, `marketing advise`, `yangilik top`, `hujjat content`,
`yurist ask`, `hamroh ask "..."` kabi buyruqlar to‘liq tahlil beradi. Kalit ishlamasa yoki
tarmoq uzilsa — tizim avtomatik qoidaviy rejimga qaytadi, brifing to‘xtamaydi.
Batafsil: [docs/LLM.md](docs/LLM.md).

## Sozlamalar

Hamma sozlama `.env` orqali (`.env.example` dan nusxa oling). Asosiylari:

| Kalit | Standart | Izoh |
| --- | --- | --- |
| `HAMROH_TZ` | `Asia/Tashkent` | Vaqt zonasi |
| `HAMROH_CITY` | `Tashkent` | Ob-havo shahri |
| `HAMROH_CURRENCY` | `UZS` | Asosiy valyuta |
| `HAMROH_OFFLINE` | `0` | `1` — tarmoqqa umuman chiqmaydi |
| `HAMROH_DB` | `./data/hamroh.db` | Baza fayli |
| `HAMROH_LLM` | `rules` | `rules` yoki `anthropic` |

## Tekshirish

```bash
npm test && npm run typecheck
```

## Hujjatlar

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — tuzilma va qanday qilib yangi modul qo‘shiladi
- [docs/MODULES.md](docs/MODULES.md) — 15 ta talab → modul → buyruq → holat
- [docs/ROADMAP.md](docs/ROADMAP.md) — bosqichlar rejasi
- [docs/LLM.md](docs/LLM.md) — LLM ulash va provayder interfeysi
- [docs/LOCAL-LLM.md](docs/LOCAL-LLM.md) — lokal model: qaysi model, qancha VRAM, qancha pul
- [docs/VPS.md](docs/VPS.md) — serverga o‘rnatish, systemd, zaxira nusxa
- [docs/CALLS.md](docs/CALLS.md) — telefon qo‘ng‘irog‘i (Asterisk, Twilio)
- [docs/TELEGRAM.md](docs/TELEGRAM.md) — Telegram bot, xavfsizlik, webhook va hosting (Vercel haqida ham)
- [docs/VOICE.md](docs/VOICE.md) — ovoz: eshitish (Whisper), ovozli buyruqlar, gapirish (TTS)
- [scripts/tts/README.md](scripts/tts/README.md) — o‘zbekcha ovoz skripti (MMS-TTS)

## Litsenziya

MIT — [LICENSE](LICENSE).
