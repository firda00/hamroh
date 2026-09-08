# Ovozli xabarlar → matn (Whisper)

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

## Hali yo‘q

- **Ovozli buyruq** («ertaga soat 3 da uchrashuv qo‘y» → kalendarga yozish) — matn tayyor,
  uni buyruqqa aylantirish LLM ulangandan keyin qo‘shiladi ([ROADMAP.md](ROADMAP.md), bosqich 2).
- Video fayllardan audio ajratish — hozir `video_note` (dumaloq video) qo‘llab-quvvatlanadi,
  oddiy videolar uchun `ffmpeg` bilan oldindan ajratish kerak.
