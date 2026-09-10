# Rol paketlari

Navyk «nima qila oladi» degan savolga javob beradi ([SKILLS.md](SKILLS.md)).
Rol paketi esa **«kim bo‘lib ishlaydi»**: nimaga ruxsati bor, qanday tartibda
ishlaydi, qayerda to‘xtab so‘raydi, qaysi raqamlar bo‘yicha baholanadi va
qilgan ishi qayerda yozib boriladi.

Birinchi paket — **NEMO Marketing Employee v1**.

```bash
node scripts/demo-rol.ts     # mijozga ko'rsatish uchun to'liq ssenariy
```

```bash
hamroh rol korish            # rol nima qiladi va nimaga ruxsati bor
hamroh rol yoq marketing-employee
hamroh rol navbat            # tasdiq kutayotgan amallar
hamroh rol kpi --days=7 --html
hamroh rol audit             # jurnal zanjirini tekshirish
```

Panelda: **Rol** sahifasi — o‘sha narsalar tugmalar bilan.

## Asosiy qoida

> **Ruxsat berilmagan hamma narsa taqiqlangan.**

Ro‘yxatda yo‘q buyruq bajarilmaydi. Bu «xato» emas — shunday mo‘ljallangan.
Ro‘yxatning o‘zi uch xil:

| Rejim | Ma'nosi | Misol |
| --- | --- | --- |
| `auto` | O‘zi bajaradi | raqam yig‘ish, hisobot yasash — hammasi o‘qish yoki lokal fayl |
| `approval` | To‘xtaydi va sizdan so‘raydi | Telegramga yuborish, kalendarga yozish |
| `deny` | Umuman bajarilmaydi | moliya, SMS, qo‘ng‘iroq |

Aniq mos (`marketing:report`) modul darajasidan (`marketing:*`) ustun turadi.
Hech narsa mos kelmasa — taqiq.

## NEMO Marketing Employee v1

**Vazifasi:** har kuni marketing raqamlarini yig‘ib, tahlil qilib, tayyor
hisobot beradi va o‘sish uchun nima qilish kerakligini aytadi.

Mavjud vositalardan yig‘ilgan — **yangi integratsiya qo‘shilmagan**:
Instagram, Google Ads, YouTube, Google Business Profile ([MARKETING.md](MARKETING.md)),
hujjatlar va kalendar.

### Nima qiladi

- Instagram, Ads, YouTube, Google Business raqamlarini har kuni yig‘adi
- Lid voronkasini kuzatadi
- Haftalik diagrammali hisobot tayyorlaydi (HTML va Excel)
- CPL, CTR, konversiyani hisoblab, o‘zgarish sababini ko‘rsatadi
- Haftalik sharh uchrashuvini kalendarga qo‘yishni **taklif qiladi**
- Hisobotni Telegramga yuborishni **taklif qiladi**

### Nima qilmaydi

- Reklama kampaniyalariga va byudjetga tegmaydi
- Pul harakati bilan ishlamaydi — moliya moduliga umuman kirmaydi
- SMS yubormaydi, qo‘ng‘iroq qilmaydi
- Mijozlarga o‘zi yozmaydi
- Hisoblarga ulanish ruxsatini o‘zi so‘ramaydi (OAuth — faqat siz)
- Raqam yo‘q bo‘lsa o‘ylab topmaydi — «ma’lumot yo‘q» deb yozadi

### Ish oqimi

| Qadam | Jadval | Amal | Rejim |
| --- | --- | --- | --- |
| Raqamlarni yig‘ish | har kuni 09:00 | `marketing:sync` | o‘zi |
| Lid voronkasi | har kuni 09:10 | `lid:funnel` | o‘zi |
| Haftalik hisobot | har kuni 09:20 | `marketing:report` | o‘zi |
| Tahlil va tavsiyalar | har kuni 09:25 | `marketing:advise` | o‘zi |
| Lidlar jadvali | dushanba 10:00 | `lid:export` | o‘zi |
| Sharh uchrashuvi | dushanba 10:15 | `kalendar:add` | ⏸ tasdiq |
| Hisobotni yuborish | dushanba 10:30 | `telegram:send` | ⏸ tasdiq |

Har bir qadam alohida cron vazifasi. Rol o‘chirilgan bo‘lsa hech biri ishlamaydi.

### KPI

| Ko‘rsatkich | Maqsad | Nega |
| --- | --- | --- |
| Bitta lid narxi (CPL) | ≤ 50 000 so‘m | Reklama samarasi shu raqamda ko‘rinadi |
| Davrdagi lidlar | ≥ 40 ta | Marketingning yakuniy mahsuloti |
| Qamrov | ≥ 60 000 | Auditoriya o‘smasa, lid ham o‘smaydi |
| CTR | ≥ 1.5% | Kreativ va matn ishlayaptimi |
| Ma’lumot yangiligi | ≤ 26 soat | Eski raqam ustida qaror — qimmat xato |
| Ish oqimi bajarilishi | ≥ 90% | Rol o‘z jadvalida ishlayaptimi |

Maqsaddan 10% ichida — «chegarada» (🟡), undan yomoni — «yomon» (🔴).
Ma’lumot yetmasa — ⚪ va **nol yozilmaydi**.

## Tasdiq nuqtalari

Tasdiq talab qiladigan amal bajarilmaydi — navbatga tushadi:

