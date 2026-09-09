# Veb-panel

```bash
npm run panel
```

`http://127.0.0.1:7391` — brauzerda ochiladi. Telefondan ham qulay.

| Sahifa | Nima bor |
| --- | --- |
| Bosh sahifa | Kunlik ko‘rsatkichlar va o‘sish, bugungi ishlar, uchrashuvlar, to‘lanmagan majburiyatlar, e’tibor talab qiladigan narsalar |
| Vazifalar | Ro‘yxat, qo‘shish (vaqtni odam tilida: «ertaga 10:00»), bajarildi tugmasi |
| Kalendar | 14 kunlik jadval, uchrashuv qo‘shish, Google bilan sinxronlash |
| Moliya | Oylik yakun, toifalar diagrammasi, yozuv qo‘shish (toifa o‘zi aniqlanadi), maslahatlar |
| Lidlar | Oxirgi lidlar va yangi lid qo‘shish |
| Sozlamalar | Barcha ulanishlar holati, Google Calendar'ni ulash tugmasi |

Qurilish qadami yo‘q: sahifalar serverda yig‘iladi, npm paketi ishlatilmaydi.

## Kirish va xavfsizlik

Panel **moliyaviy ma'lumotni ko‘rsatadi**, shuning uchun uch qatlam himoya bor:

1. **Kalit majburiy.** `HAMROH_WEB_TOKEN` bo‘sh bo‘lsa panel **umuman ochilmaydi** —
   faqat API yo‘llari ishlaydi. Kirish bir marta, keyin cookie (HttpOnly, SameSite=Lax).
2. **Faqat localhost.** Standart `HAMROH_WEB_HOST=127.0.0.1` — serverdan tashqariga chiqmaydi.
3. **CSRF.** Har bir o‘zgartiruvchi forma tokendan hosil qilingan maxfiy qiymat bilan
   tekshiriladi; u bo‘lmasa amal bajarilmaydi.

```
HAMROH_WEB_TOKEN=uzun-tasodifiy-satr
HAMROH_PORT=7391
```

VPS o‘rnatgichi kalitni **o‘zi yaratadi** va o‘rnatish oxirida ko‘rsatadi.

### Serverdagi panelga qanday kirish

**Tavsiya etiladigan yo‘l — SSH tunnel.** Hech narsa internetga ochilmaydi:

```bash
ssh -N -L 7391:127.0.0.1:7391 user@server-ip
```

So‘ng kompyuteringizda `http://127.0.0.1:7391`.

**Internetga ochish kerak bo‘lsa** (masalan telefondan doim kirish uchun) — faqat
HTTPS ortida. Nginx namunasi:

```nginx
server {
  listen 443 ssl;
  server_name hamroh.sizning-domen.uz;

  ssl_certificate     /etc/letsencrypt/live/hamroh.sizning-domen.uz/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/hamroh.sizning-domen.uz/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:7391;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

`.env` ga:

```
HAMROH_WEB_BASE=https://hamroh.sizning-domen.uz
```

`HAMROH_WEB_HOST` ni `0.0.0.0` ga o‘zgartirish **shart emas** — nginx localhost'ga
ulanadi. Agar baribir o‘zgartirsangiz, panel jurnalda ogohlantirish yozadi.

---

## OAuth: Google qaytadigan manzil

Bu — «token olish uchun qanday URL kerak?» degan savolning javobi.

Google OAuth ikki narsani talab qiladi: **mijoz** (client ID/secret) va **qaytish
manzili** (redirect URI). Qaytish manzilini panel o‘zi yasaydi va **Sozlamalar**
sahifasida ko‘rsatadi:

```
http://127.0.0.1:7391/oauth/google/callback          (lokal)
https://hamroh.sizning-domen.uz/oauth/google/callback (domen bilan)
```

Aynan shu satrni Google Cloud → **Credentials → OAuth client → Authorized redirect URIs**
ro‘yxatiga qo‘shasiz. Mijoz turi: **Web application**.

Keyin:

1. `.env` ga `GOOGLE_CLIENT_ID` va `GOOGLE_CLIENT_SECRET`
2. Panel → **Sozlamalar** → «Google Calendar'ni ulash»
3. Google ruxsat so‘raydi → panelga qaytaradi
4. Panel refresh tokenni **o‘zi `.env` ga yozadi** va darhol yoqadi — qayta ishga
   tushirish ham shart emas

Ya'ni tokenni qo‘lda ko‘chirish kerak emas.

### Domeningiz bo‘lmasa

Ikki yo‘l bor:

- **SSH tunnel bilan:** tunnel ochib, panelni `http://127.0.0.1:7391` da oching va
  o‘sha yerdan ulang. Google `127.0.0.1` manzilini qabul qiladi (loopback — ishonchli
  hisoblanadi), HTTPS talab qilmaydi.
- **Terminaldan:** `hamroh kalendar auth` — brauzer ochiladigan kompyuterda yurgizasiz,
  chiqqan refresh tokenni server `.env` iga ko‘chirasiz ([GCALENDAR.md](GCALENDAR.md)).

Google **`http://` ni faqat `127.0.0.1`/`localhost` uchun** qabul qiladi. Boshqa har
qanday manzil uchun HTTPS shart — shuning uchun domen bo‘lsa sertifikat ham kerak.

---

## Serverda avtomatik ishlashi

VPS o‘rnatgichi `hamroh-web` xizmatini yaratadi:

```bash
systemctl status hamroh-web
journalctl -u hamroh-web -f
```

Panel `hamroh` foydalanuvchisi ostida, cheklangan huquq bilan ishlaydi
(faqat `data/` va `out/` ga yozadi).

## API

Panel bilan bir portda oddiy JSON API ham bor — kelajakdagi mobil ilova yoki
integratsiyalar uchun:

| Yo‘l | Nima |
| --- | --- |
| `GET /health` | Holat |
| `GET /modules` | Modullar va buyruqlar ro‘yxati |
| `GET /brief/morning` \| `/brief/evening` | Brifing (matn + bo‘limlar) |
| `POST /run` | `{module, command, args[]}` — istalgan buyruqni bajarish |
| `POST /telegram` | Telegram webhook ([TELEGRAM.md](TELEGRAM.md)) |

⚠️ API yo‘llari hozircha **kalit talab qilmaydi** — shuning uchun panelni internetga
ochsangiz, nginx darajasida `/run`, `/modules`, `/brief` yo‘llarini yopib qo‘ying yoki
faqat SSH tunnel orqali ishlating.

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| Panel ochilmayapti, 404 | `HAMROH_WEB_TOKEN` bo‘sh — panel o‘chirilgan |
| «So‘rov tasdiqlanmadi (CSRF)» | Sahifa eski; yangilang va qayta urinib ko‘ring |
| Google «redirect_uri_mismatch» | Sozlamalar sahifasidagi manzil Google Cloud dagi bilan **aynan** bir xil bo‘lishi kerak (port va `/oauth/google/callback` qismi ham) |
| Telefondan ochilmayapti | Panel localhost'da; SSH tunnel yoki nginx kerak |
