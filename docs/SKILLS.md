# Navyklar (Skills Engine)

Modul-plaginlar tizimi: har bir navyk — alohida fayl, ishga tushganda avtomatik
yuklanadi va **modelga tool sifatida ko‘rinadi** (nativ function calling).

```bash
hamroh navlar list
```

```
Nom               Manba       Argumentlar                                Tavsif
────────────────  ──────────  ─────────────────────────────────────────  ──────────────────────
create_event      ichki       title, when, duration_minutes, location    Kalendarga uchrashuv…
record_money      ichki       kind, amount, note, category, unnecessary  Kirim yoki chiqimni…
chegirma_hisobla  qo‘shilgan  amount, percent                            Chegirma summasini…
```

## Papkalar

```
src/skills/
  types.ts       navyk formati va tekshiruvlar
  registry.ts    skaner, ro‘yxat, dispetcher
  sandbox.ts     izolyatsiyalangan tekshiruv
  runner.ts      sandbox ichidagi tomon
  builtin/       loyiha bilan keladigan navyklar

skills/
  active/        faol navyklar — yuklanadi va modelga ko‘rinadi
  drafts/        qoralamalar — YUKLANMAYDI va modelga KO‘RSATILMAYDI
```

## Navyk formati

Har bir fayl ikkitasini eksport qiladi: `SKILL` (OpenAI tools sxemasi) va `execute`.

```ts
import type { Ctx } from '../../src/core/types.ts';
import type { SkillMetadata, SkillResult } from '../../src/skills/types.ts';

export const SKILL: SkillMetadata = {
  type: 'function',
  function: {
    name: 'chegirma_hisobla',
    description: 'Summadan chegirma foizini ayirib, yakuniy narxni hisoblaydi',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Boshlang‘ich summa' },
        percent: { type: 'number', description: 'Chegirma foizi' },
      },
      required: ['amount', 'percent'],
    },
  },
};

export function execute(args: Record<string, unknown>, ctx: Ctx): SkillResult {
  const amount = Number(args['amount']);
  const percent = Number(args['percent']);
  const discount = Math.round((amount * percent) / 100);
  return { status: 'ok', discount, final: amount - discount };
}
```

`ctx` orqali bazaga, provayderlarga (SMS, telefon, kalendar) va sozlamalarga
kirish bor — ya'ni navyk butun tizimdan foydalana oladi.

**Muhim:** `description` va argument tavsiflarini yaxshi yozing. Model qaysi navykni
qachon chaqirishni aynan shu matnga qarab hal qiladi.

## Hayot sikli

```
navlar yangi <nom> "<tavsif>"     shablon yaratadi -> skills/drafts/
   yoki
navlar yarat "<nima qilsin>"      model yozadi     -> skills/drafts/
        │
        ▼
navlar korish <nom>               kodni o‘qiysiz
navlar tekshir <nom> --args=...   sandboxda sinaysiz
        │
        ▼
navlar yoq <nom>                  faollashtirasiz  -> skills/active/
```

Veb-panelda ham xuddi shu: **Navyklar** sahifasida qoralama kodi, sandbox natijasi
va «Faollashtirish» tugmasi turadi.

## Nima uchun avtomatik faollashtirish yo‘q

Modelga kiradigan matn **ishonchli emas**: yangilik, Telegram xabari, ovozli
xabarning matni. Ularning ichida ko‘rsatma bo‘lishi mumkin, va «testlar o‘tdi»
buni ushlamaydi — chunki testni ham o‘sha model yozadi.

Shuning uchun ketma-ketlik qat'iy: **model yozadi → siz o‘qiysiz → siz yoqasiz.**
Ko‘rik — asosiy himoya, sandbox esa qo‘shimcha.

## Sandbox nima qiladi va nima qilmaydi

Node ning ruxsatlar tizimi (`--permission`) ishlatiladi:

| | Holat |
| --- | --- |
| Fayl o‘qish/yozish | 🔒 bloklangan (`ERR_ACCESS_DENIED`) |
| Dochyor jarayon, worker | 🔒 bloklangan |
| Maxfiy kalitlar (`*_TOKEN`, `*_PASSWORD`, …) | 🔒 env dan olib tashlanadi |
| Vaqt chegarasi | 🔒 10 soniya, so‘ng SIGKILL |
| **Tarmoq** | ⚠️ **bloklanmaydi** — Node da `--allow-net` yo‘q |

Ya'ni sandbox «kod ishlaydimi va nima qaytaradi» degan savolga javob beradi,
lekin yovuz koddan to‘liq himoya emas. **Kodni o‘zingiz o‘qing.**

Faollashgandan keyin navyk ilova huquqlari bilan ishlaydi — bu ataylab: navyk
foydali bo‘lishi uchun bazaga va provayderlarga kirishi kerak.

## Nativ tool calling

```bash
hamroh navlar ishlat "ertaga soat uchda Aziz bilan uchrashuv qo‘y"
```

Oqim:

1. Barcha navyklar `tools` massivi bo‘lib modelga uzatiladi
2. Model `tool_calls` qaytaradi → registr argumentlarni **sxemaga solishtiradi**
3. Bajariladi, natija `{role:'tool'}` xabar bo‘lib tarixga qo‘shiladi
4. Model yakuniy javobni yozadi (4 qadam chegarasi bilan — cheksiz halqadan himoya)

Hozircha OpenAI-mos endpoint uchun: **Ollama, vLLM, LM Studio** va OpenAI ning o‘zi
(`HAMROH_LLM=local`). Claude uchun tools formati boshqacha — qo‘shilishi mumkin.

Model buzuq JSON yozsa yoki mavjud bo‘lmagan navykni chaqirsa — halqa yiqilmaydi,
xato matn sifatida modelga qaytadi va u qayta urinadi.

## Model qoralama yozishi

```bash
hamroh navlar yarat "mijozga chegirma summasini hisoblasin"
```

Model kod yozadi → `skills/drafts/` ga tushadi → sandboxda tekshiriladi → **faol emas**.
Keyin siz `navlar korish` bilan o‘qiysiz va `navlar yoq` bilan yoqasiz.

LLM ulanmagan bo‘lsa shablon yaratib qo‘lda yozish mumkin: `navlar yangi <nom> "<tavsif>"`.

## Python yoki boshqa tilda navyk

Movjud provayder namunasi bo‘yicha: navyk ichida `child_process` bilan istalgan
dasturni chaqirasiz.

```ts
export async function execute(args: Record<string, unknown>): Promise<SkillResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('python3', ['/opt/hamroh/scripts/hisob.py', String(args['id'])]);
  return JSON.parse(stdout) as SkillResult;
}
```

Sandbox tekshiruvida bu bloklanadi (dochyor jarayon taqiqlangan) — bu kutilgan holat;
faollashgach normal ishlaydi.

## Xatoliklar

| Xato | Sabab |
| --- | --- |
| `SKILL eksport qilinmagan` | Faylda `export const SKILL` yo‘q |
| `execute() eksport qilinmagan` | Funksiya nomi boshqacha yozilgan |
| `name: kichik lotin harflari…` | Nom `send_sms` ko‘rinishida bo‘lishi kerak |
| `description: kamida 10 belgi` | Model tanlashi uchun tavsif yetarli emas |
| `"..." nomi allaqachon band` | Ikki faylda bir xil `name` |
| `Argumentlar noto‘g‘ri` | Model sxemaga mos kelmaydigan qiymat berdi — navyk bajarilmadi |
