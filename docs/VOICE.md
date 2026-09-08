# Ovoz: eshitish, tushunish, gapirish

Telegramga kelgan ovozli xabar avtomatik matnga o‘giriladi, bazaga yoziladi va
brifingda ko‘rinadi. Uzun xabarning qisqacha mazmunini ham olish mumkin.

## Qanday ishlaydi

```
Telegram ovozli xabar
        │  telegram poll  → messages jadvaliga media_kind='voice', media_id saqlanadi
        ▼
   ovoz sync (yoki har 10 daqiqada avtomatik)
        │  Telegramdan fayl yuklanadi (getFile → download)
        ▼
   Whisper serveri  POST /v1/audio/transcriptions
        │
        ▼
   messages.body = matn, transcribed_at = vaqt
        │
        ▼
   eslatma navbatiga tushadi → Telegram yoki konsolga
```

Ovoz **hech qachon** LLM ga yuborilmaydi — faqat Whisper serveriga. Server sizniki bo‘lsa,
yozuv mashinadan chiqmaydi.

## O‘rnatish

### 1. Whisper serverini ko‘taring

GPU li serverda (eng oson yo‘l — Docker):

```bash
docker run -d --gpus all -p 8000:8000 --name whisper fedirz/faster-whisper-server:latest-cuda
```

GPU siz (sekinroq, kichik model bilan ishlatiladi):

```bash
docker run -d -p 8000:8000 --name whisper fedirz/faster-whisper-server:latest-cpu
```

Muqobillar — kod hammasi bilan bir xil ishlaydi, chunki OpenAI-mos endpoint:

| Server | URL | Izoh |
| --- | --- | --- |
| faster-whisper-server / Speaches | `http://127.0.0.1:8000/v1` | Tavsiya etiladi, model avtomatik yuklanadi |
| whisper.cpp `server` | `http://127.0.0.1:8080/v1` | Eng kam resurs, CPU da ham qoniqarli |
| LocalAI | `http://127.0.0.1:8080/v1` | Bir nechta model bitta serverda |
| OpenAI API | `https://api.openai.com/v1` | Lokal emas — ovoz tashqariga chiqadi |

### 2. `.env` ga qo‘shing

```
HAMROH_STT=local
HAMROH_STT_URL=http://127.0.0.1:8000/v1
HAMROH_STT_MODEL=Systran/faster-whisper-large-v3
HAMROH_STT_LANG=uz
```

### 3. Tekshiring

```bash
npm run hamroh -- ovoz status
```

`server ✓` chiqishi kerak. Keyin bitta fayl bilan sinang:

```bash
npm run hamroh -- ovoz fayl ./yozuv.ogg
```

## Buyruqlar

| Buyruq | Nima qiladi |
| --- | --- |
| `hamroh ovoz status` | Server holati va navbatdagi xabarlar soni |
| `hamroh ovoz fayl <yo‘l> [--save]` | Lokal audio faylni matnga o‘girish |
| `hamroh ovoz sync [--limit=10]` | Telegramdan kelganlarni o‘girish |
| `hamroh ovoz list` | O‘girilgan xabarlar ro‘yxati |
| `hamroh ovoz xulosa <id>` | Uzun xabarning qisqacha mazmuni (LLM kerak) |

Avtomatik: `ovoz.sync` har 10 daqiqada ishlaydi (`npm run daemon` yoqilgan bo‘lsa).
Har bir o‘girilgan xabar eslatma navbatiga tushadi.

## O‘zbek tili haqida — muhim

Whisper o‘zbekchani qo‘llab-quvvatlaydi, lekin **xatolik darajasi ingliz tilidagidan
sezilarli yuqori**. Sabab — o‘qitish ma'lumotlarida o‘zbekcha nutq kam.

Aniqlikni oshirish yo‘llari:

1. **Eng katta modelni oling.** `large-v3` — `medium` yoki `turbo` dan ancha yaxshi.
   24 GB VRAM da u atigi ~1,5 GB egallaydi, ya'ni Qwen3 14B bilan birga bemalol sig‘adi.

2. **Tilni qo‘lda ko‘rsating.** `HAMROH_STT_LANG=uz` — model tilni o‘zi topishga urinmaydi
   va ruschaga «sirg‘alib ketmaydi». Agar siz o‘zbekcha va ruschani aralashtirib gapirsangiz,
   bu qatorni bo‘sh qoldiring.