```bash
hamroh rol navbat
hamroh rol tasdiq 1 --korish    # nima bajarilishini aynan ko'rish
hamroh rol tasdiq 1             # tasdiqlash va bajarish
hamroh rol rad 2 "hozir kerak emas"
```

Uch kafolat:

1. **Ko‘rgan narsangiz bajariladi.** Buyruq ham, argumentlar ham navbatga
   qo‘yilgan ko‘rinishda saqlanadi va o‘zgarmaydi.
2. **Tasdiqdan keyin ruxsat qayta tekshiriladi.** Paket yangilanib, amal
   taqiqlangan bo‘lsa — eski navbatdagi so‘rov ham bajarilmaydi.
3. **Ikki marta tasdiqlab bo‘lmaydi.**

Jadval bo‘yicha ishlaganda tasdiq kerak bo‘lsa, bildirishnoma keladi
(Telegram ulangan bo‘lsa — o‘sha yerga).

## Jurnal: o‘zgartirsangiz bilinadi

Har bir yozuv oldingisining `sha256` barmoq izini o‘z ichiga oladi.
Bitta qatorni o‘zgartirsangiz yoki o‘chirsangiz — undan keyingi barcha
hash’lar mos kelmay qoladi.

```bash
hamroh rol audit
```

```
✅ Zanjir butun: 25 ta yozuv tekshirildi.
```

Jurnalni tahrirlab ko‘ring:

```
❌ ZANJIR UZILGAN
   Yozuv #22 (2026-09-10T07:51:21.083Z)
   Hodisa: tasdiq.berildi
   Sabab: yozuv mazmuni o‘zgartirilgan
```

**Nimani kafolatlaydi va nimani yo‘q.** Bu «o‘chirib bo‘lmaydi» degani emas:
bazaga kirish huquqi bo‘lgan odam faylni butunlay almashtira oladi. Bu
**«bildirmay o‘zgartirib bo‘lmaydi»** degani — auditor uchun asosiy narsa shu.
Kuchliroq kafolat kerak bo‘lsa: jurnalni tashqi tizimga nusxalash yoki
kunlik hash’ni alohida joyda saqlash.

### Hodisalar

| Hodisa | Qachon |
| --- | --- |
| `rol.yoqildi` / `rol.to‘xtatildi` | Odam rolni yoqdi yoki to‘xtatdi |
| `qadam.boshlandi` | Ish oqimi qadami boshlandi |
| `qadam.bajarildi` / `qadam.xato` | Qadam tugadi |
| `ruxsat.rad_etildi` | Taqiqlangan amalga urinish |
| `tasdiq.so‘raldi` | Amal navbatga qo‘yildi |
| `tasdiq.berildi` / `tasdiq.rad_etildi` | Odam qaror qildi |
| `amal.bajarildi` | Buyruq haqiqatan bajarildi |
| `kpi.o‘lchandi` | Ko‘rsatkichlar hisoblandi |

`actor` maydoni kim qilganini ko‘rsatadi: `agent`, `odam` yoki `tizim`.

## «Bajarildi» haqiqatan bajarilgan degani

Buyruq xato bermasdan ham ish qilmasligi mumkin — masalan argument yetishmasa,
foydalanish ko‘rsatmasini qaytaradi. Shuning uchun qadamda `verify` bo‘ladi:

```ts
{
  id: 'uchrashuv',
  action: 'kalendar:add',
  args: ['Marketing sharhi', '--at=dushanba 11:00', '--dur=45'],
  verify: (r) => (r.data ? null : 'uchrashuv yaratilmadi'),
}
```

`verify` yo‘q qadam buyruqqa ishonadi.

## Yangi rol paketi yozish

`src/roles/packs/` ga fayl qo‘shiladi va `src/roles/index.ts` ga ro‘yxatga olinadi.
Yuklanganda tekshiriladi — xato mijozda emas, shu yerda ko‘rinadi:

```bash
hamroh rol list
```

Tekshiruv nimani ushlaydi:

| Xato | Sabab |
| --- | --- |
| `bunday buyruq yo‘q: x:y` | Ruxsat mavjud bo‘lmagan buyruqqa berilgan |
| `<qadam>: ruxsat ro‘yxatida yo‘q` | Ish oqimiga qadam qo‘shildi, ruxsat unutildi |
| `ruxsat takrorlangan` | Bir amal ikki marta yozilgan |
| `<amal>: sabab yozilmagan` | `why` bo‘sh — mijozga tushuntirib bo‘lmaydi |

Oxirgisi ataylab qattiq: har bir ruxsatning **nega** berilgani yozilishi shart.
Mijoz «bu rol nimaga tega oladi?» deb so‘raganda javob shu jadvalda bo‘ladi.

## Rolni to‘xtatish

```bash
hamroh rol ochir marketing-employee
```

Jadval to‘xtaydi. Navbatdagi tasdiqlar saqlanib qoladi — ular sizning
hal qilinmagan qarorlaringiz, rol bilan birga o‘chib ketmaydi.

## Cheklovlar

- Bitta rol paketi bor. Ikkinchisi qo‘shilsa ikkalasi mustaqil ishlaydi.
- Rollar orasida ish taqsimoti yo‘q: har biri o‘z jadvali bo‘yicha ishlaydi.
- Tasdiqni Telegram tugmasi bilan berish hali yo‘q — bildirishnoma keladi,
  qaror panel yoki CLI orqali beriladi.
