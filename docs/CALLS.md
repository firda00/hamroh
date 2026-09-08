# Telefon qo‘ng‘irog‘i

Agent o‘zi qo‘ng‘iroq qilib, brifing yoki shoshilinch eslatmani aytib beradi.

```bash
hamroh qongiroq brifing
```

```bash
hamroh qongiroq qil +998901234567 "Arenda to‘lovi bugun, unutmang"
```

## Qanday ishlaydi

```
matn
  └→ src/util/speech.ts    raqamlar so‘zga, belgilar tozalanadi
  └→ TTS                   ovoz fayli (MMS-TTS yoki boshqa)
  └→ operator              Asterisk yoki Twilio
  └→ qo‘ng‘iroq
       └→ (javob yozilsa)  Whisper → matn → buyruq sifatida bajariladi
```

Qo‘ng‘iroq `calls` jadvaliga `direction='out'` bo‘lib yoziladi — tarix saqlanadi.

## Xavfsizlik — birinchi navbatda

**Faqat ruxsat berilgan raqamlarga qo‘ng‘iroq qilinadi.**

```
HAMROH_TEL_MY_NUMBER=+998901234567
HAMROH_TEL_ALLOWED=+998907776655
```

Ro‘yxat **bo‘sh bo‘lsa hech kimga qo‘ng‘iroq qilinmaydi**. Bu ataylab: noto‘g‘ri
eshitilgan ovozli buyruq begona odamga qo‘ng‘iroq qilib yubormasligi kerak.

Ovozli/matnli buyruq orqali kelgan `qongiroq qil` har doim **tasdiq so‘raydi**
(Telegramda tugma bilan).

## 1-usul: Asterisk (o‘z serveringizda)

Eng mos variant — ayniqsa O‘zbekistonda: mahalliy operatordan SIP trunk olasiz,
Asterisk shu serverning o‘zida turadi, ovoz tashqariga chiqmaydi, daqiqa narxi mahalliy.

```bash
sudo apt install asterisk
```

SIP trunk sozlangandan keyin `/etc/asterisk/extensions.conf` ga:

```
[hamroh-out]
exten => s,1,Answer()
 same => n,Wait(1)
 same => n,Playback(${HAMROH_SOUND})
 same => n,ExecIf($["${HAMROH_RECORD}" != ""]?Record(${HAMROH_RECORD}.wav,3,30))
 same => n,Hangup()
```

`.env`:

```
HAMROH_TEL=cmd
HAMROH_TEL_CMD=/opt/hamroh/scripts/tel/asterisk-call.sh {to} {audio} {record}
HAMROH_TEL_MY_NUMBER=+998901234567
```

Skript ovozni Asterisk kutadigan formatga (8 kHz mono wav) o‘giradi va call-file yaratadi.
Trunk nomi boshqacha bo‘lsa: `ASTERISK_TRUNK=nomi` muhit o‘zgaruvchisi.

## 2-usul: Twilio (xalqaro)

```
HAMROH_TEL=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...
HAMROH_TEL_AUDIO_BASE=https://sizning-domen.uz
```

**Cheklov:** Twilio ovozni internetdan oladi (`<Play>` URL), ya'ni `npm run serve`
ishlab turishi va domen orqali ochiq bo‘lishi kerak. Server `/audio/<fayl>` yo‘lida
beradi; fayl nomi UUID — taxmin qilib bo‘lmaydi.

Twilio ning o‘z `<Say>` i **o‘zbek tilini bilmaydi**, shuning uchun biz o‘z TTS imizdan
foydalanamiz.

Yana ikki narsani oldindan tekshiring:
- Twilio hisobingizda **+998 yo‘nalishi ochiqmi** (ba'zi yo‘nalishlar hujjat talab qiladi)
- Daqiqa narxi — xalqaro qo‘ng‘iroq mahalliy trunkdan qimmatroq

## 3-usul: mahalliy shlyuz yoki boshqa API

`cmd` provayderi istalgan dasturni chaqira oladi:

```
HAMROH_TEL=cmd
HAMROH_TEL_CMD=python3 /opt/hamroh/my-gateway.py --to {to} --audio {audio}
```

O‘rin egallovchilar: `{to}`, `{audio}`, `{text}`, `{record}`.
Skript 0 kodi bilan tugasa — qo‘ng‘iroq muvaffaqiyatli hisoblanadi.
`{record}` fayliga yozuv qoldirsa — u avtomatik matnga o‘giriladi.

## Buyruqlar

| Buyruq | Nima qiladi |
| --- | --- |
| `qongiroq status` | Operator, TTS, ruxsat ro‘yxati holati |
| `qongiroq qil <raqam> "<matn>" [--javob]` | Qo‘ng‘iroq qilib gapni aytish |
| `qongiroq brifing [--kechqurun]` | Menga qo‘ng‘iroq qilib brifingni o‘qish |
| `qongiroq eslatma` | Navbatdagi eslatmalarni aytish |

Avtomatik shoshilinch qo‘ng‘iroq (to‘lov muddati, hisobot) — ataylab **o‘chirilgan**,
chunki qo‘ng‘iroq bezovta qiladi. Yoqish:

```
HAMROH_TEL_URGENT=1
```

Har 30 daqiqada (08:00–21:00) tekshiradi va faqat haqiqiy shoshilinch narsa bo‘lsa qo‘ng‘iroq qiladi.

## «Gaplashish» haqida ochiq gap

Hozir qo‘ng‘iroq **bir tomonlama + bitta javob**: agent gapiradi, siz javob berasiz,
javob yozib olinadi va matnga o‘girilib bajariladi. Bu ko‘p holatda yetarli:

> — «Ertalabki brifing. Bugun uchta uchrashuv bor…»
> — (siz) «Uchinchisini bekor qil»
> — buyruq bajariladi

**To‘liq jonli suhbat** (gapingizni bo‘lish, real vaqtda javob berish) boshqacha
texnologiya talab qiladi: audio oqimini WebSocket orqali uzatish, ovoz faolligini
aniqlash (VAD), 300 ms dan kam kechikish. Bu alohida loyiha hajmidagi ish va
hozircha rejaga kiritilmagan.

Turn-based variant nima uchun amalda yaxshi ishlaydi: siz gapirib bo‘lguningizcha
kutadi, ya'ni yarim aytilgan gapni noto‘g‘ri tushunmaydi — bu moliya buyruqlari uchun
muhimroq.

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| `Qo‘ng‘iroq yoqilmagan` | `HAMROH_TEL` sozlanmagan |
| `Qo‘ng‘iroq uchun TTS kerak` | Avval `HAMROH_TTS` ni yoqing ([VOICE.md](VOICE.md)) |
| `ruxsat ro‘yxatida yo‘q` | Raqamni `HAMROH_TEL_ALLOWED` ga qo‘shing |
| `HAMROH_TEL_AUDIO_BASE yo‘q` | Twilio uchun ommaviy domen kerak — yoki Asterisk ishlating |
| Asterisk qo‘ng‘iroq qilmayapti | `/var/log/asterisk/full` ni ko‘ring; trunk nomi to‘g‘rimi |