3. **Atamalarni oldindan ayting.** Tez-tez uchraydigan ismlar, kompaniya nomlari, mahsulotlar:

   ```
   HAMROH_STT_HINT=Ustudy, Firdavs, Toshkent, arenda, lid, buxgalter
   ```

   Bu Whisper ning `prompt` maydoniga uzatiladi va shu so‘zlarni to‘g‘ri yozish ehtimolini oshiradi.

4. **O‘zbekcha uchun maxsus o‘qitilgan model qidiring.** HuggingFace da `whisper uzbek`
   bo‘yicha qidiruv bir nechta fine-tuned variantni beradi. Ular umumiy `large-v3` dan
   ancha yaxshi natija berishi mumkin. Topsangiz, model nomini shunchaki almashtiring:

   ```
   HAMROH_STT_MODEL=<huggingface/model-nomi>
   ```

   (faster-whisper-server modelni avtomatik yuklab oladi.)

Sinash uchun eng to‘g‘ri yo‘l — **o‘zingizning 3–4 ta haqiqiy ovozli xabaringizni**
`ovoz fayl` bilan o‘tkazib ko‘rish. Natija ish uchun yaroqsiz bo‘lsa, matnni qo‘lda
tuzatish uzoq davom etadi — bunday holda ovoz modulini yoqmagan ma'qul.

## Resurs sarfi

| Model | VRAM (int8) | Tezlik (3090 da) |
| --- | --- | --- |
| `large-v3` | ~1,5 GB | 1 daqiqa audio ≈ 2–4 soniya |
| `large-v3-turbo` | ~1,5 GB | ~2 barobar tez, sifati biroz pastroq |
| `medium` | ~0,8 GB | Tez, lekin o‘zbekchada zaif |

Qwen3 14B (~9 GB) + Whisper large-v3 (~1,5 GB) = ~11 GB. 24 GB kartada ikkalasi
bir vaqtda ishlab turishi mumkin.

## Xatoliklarda

| Xato | Sabab va yechim |
| --- | --- |
| `Whisper serveri bilan aloqa yo‘q` | Server o‘chiq yoki URL noto‘g‘ri. `docker ps` bilan tekshiring |
| `Whisper bo‘sh matn qaytardi` | Audio jim, yoki format tanilmadi. Serverda `ffmpeg` borligini tekshiring |
| `Fayl yo‘lini olib bo‘lmadi` | Telegram tokeni noto‘g‘ri yoki fayl 20 MB dan katta (Bot API cheklovi) |
| Matn ruscha chiqmoqda | `HAMROH_STT_LANG=uz` qo‘yilganini tekshiring |

Server javob bermasa, `ovoz sync` o‘sha xabarni **o‘girilmagan holda qoldiradi** —
keyingi tikda qayta uriniladi, ma'lumot yo‘qolmaydi.

## Ovozli buyruqlar

Aytilgan gap buyruqqa aylanadi va bajariladi.

```bash
hamroh gap matn "ertaga soat uchda Aziz aka bilan uchrashuv qo‘y"
```

```bash
hamroh gap ovoz ./buyruq.ogg --ovoz
```

| Buyruq | Nima qiladi |
| --- | --- |
| `gap tushun "<gap>"` | Faqat tushunganini ko‘rsatadi, bajarmaydi — sinash uchun |
| `gap matn "<gap>" [--ovoz]` | Tushunadi va bajaradi; `--ovoz` bilan javobni gapiradi |
| `gap ovoz <fayl> [--ovoz]` | Audio → matn → buyruq → javob |
| `gap ayt "<matn>"` | Matnni ovozga aylantiradi (TTS tekshiruvi) |
| `gap status` | Zanjir holati: eshitish, tushunish, gapirish |

### Qoidaviy rejim nimani tushunadi (LLM'siz)

| Aytasiz | Bajariladi |
| --- | --- |
| «ertaga soat uchda Aziz aka bilan uchrashuv qo‘y» | `kalendar add "Aziz aka bilan" --at="2026-09-09 15:00"` |
| «eslatib qo‘y ertaga o‘nda bankka borish» | `vazifa add "bankka borish" --due=...` |
| «ikki yuz ming so‘m ovqatga sarfladim» | `moliya out 200000 --cat=ovqat` |
| «besh million so‘m tushdi» | `moliya in 5000000` |
| «instagramdan yangi mijoz keldi Nodira 998901234567» | `lid add Nodira --source=instagram --phone=...` |
| «o‘n ming qadam yurdim» | `soglik log steps 10000` |
| «bugun rejam qanday» / «dollar kursi» / «ob-havo» / «hisobot» | tegishli so‘rovlar |

