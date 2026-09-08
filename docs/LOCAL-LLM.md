# Lokal model (o‘z serveringizda)

Hamroh uchta rejimda ishlaydi: `rules` (LLM'siz), `local` (o‘z serveringiz), `anthropic` (Claude API).
Uchalasi ham bir xil `LlmProvider` interfeysi ortida — almashtirish uchun modul kodiga tegilmaydi.

## Avval: sizga GPU server kerakmi?

Hamroh LLM'ni **kam va tez-tez emas** ishlatadi. Kunlik brifing, yangiliklar qisqartmasi,
moliya/marketing maslahati, ba'zi savollar — hammasi bo‘lib kuniga 20–40 ta so‘rov,
har biri ~1500 kirish + ~500 chiqish tokeni.

| Variant | Oyiga | Nima uchun |
| --- | --- | --- |
| `rules` (hozirgi) | **$0** | LLM umuman kerak emas — hisobotlar, eslatmalar, Excel, diagrammalar baribir ishlaydi |
| Claude Haiku 4.5 | **~$4** | Eng arzon API varianti, o‘zbekchani biladi |
| Claude Sonnet 5 | **~$7** | Sifat/narx muvozanati |
| Claude Opus 5 | **~$18** | Eng kuchli tahlil |
| RTX 3090 server 24/7 | **$45–52** (siz aytgan narx) | Ma'lumot serverdan chiqmaydi + ovozli xabarlarni matnga o‘girish |

**Xulosa: agar sabab tejash bo‘lsa — GPU server arzon emas.** Bu hajmda API 5–10 barobar arzon.
GPU server **ikkita** holatda o‘zini oqlaydi:

1. **Maxfiylik.** Moliya, buxgalteriya, shartnomalar, mijoz bazasi — hech qayerga yuborilmaydi.
   Sizning ma'lumotlaringiz hisobga olinsa, bu jiddiy sabab.
2. **Ovoz.** Telegram ovozli xabarlarini matnga o‘girish (Whisper) — bu doimiy GPU yuki,
   va aynan shu narsa API'da har daqiqa uchun pul turadi.

Uchinchi variant — **aralash**: maxfiy ishlar (xarajat toifalash, o‘z hisobotlaringizni
qisqartirish, ovoz → matn) lokal modelda, murakkab tahlil API'da. Hamroh arxitekturasi buni
qo‘llab-quvvatlaydi (`HAMROH_LLM` ni almashtirish kifoya).

### Narx haqida ogohlantirish

$45–52 — **dedicated RTX 3090 uchun bozor narxidan past**. Odatda 24/7 dedicated 3090
bundan qimmatroq turadi; bu narxda ko‘pincha *interruptible/spot* (istalgan payt o‘chib qolishi
mumkin) yoki *shared* GPU taklif qilinadi. Buyurtma berishdan oldin aniqlashtiring:

- GPU **to‘liq sizniki**mi yoki bo‘linganmi (shared)?
- **Interruptible** (spot) emasmi? Agar shunday bo‘lsa — daemon uzilib turadi.
- Oylik to‘lov ustidan **trafik/soat limiti** bormi?
- Diskda model og‘irligi uchun joy: 14B ≈ 9 GB, 27B ≈ 17 GB, + Whisper ≈ 1,5 GB.

Narxlar tez o‘zgaradi — mening ma'lumotim eskirgan bo‘lishi mumkin, buyurtma oldidan
joriy narxlarni o‘zingiz tekshiring.

## Qaysi model? (24 GB VRAM uchun)

Q4_K_M kvantlashda taxminan: **VRAM (GB) ≈ parametr (mlrd) × 0,6** + kontekst uchun 1–3 GB.

| Model | Q4 hajmi | 24 GB ga sig‘adimi | Kuchli tomoni | Zaif tomoni |
| --- | --- | --- | --- | --- |
| **Qwen3 14B** | ~9 GB | ✅ Whisper + katta kontekst bilan birga | Tez, ko‘p tilli, reasoning rejimi bor | 30B+ dan pastroq tahlil |
| **Qwen3 30B-A3B** (MoE) | ~18 GB | ✅ (Whisper CPU'da) | 30B sifati, 3B tezligi — MoE | Whisper bilan birga siqiq |
| **Gemma 3 27B** | ~17 GB | ✅ (siqiq) | Google'ning ko‘p tilli modeli, matn sifati yaxshi | Sekinroq, KV-kesh katta |
| **Mistral Small 24B** | ~14 GB | ✅ | Yaxshi muvozanat | O‘zbekcha kuchsizroq |
| Qwen3 32B | ~20 GB | ⚠️ juda siqiq | Eng kuchli variant | Whisper uchun joy qolmaydi |
| Llama 3.3 70B | ~42 GB | ❌ | — | Sig‘maydi |

**Tavsiya:** **Qwen3 14B** dan boshlang. Siz rejalashtirgan Qwen 2.5 14B ning yangiroq avlodi —
bir xil hajm, lekin kuchliroq va ko‘p tilli qo‘llab-quvvatlashi yaxshiroq. 9 GB egallaydi,
Whisper va 32K kontekst uchun joy qoladi. Sifat yetmasa — **Gemma 3 27B** ni sinang.

> Mening bilim chegaram 2026-yil mayida. Bundan keyin yangi modellar chiqqan bo‘lishi mumkin —
> `ollama.com/library` va HuggingFace'dagi joriy ro‘yxatni ko‘rib chiqing.

## Eng muhim risk: o‘zbek tili

Ochiq modellarning deyarli hammasi o‘zbekchani **ingliz yoki rus tilidan ancha yomon** biladi.
Model o‘zbekcha so‘ralganda ruschaga o‘tib ketishi, yoki g‘aliz tarjima yozishi mumkin.
Buni oldindan tekshirish kerak — shuning uchun repoda test bor:

```bash
npm run eval
```

Nimani o‘lchaydi:

- **Toifalash aniqligi** — 6 ta xarajat/lid matni to‘g‘ri toifaga tushdimi (aniq javobi bor)
- **O‘zbek tili** — javob o‘zbekcha lotinda qoldimi yoki boshqa tilga o‘tib ketdimi
- **O‘ylab topilgan raqam** — model berilmagan raqamlarni o‘ylab topdimi
- **Javob vaqti** — sizning GPU'ingizda amaldagi tezlik

Solishtirish uchun **LLM'siz qoidaviy rejim** natijasi: toifalash **3/6**, o‘zbek tili **3/3**,
o‘ylab topilgan raqam **0**. Lokal model shundan yaxshi bo‘lishi shart — aks holda uni
ulashning ma'nosi yo‘q.

```bash
HAMROH_LLM=local HAMROH_LLM_MODEL=qwen3:14b npm run eval
```

```bash
HAMROH_LLM=local HAMROH_LLM_MODEL=gemma3:27b npm run eval
```

## O‘rnatish

Serverda (Ubuntu 22.04/24.04 + CUDA):

```bash
curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen3:14b
```

Ollama 11434-portda OpenAI-mos API beradi. Hamroh shunga ulanadi — boshqa kutubxona kerak emas.

`.env`:

```
HAMROH_LLM=local
HAMROH_LLM_URL=http://127.0.0.1:11434/v1
HAMROH_LLM_MODEL=qwen3:14b
```

Tekshirish:

```bash
npm run hamroh -- doctor
```

`LLM:` qatorida `server ✓` va modellar ro‘yxati ko‘rinishi kerak.

### Server boshqa mashinada bo‘lsa

Ollama'ni tashqariga ochish **xavfli** — u autentifikatsiyasiz ishlaydi. To‘g‘ri yo‘l — SSH tunnel:

```bash
ssh -N -L 11434:127.0.0.1:11434 user@server-ip
```

Shundan keyin `HAMROH_LLM_URL=http://127.0.0.1:11434/v1` o‘zgarishsiz qoladi.

### Boshqa serverlar

Kod OpenAI-mos `/chat/completions` bilan ishlaydi, ya'ni quyidagilar ham to‘g‘ridan-to‘g‘ri:

| Server | URL | Izoh |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | Eng oson, model boshqaruvi ichida |
| llama.cpp server | `http://127.0.0.1:8080/v1` | Eng kam resurs |
| vLLM | `http://127.0.0.1:8000/v1` | Ko‘p parallel so‘rov uchun tez |
| LM Studio | `http://127.0.0.1:1234/v1` | Windows'da qulay GUI |

## Ovozli xabarlar (Whisper)

Telegram ovozli xabarini matnga o‘girish — GPU serverning eng asosli sababi.

- `faster-whisper` + `large-v3` (int8) ≈ 1,5 GB VRAM — Qwen3 14B bilan birga bemalol sig‘adi
- `large-v3-turbo` — ancha tez, sifati biroz pastroq

**Diqqat:** Whisper o‘zbekchani qo‘llab-quvvatlaydi, lekin xatolik darajasi (WER) yuqori —
ingliz tilidagidan sezilarli yomon. HuggingFace'da o‘zbekcha uchun maxsus o‘qitilgan
(fine-tuned) Whisper variantlarini qidiring, ular odatda ancha yaxshi natija beradi.

Hamroh'da transkripsiya hali ulanmagan — bu bosqich 3 rejasida
([ROADMAP.md](ROADMAP.md)). Modul `telegram poll` da ovozli xabarni `[audio]` deb qayd qiladi.

## Xatolikda nima bo‘ladi

Lokal server o‘chsa, sekin javob bersa yoki xato qaytarsa — Hamroh **avtomatik qoidaviy
rejimga tushadi** va ishni davom ettiradi. Ertalabki brifing model tufayli to‘xtamaydi.
Jurnalda ogohlantirish yoziladi:

```
WARN [llm] local:qwen3:14b javob bermadi (...) — qoidaviy rejim.
```

## Yakuniy tavsiya

1. **Hozir:** `rules` rejimida ishlatib turing — bu bepul va hamma hisobot ishlaydi.
2. **Keyin:** `npm run eval` ni Claude API bilan bir marta yurgizib, "yuqori chegara"ni ko‘ring.
3. **Server olishdan oldin:** GPU'ni soatbay ijaraga olib (masalan bir kunga), o‘sha yerda
   `npm run eval` ni Qwen3 14B va Gemma 3 27B bilan yurgizing. Natija qoidaviy rejimdan
   sezilarli yaxshi bo‘lsagina oylik serverga pul to‘lang.
