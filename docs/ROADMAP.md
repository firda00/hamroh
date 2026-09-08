# Bosqichlar rejasi

## Bosqich 1 — LLM'siz yadro ✅ (tayyor)

Maqsad: tizim LLM'siz ham foydali bo‘lsin. Barcha ma’lumot lokal, hamma hisob-kitob
deterministik. LLM ulanmasa ham kunlik ish to‘xtamaydi.

- 16 modul, 60+ buyruq, 20 ta cron vazifasi
- Lokal SQLite baza (23 jadval), nol runtime bog‘liqlik
- Kalitsiz tashqi manbalar: CBU (kurs), Open-Meteo (ob-havo), Google News RSS
- Ertalabki brifing va kun yakuni + o‘sish darajasi
- Haqiqiy `.xlsx` / `.docx` eksport, diagrammali HTML hisobot
- Telegram integratsiyasi (token bo‘lsa)
- 21 ta test, TypeScript tekshiruvi

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
- [ ] Xarajatlarni avtomatik toifalash (`classify` vazifasi allaqachon interfeysda bor)
- [ ] Kunlik hisobotga qisqa matnli xulosa

## Bosqich 3 — Tashqi integratsiyalar

Har biri alohida kalit/ruxsat talab qiladi, shuning uchun alohida bosqich:

- [ ] **Google Calendar** — ikki tomonlama (hozir faqat ICS import)
- [ ] **SMS shlyuzi** (Eskiz / Playmobile) — `aloqa sms` haqiqatan yuborsin
- [ ] **Telefon qo‘ng‘iroqlari** — Android eksporti yoki ATS integratsiyasi
- [ ] **Instagram Graph API** — qamrov, obunachi, kontent statistikasi
- [ ] **Google Ads API** — xarajat, bosish, konversiya
- [ ] **YouTube Data API** — ko‘rish, ko‘rish vaqti, obunachi
- [ ] **Google Business Profile** — qo‘ng‘iroq, yo‘nalish so‘rovi, izohlar
- [ ] **2GIS** — statistika eksporti
- [ ] **Sog‘liq** — Google Fit / Apple Health
- [ ] **PDF** — headless brauzer orqali to‘g‘ridan-to‘g‘ri PDF
- [ ] **Ovozli xabar** — Telegram audio → matn

## Bosqich 4 — Interfeys

- [ ] Telegram bot to‘liq boshqaruv paneli sifatida (tugmalar bilan)
- [ ] Veb interfeys (`npm run serve` allaqachon API beradi)
- [ ] Mobil bildirishnomalar

## Qaror qabul qilingan tamoyillar

1. **Ma’lumot lokal qoladi.** Bulutga majburiy bog‘lanish yo‘q.
2. **Har bir bosqich mustaqil ishlaydi.** Bosqich 2 ulanmasa ham 1 ishlaydi.
3. **Raqamlar o‘ylab topilmaydi.** LLM faqat mavjud ma’lumot ustida ishlaydi;
   yuridik va tibbiy javoblarda chegara aniq aytiladi.
4. **Bitta modul yiqilsa — tizim yiqilmaydi.** Brifing xatoni alohida bo‘lim qilib ko‘rsatadi.
