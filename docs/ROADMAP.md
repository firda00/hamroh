# Bosqichlar rejasi

## Bosqich 1 — LLM'siz yadro ✅ (tayyor)

Maqsad: tizim LLM'siz ham foydali bo‘lsin. Barcha ma’lumot lokal, hamma hisob-kitob
deterministik. LLM ulanmasa ham kunlik ish to‘xtamaydi.

- 24 modul, 128 ta buyruq, 29 ta cron vazifasi
- Lokal SQLite baza (22 jadval), nol runtime bog‘liqlik
- Kalitsiz tashqi manbalar: CBU (kurs), Open-Meteo (ob-havo), Google News RSS
- Ertalabki brifing va kun yakuni + o‘sish darajasi
- Haqiqiy `.xlsx` / `.docx` eksport, diagrammali HTML hisobot
- Telegram integratsiyasi (token bo‘lsa)
- 118 ta test, TypeScript tekshiruvi

## Bosqich 2 — LLM ulash

Maqsad: bir sozlama bilan tahlil sifatini ko‘tarish. Modul kodi o‘zgarmaydi.

```bash
npm install @anthropic-ai/sdk
```

```
HAMROH_LLM=anthropic
ANTHROPIC_API_KEY=sk-ant-...
HAMROH_LLM_MODEL=claude-opus-5
```

Nima yaxshilanadi:

| Joy | Bosqich 1 | Bosqich 2 |
| --- | --- | --- |
| `yangilik top` | Eng "og‘ir" gaplarni ajratib beradi | Biznesga ta’siri bo‘yicha xulosa |
| `moliya advise` | Qoidaviy ogohlantirishlar | Xarajat tuzilmasiga qarab aniq qadamlar |
| `marketing advise` | CPL/CTR va o‘zgarishlar | Qaysi kanalni kuchaytirish, nima uchun |
| `hujjat content` | Format skeleti | To‘liq ssenariy va sarlavhalar |
| `yurist ask` | Bazadagi yozuvlar ro‘yxati | Yozuvlarga tayangan javob |
| `hamroh ask "..."` | Ishlamaydi | Erkin savol-javob |

Rejalashtirilgan qo‘shimchalar:

- [ ] Tabiiy tilda buyruq: `hamroh ask "ertaga soat 3 da Aziz aka bilan uchrashuv qo'y"` →
      to‘g‘ri modul buyrug‘iga aylantirish (tool-use orqali)
- [x] ~~Xarajatlarni avtomatik toifalash~~ (kalit so‘zlar + LLM: `moliya out 250k taksiga`)
- [ ] Kunlik hisobotga qisqa matnli xulosa
- [x] ~~Ovozli buyruq: ovozli xabar → modul buyrug‘i~~ (bajarildi: `gap` moduli)

## Navyklar (plaginlar)

- [x] ~~Modul-plaginlar: avtoyuklash, tools sxemasi, dispetcher~~ ([SKILLS.md](SKILLS.md))
- [x] ~~Nativ tool calling (OpenAI-mos: Ollama, vLLM, LM Studio)~~
- [x] ~~Qoralamalar: model yozadi, siz ko‘rasiz, siz yoqasiz~~
- [x] ~~Sandbox: fayl, jarayon va sirlar bloklanadi~~
- [ ] Claude uchun tools formati (hozir faqat OpenAI-mos endpoint)
- [ ] Sandboxda tarmoqni ham bloklash (Node da `--allow-net` yo‘q — proksi orqali)

## Bosqich 3 — Tashqi integratsiyalar

Har biri alohida kalit/ruxsat talab qiladi, shuning uchun alohida bosqich:

