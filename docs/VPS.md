# VPS ga o‘rnatish

Bitta buyruq bilan: Node, kod, sozlama, systemd xizmatlari — hammasi.

```bash
curl -fsSL https://raw.githubusercontent.com/firda00/hamroh/main/scripts/install-vps.sh | sudo bash
```

Ubuntu 22.04 va 24.04 da sinalgan (haqiqiy konteynerda to‘liq o‘tkazilgan).

## Nima qiladi

1. `git`, `curl`, `ffmpeg`, `sqlite3` — o‘rnatadi
2. **Node 24** — mavjud versiya 22 dan past bo‘lsa yangilaydi, so‘ng `node:sqlite` ishlashini tekshiradi
3. `hamroh` tizim foydalanuvchisini yaratadi (login qila olmaydi)
4. Kodni `/opt/hamroh` ga klonlaydi
5. `.env.example` dan `.env` yasaydi — **huquqi 600**, faqat `hamroh` o‘qiy oladi
6. Ikkita systemd xizmati yozadi:
   - `hamroh-bot` — Telegram bot
   - `hamroh-daemon` — rejalashtiruvchi (cron vazifalari, eslatmalar)
7. Token bo‘lsa — ikkalasini ishga tushiradi; bo‘lmasa faqat daemon

Mavjud `.env` va ma'lumotlar bazasiga **tegilmaydi** — skriptni qayta ishga tushirish xavfsiz.

## Keyingi qadam

```bash
sudo nano /opt/hamroh/.env
```

Kamida shu ikkitasi:

```
TELEGRAM_BOT_TOKEN=123456789:AAH...
TELEGRAM_CHAT_ID=123456789
```

```bash
sudo systemctl enable --now hamroh-bot
```

## Boshqarish

```bash
systemctl status hamroh-bot hamroh-daemon
```

```bash
journalctl -u hamroh-bot -f
```

```bash
sudo -u hamroh node /opt/hamroh/src/cli.ts doctor
```

Yangilash:

```bash
sudo bash /opt/hamroh/scripts/install-vps.sh --update
```

Kodni tortadi va ishlab turgan xizmatlarni qayta ishga tushiradi. Boshqa hech narsaga tegmaydi.

## Whisper bilan birga

```bash
sudo bash scripts/install-vps.sh --with-whisper
```

Docker o‘rnatadi va `faster-whisper-server` ni ko‘taradi. GPU bo‘lsa CUDA varianti,
bo‘lmasa CPU. Port faqat `127.0.0.1` da ochiladi — tashqaridan kirib bo‘lmaydi.

Keyin `.env` ga `HAMROH_STT=local` ([VOICE.md](VOICE.md)).

## Qanday server kerak

| Sozlama | CPU | RAM | Disk | Narx (taxminan) |
| --- | --- | --- | --- | --- |
| `rules` (LLM'siz) | 1 vCPU | 1 GB | 10 GB | $4–6/oy |
| + Claude API | 1 vCPU | 1 GB | 10 GB | $4–6/oy + API |
| + Whisper (CPU) | 2 vCPU | 4 GB | 20 GB | $10–15/oy |
| + lokal LLM va Whisper | GPU 24 GB | 32 GB | 100 GB | ancha qimmat ([LOCAL-LLM.md](LOCAL-LLM.md)) |

Hamroh runtime da **bitta ham npm paketiga bog‘liq emas** — shuning uchun eng oddiy
serverda ham bemalol ishlaydi. Baza — bitta SQLite fayl (`data/hamroh.db`).

## Xavfsizlik

Skript yozgan systemd birliklari cheklangan huquq bilan ishlaydi:

- `User=hamroh` — root emas
- `ProtectSystem=strict` — butun fayl tizimi faqat o‘qish uchun
- `ReadWritePaths=/opt/hamroh/data /opt/hamroh/out` — faqat shu ikki papkaga yozadi
- `ProtectHome`, `PrivateTmp`, `NoNewPrivileges` — yoqilgan

Ochiq port kerak emas: Telegram bot **long polling** bilan ishlaydi, ya'ni o‘zi ulanadi.
Webhook faqat domen va HTTPS bo‘lsa kerak ([TELEGRAM.md](TELEGRAM.md)).

## Zaxira nusxa

Butun ma'lumot bitta faylda:

```bash
sudo -u hamroh sqlite3 /opt/hamroh/data/hamroh.db ".backup /opt/hamroh/data/zaxira.db"
```

Buni har kuni boshqa joyga ko‘chirsangiz — yetarli.

## O‘chirish

```bash
sudo systemctl disable --now hamroh-bot hamroh-daemon
sudo rm /etc/systemd/system/hamroh-{bot,daemon}.service
sudo systemctl daemon-reload
```

Ma'lumotni ham o‘chirish: `sudo rm -rf /opt/hamroh` va `sudo userdel hamroh`.
