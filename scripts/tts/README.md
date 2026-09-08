# O'zbekcha TTS — MMS-TTS

`mms_tts_uz.py` — Meta MMS-TTS modeli orqali o'zbekcha ovoz. Hamroh'ga ikki xil ulanadi.

## O'rnatish

```bash
pip install -r scripts/tts/requirements.txt
```

`ogg` (Telegram "voice message") uchun `ffmpeg` ham kerak:

```bash
sudo apt install ffmpeg
```

## Ulash — 1-usul: server (tavsiya etiladi)

Modelni yuklash 3–10 soniya oladi. Serverda u **bir marta** yuklanadi, keyin har bir javob tez.

```bash
python3 scripts/tts/mms_tts_uz.py --serve --port 8010
```

`.env`:

```
HAMROH_TTS=http
HAMROH_TTS_URL=http://127.0.0.1:8010/v1
HAMROH_TTS_FORMAT=ogg
```

Server OpenAI-mos `/v1/audio/speech` beradi, shuning uchun Hamroh kodiga hech narsa qo'shilmaydi.

## Ulash — 2-usul: bir martalik

```
HAMROH_TTS=cmd
HAMROH_TTS_CMD=python3 /full/yo'l/scripts/tts/mms_tts_uz.py --out {out}
HAMROH_TTS_FORMAT=ogg
```

Matn `stdin` orqali beriladi. Har chaqiruvda model qaytadan yuklanadi — sinash uchun mos,
kundalik ish uchun server yaxshiroq.

## Sinash

```bash
echo "Assalomu alaykum. Bugun uchta uchrashuv bor." | python3 scripts/tts/mms_tts_uz.py --out sinov.ogg
```

Hamroh orqali:

```bash
npm run hamroh -- gap ayt "Dollar kursi o'n bir ming yetti yuz sakson to'qqiz so'm"
```

## Sozlamalar

| Bayroq | Standart | Nima qiladi |
| --- | --- | --- |
| `--rate` | `1.0` | Gapirish tezligi. `0.9` — sekinroq va tinchroq, `1.1` — shoshqaloq |
| `--expressiveness` | `0.667` | Ohang xilma-xilligi. `0.8` jonliroq, lekin ba'zan g'ijirlaydi |
| `--pause` | `0.22` | Gaplar orasidagi pauza (soniya). Uzun hisobotlarda `0.3` qulayroq |
| `--model` | avtomatik | HuggingFace model nomi |
| `--format` | `--out` kengaytmasi | `wav` \| `ogg` \| `mp3` |

Model nomi avtomatik tanlanadi: `facebook/mms-tts-uzn-script_latin` → `facebook/mms-tts-uzb`
→ `facebook/mms-tts-uzn`. Birortasi ishlamasa, skript sinab ko'rilganlarni ro'yxat qilib chiqaradi —
HuggingFace'dagi joriy nomni topib `--model` bilan bering.

## "Robot kabi eshitilmasligi" uchun

Eng katta ta'sir modeldan emas, **matndan**. Hamroh javobni TTS ga berishdan oldin
`src/util/speech.ts` orqali tayyorlaydi:

| Xom matn | Ovozga beriladigan matn |
| --- | --- |
| `USD 11 789,33 UZS ↑ +0,4%` | `dollar o'n bir ming yetti yuz sakson to'qqiz so'm nol butun to'rt foizga oshdi` |
| `📅 #3 — 2026-09-09 15:00` | `raqam uch, to'qqizinchi sentyabr soat uchda` |
| Jadval chiziqlari, emoji | olib tashlanadi |

Skript ham o'z navbatida qolgan raqamlarni so'zga aylantiradi (alohida ishlatilganda kerak),
gaplarga bo'ladi va har birini alohida sintez qilib orasiga pauza qo'yadi — shu narsa
uzluksiz o'qishdan ko'ra tabiiyroq eshitiladi.

Qolgan sozlash: `--rate 0.95 --pause 0.3` odatda vazminroq va yoqimliroq chiqadi.

## Ochiq gap: sifat haqida

MMS-TTS — 1000+ tilni qamrab olgan tadqiqot modeli. O'zbekcha ovozi **tushunarli, lekin
tabiiy odam ovozi darajasida emas**: intonatsiya bir xilroq, ba'zi so'zlarda urg'u xato.
Yuqoridagi matn tayyorlash buni sezilarli yaxshilaydi, ammo butunlay yo'qotmaydi.

Agar sifat yetarli bo'lmasa:

1. **Mahalliy tijorat xizmatlari** (Mohir AI va shunga o'xshashlar) — ancha tabiiy ovoz beradi.
   Ular ham OpenAI-mos bo'lsa `HAMROH_TTS=http` bilan, bo'lmasa kichik skript orqali
   `HAMROH_TTS=cmd` bilan ulanadi. Minusi: pullik va matn tashqariga chiqadi.
2. **TTS ni umuman o'chirish** — matnli javob Telegramga baribir keladi va ko'p hollarda
   o'qish tinglashdan tezroq.

Ya'ni ovozli javob — qulaylik, majburiyat emas. Avval sinab ko'ring, keyin qaror qiling.