- [x] ~~**Google Calendar** — ikki tomonlama~~ (bajarildi: OAuth va xizmat hisobi, [GCALENDAR.md](GCALENDAR.md))
- [x] ~~**SMS shlyuzi** (Eskiz / Playmobile)~~ (bajarildi: `src/sms/`, [SMS.md](SMS.md))
- [ ] **Telefon qo‘ng‘iroqlari** — Android eksporti yoki ATS integratsiyasi
- [x] ~~**Instagram Graph API** — qamrov, ko‘rish, obunachi~~ ([MARKETING.md](MARKETING.md))
- [x] ~~**Google Ads API** — xarajat, bosish, konversiya~~
- [x] ~~**YouTube Analytics API** — ko‘rish, ko‘rish vaqti, obunachi~~
- [x] ~~**Google Business Profile** — qo‘ng‘iroq, yo‘nalish so‘rovi~~ (izohlar hali yo‘q)
- [x] ~~**2GIS** — CSV import~~ (ochiq API yo‘q; skrejping ataylab qilinmadi)
- [ ] **Sog‘liq** — Google Fit / Apple Health
- [ ] **PDF** — headless brauzer orqali to‘g‘ridan-to‘g‘ri PDF
- [x] ~~**Ovozli xabar** — Telegram audio → matn~~ (bajarildi: `ovoz` moduli, [VOICE.md](VOICE.md))

## Telefon qo‘ng‘irog‘i

- [x] ~~Agent qo‘ng‘iroq qilib gapiradi~~ (`qongiroq` moduli: Asterisk yoki Twilio)
- [x] ~~Javobni yozib olib, buyruq sifatida bajarish~~ (turn-based)
- [ ] To‘liq jonli suhbat (real vaqt oqimi, VAD, barge-in) — alohida loyiha hajmida

## Bosqich 4 — Interfeys

- [x] ~~Telegram bot to‘liq boshqaruv paneli sifatida (tugmalar bilan)~~ (bajarildi: `bot` moduli)
- [x] ~~Veb interfeys~~ (bajarildi: `npm run panel`, [WEB.md](WEB.md))
- [ ] Mobil bildirishnomalar

## Rol paketlari (lavozimlar)

- [x] ~~Rol paketi formati: ruxsat, ish oqimi, tasdiq, KPI, jurnal~~ ([ROLES.md](ROLES.md))
- [x] ~~NEMO Marketing Employee v1 — birinchi production paket~~
- [x] ~~Ruxsatlarni haqiqiy tekshirish: ro‘yxatda yo‘q amal bajarilmaydi~~
- [x] ~~Tasdiq navbati: CLI va panel orqali~~
- [x] ~~O‘zgarmas jurnal (hash zanjiri) va uni tekshirish~~
- [x] ~~Mijozga ko‘rsatish uchun demo ssenariy (`npm run demo-rol`)~~
- [ ] Telegram tugmasi bilan tasdiqlash
- [ ] Ikkinchi paket: sotuv yoki buxgalter roli

## Xavfsizlik

- [x] ~~Panel: token + CSRF, standart holatda faqat 127.0.0.1~~
- [x] ~~Telegram: ruxsat ro‘yxati majburiy (bo‘sh ro‘yxat = hech kimga javob yo‘q)~~
- [x] ~~SMS: kunlik chegara; telefon: faqat ro‘yxatdagi raqamlar~~
- [x] ~~JSON API: sarlavhadagi kalit, cookie qabul qilinmaydi (CSRF), 503 agar kalit yo‘q~~
- [x] ~~`POST /run`: tashqariga chiqadigan buyruqlar uchun `"confirm": true`~~
- [x] ~~Telegram webhook siri majburiy~~
- [ ] Navyklar sandboxida tarmoqni bloklash (Node da `--allow-net` yo‘q)
- [ ] Panelni internetga ochganda: nginx + HTTPS ko‘rsatmasi sinovdan o‘tkazilsin

## Qaror qabul qilingan tamoyillar

1. **Ma’lumot lokal qoladi.** Bulutga majburiy bog‘lanish yo‘q.
2. **Har bir bosqich mustaqil ishlaydi.** Bosqich 2 ulanmasa ham 1 ishlaydi.
3. **Raqamlar o‘ylab topilmaydi.** LLM faqat mavjud ma’lumot ustida ishlaydi;
   yuridik va tibbiy javoblarda chegara aniq aytiladi.
4. **Bitta modul yiqilsa — tizim yiqilmaydi.** Brifing xatoni alohida bo‘lim qilib ko‘rsatadi.
