# SMS shlyuzi

```bash
hamroh aloqa sms +998901234567 "Ertaga soat 10 da kutamiz"
```

Xabar avval **navbatga** tushadi, keyin yuboriladi. Shlyuz javob bermasa — yo'qolmaydi,
har 5 daqiqada qayta uriniladi.

## Eng muhimi: Eskiz ixtiyoriy matn yubortirmaydi

Bu birinchi kunda hammani chalkashtiradigan narsa, shuning uchun boshida aytamiz.

O'zbekistonda SMS matni **operator moderatsiyasidan o'tgan shablonga mos** bo'lishi kerak.
Ya'ni siz avval shablonni Eskiz kabinetiga qo'shasiz («Hurmatli mijoz, sizni {sana} kuni
kutamiz»), u tasdiqlanadi, keyingina shu ko'rinishdagi xabarlar ketadi.

- Tasdiqlanmagan matn → `400` xatosi. Hamroh bu holatda izoh beradi:
  «ehtimol matn moderatsiyadan o'tgan shablonga mos emas»
- Sinov uchun Eskiz maxsus test matnini qabul qiladi — kabinetda ko'rsatilgan
- `ESKIZ_FROM=4546` — sinov jo'natuvchisi. O'z nomingiz (alfa-nom) alohida ro'yxatdan o'tadi

Shuning uchun avtomatik xabarlar uchun **oldindan bir nechta shablon tasdiqlatib qo'ying**:
eslatma, uchrashuv tasdiqlash, to'lov haqida.

## Ulash

```
HAMROH_SMS=eskiz
ESKIZ_EMAIL=siz@example.uz
ESKIZ_PASSWORD=...
ESKIZ_FROM=4546
```

Sozlash ustasi orqali ham: `npm run sozlash` (5-bosqich).

Tekshirish:

```bash
hamroh aloqa balans
```

Token 30 kunga beriladi va bazada saqlanadi — har SMS uchun qaytadan kirilmaydi.
Muddati tugasa yoki `401` kelsa, avtomatik qayta kiriladi.

## Buyruqlar

| Buyruq | Nima qiladi |
| --- | --- |
| `aloqa sms <raqam> "<matn>"` | Navbatga qo'yadi va darhol yuboradi |
| `aloqa sms <raqam> "<matn>" --keyin` | Faqat navbatga qo'yadi |
| `aloqa send [--limit=20]` | Navbatdagilarni yuborish |
| `aloqa outbox` | Yuborilmaganlar va xatolari |
| `aloqa balans` | Shlyuzdagi balans va bugungi sarf |

Avtomatik: `aloqa.sms-navbat` har 5 daqiqada navbatni bo'shatadi (`npm run daemon`).

Ovozli yoki matnli buyruq orqali ham ishlaydi:

```
«Nodira opaga sms yubor ertaga soat 10 da kutamiz»
```

Raqam aytilmasa — ism bo'yicha lidlar va qo'ng'iroqlar tarixidan qidiriladi.
SMS **har doim tasdiq so'raydi** (Telegramda tugma bilan).

## Ikkita xavfsizlik to'sig'i

**1. Kunlik chegara.** Standart — 50 ta. Avtomatlashtirilgan tizim xato tufayli
yuzlab SMS yuborib, hisobingizni bo'shatib qo'yishi mumkin; chegara shuning oldini oladi.

```
HAMROH_SMS_DAILY_LIMIT=50
```

Chegaraga yetganda qolgan xabarlar **navbatda qoladi** — yo'qolmaydi, ertaga ketadi.

**2. Tasdiq.** `aloqa sms` — tashqariga chiqadigan buyruq, shuning uchun ovozli/matnli
buyruqdan avtomatik bajarilmaydi.

## Xabar uzunligi va narx

Hamroh yuborishdan oldin ko'rsatadi:

```
43 belgi · 1 ta SMS (kirill/o‘zbekcha — 70 belgi chegara)
```

- Faqat lotin harflari: **160 belgi** bitta SMS
- O'zbekcha `o‘`, `g‘` yoki kirill bo'lsa: **70 belgi** (Unicode rejimi)

Ya'ni «o'» harfi tufayli xabar ikki barobar qimmatga tushishi mumkin. Qisqa matnlarda
buni hisobga oling.

## Boshqa shlyuzlar

```
HAMROH_SMS=cmd
HAMROH_SMS_CMD=python3 /opt/hamroh/my-sms.py --to {to} --text {text}
```

`{to}` — raqam, `{text}` — matn (ko'rsatilmasa matn `stdin` orqali beriladi).
Skript `0` kodi bilan tugasa — yuborildi hisoblanadi, `stdout` ning oxirgi qatori id bo'ladi.

Playmobile, o'z korporativ shlyuzingiz yoki xalqaro provayder — hammasi shu orqali ulanadi.

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| `kirish amalga oshmadi` | `ESKIZ_EMAIL` / `ESKIZ_PASSWORD` noto'g'ri |
| `400 ... shablonga mos emas` | Matn moderatsiyadan o'tmagan — kabinetda shablon qo'shing |
| `Kunlik chegara tugadi` | `HAMROH_SMS_DAILY_LIMIT` ni oshiring yoki ertaga kuting |
| Xabar `xato` holatida turibdi | `aloqa outbox` da sababi ko'rinadi; tuzatilgach `aloqa send` |

Endpoint yoki maydon nomlari o'zgargan bo'lsa, `ESKIZ_BASE` bilan boshqa manzil berish
mumkin. Eskiz hujjatlarini joriy holatda tekshirib turing — API vaqti-vaqti bilan yangilanadi.