Sonlar so‘z bilan ham tushuniladi: «ikki yuz ming», «besh million», «bir yuz yigirma besh ming».

**Soat qoidasi:** «soat uchda» → 15:00. 1–7 orasidagi soatlar kunduzgi deb olinadi
(«ertalab uchda» desangiz — 03:00). Har doim tushunilgan vaqt javobda ko‘rsatiladi,
shuning uchun xato darhol ko‘rinadi.

LLM ulansa (`HAMROH_LLM=local` yoki `anthropic`) — qoidalar tushunmagan gaplar modelga
uzatiladi va u 79 ta buyruqning istalganini tanlashi mumkin.

### Xavfsizlik

Tashqariga chiqadigan buyruqlar **ovozdan avtomatik bajarilmaydi**:
`telegram send`, `telegram file`, `telegram reply`, `aloqa sms`, `vazifa rm`, `kalendar rm`.
Ular uchun tasdiq so‘raladi (`--tasdiq`). Sababi oddiy: noto‘g‘ri eshitilgan gap
begona odamga SMS jo‘natib yubormasligi kerak.

### Telegramda avtomatik ishlashi

```
HAMROH_VOICE_COMMANDS=1
```

Shundan keyin Telegramga yuborgan ovozli xabaringiz har 10 daqiqada:
matnga o‘giriladi → buyruq sifatida bajariladi → javob Telegramga qaytadi
(TTS yoqilgan bo‘lsa — ovozli javob ham).

## Gapirish (TTS)

Ikki yo‘l bor.

**1) HTTP server** — OpenAI-mos `/audio/speech` (LocalAI, Speaches, openedai-speech):

```
HAMROH_TTS=http
HAMROH_TTS_URL=http://127.0.0.1:8000/v1
HAMROH_TTS_MODEL=tts-1
HAMROH_TTS_VOICE=alloy
HAMROH_TTS_FORMAT=ogg
```

**2) Istalgan dastur** — o‘zbekcha ovoz uchun eng moslashuvchan yo‘l:

```
HAMROH_TTS=cmd
HAMROH_TTS_CMD=piper -m uz.onnx -f {out}
HAMROH_TTS_FORMAT=ogg
```

`{out}` — yaratiladigan fayl yo‘li, `{text}` — matn (yozilmasa matn stdin orqali beriladi).

### O‘zbekcha ovoz — ochiq masala

Bu yerda vaziyat matndan ham qiyin: **tayyor o‘zbekcha ovozlar deyarli yo‘q**.
Ko‘pchilik ochiq TTS modellari (Piper, Kokoro, XTTS) o‘zbek tilini qamramaydi.

Amaliy variantlar:

1. **Meta MMS-TTS** — `facebook/mms-tts-uzb` modeli o‘zbek tilini qo‘llab-quvvatlaydi.
   Kichik Python skript yozib, uni `HAMROH_TTS_CMD` ga ulash mumkin — ovoz sifati
   o‘rtacha, lekin tushunarli va bepul.
2. **Mahalliy xizmatlar** — O‘zbekistonda o‘zbekcha TTS beradigan API lar bor
   (Mohir AI va shunga o‘xshashlar). Ular odatda tabiiyroq eshitiladi, lekin pullik
   va matn tashqariga chiqadi.
3. **Ruscha ovoz bilan o‘zbekcha matn** — ishlamaydi, tinglash qiyin. Tavsiya etilmaydi.

Ovoz sifati qoniqarsiz bo‘lsa, TTS ni o‘chirib qo‘ying: matnli javob baribir
Telegramga keladi va ko‘p hollarda shunisi qulayroq.

### Telegramda «voice message» bo‘lishi uchun

`HAMROH_TTS_FORMAT=ogg` qo‘ying — u holda javob haqiqiy ovozli xabar sifatida ketadi.
Boshqa formatlarda (mp3, wav) audio fayl sifatida yuboriladi.

## Hali yo‘q

- Video fayllardan audio ajratish — hozir `video_note` (dumaloq video) qo‘llab-quvvatlanadi,
  oddiy videolar uchun `ffmpeg` bilan oldindan ajratish kerak.
