# LLM ulash (bosqich 2)

## Nima uchun alohida qatlam

Modullar Claude bilan to‘g‘ridan-to‘g‘ri gaplashmaydi. Ular `LlmProvider` interfeysiga
to‘rtta vazifa yuboradi:

```ts
type LlmTask =
  | { kind: 'summarize'; text: string; maxSentences?: number; hint?: string }
  | { kind: 'classify'; text: string; labels: string[] }
  | { kind: 'advise'; topic: string; facts: string[]; question?: string }
  | { kind: 'chat'; system?: string; prompt: string };
```

Shu sabab LLM ni yoqish/o‘chirish modul kodini o‘zgartirmaydi — faqat provayder almashadi.

## Uch rejim

| `HAMROH_LLM` | Nima | Qachon |
| --- | --- | --- |
| `rules` | LLM'siz, deterministik | Standart. Bepul, internetsiz, natija har doim bir xil |
| `local` | OpenAI-mos server (Ollama, llama.cpp, vLLM, LM Studio) | Ma'lumot chiqmasligi kerak bo‘lsa — [LOCAL-LLM.md](LOCAL-LLM.md) |
| `anthropic` | Claude API | Eng yuqori sifat, kam pul (bu hajmda ~$4–18/oy) |

## Yoqish (Claude API)

```bash
npm install @anthropic-ai/sdk
```

`.env`:

```
HAMROH_LLM=anthropic
ANTHROPIC_API_KEY=sk-ant-...
HAMROH_LLM_MODEL=claude-opus-5
```

Tekshirish:

```bash
npm run hamroh -- doctor
```

`LLM:` qatorida `anthropic:claude-opus-5` ko‘rinishi kerak. Keyin:

```bash
npm run hamroh -- ask "Bu oy qayerda ko'p pul ketyapti?"
```

## Xavfsizlik to‘ri

`src/llm/index.ts` provayderni o‘raydi:

- `HAMROH_LLM=anthropic`, lekin kalit yo‘q → ogohlantiradi va qoidaviy rejimga tushadi
- Claude javob bermasa (tarmoq, limit, xato) → o‘sha so‘rov qoidaviy provayderga o‘tadi

Shuning uchun ertalabki brifing hech qachon LLM sababli to‘xtamaydi.

## Model tanlash

Standart — `claude-opus-5`. Arzonroq variant kerak bo‘lsa `.env` da almashtiring:

```
HAMROH_LLM_MODEL=claude-sonnet-5
```

`summarize` va `classify` vazifalari `effort: low` bilan, `advise` — `medium` bilan
yuboriladi, ya’ni oddiy ishlar uchun ortiqcha token sarflanmaydi.

## Nima o‘zgaradi

| Buyruq | LLM'siz | LLM bilan |
| --- | --- | --- |
| `yangilik top` | Ekstraktiv qisqartma (eng ma’noli gaplar) | Biznesga ta’siri bo‘yicha xulosa |
| `moliya advise` | Qoidalar: byudjet, keraksiz xarajat, jamg‘arma | Aniq, bajarish mumkin bo‘lgan qadamlar |
| `marketing advise` | CPL, CTR, o‘zgarish ro‘yxati | Qaysi kanalga qancha qo‘yish kerakligi |
| `buxgalter analyze` | Raqamlar ro‘yxati | Xatolar va ularning oqibati |
| `yurist ask` | Bazadagi yozuvlar | Yozuvlarga tayangan javob |
| `hujjat content` | 7 kunlik format skeleti | To‘liq ssenariy |
| `hujjat slides` | Sarlavhalar | Slayd matnlari |
| `soglik advise` | O‘rtacha ko‘rsatkichlar | Rejim tavsiyalari |
| `hamroh ask` | Ishlamaydi | Erkin savol-javob |

## Yangi vazifa turi qo‘shish

1. `src/llm/provider.ts` dagi `LlmTask` ga qo‘shing.
2. `src/llm/rules.ts` da deterministik bajarilishini yozing (LLM'siz ham ishlashi shart).
3. `src/llm/anthropic.ts` dagi `prompt()` ga promptini qo‘shing.

Ikkala provayder ham bir xil `LlmResult` qaytaradi, shuning uchun chaqiruvchi modul
qaysi rejimda ishlayotganini bilishi shart emas (bilish kerak bo‘lsa — `ctx.llm.smart`).

## Xarajat haqida

Bosqich 1 da hech qanday token sarflanmaydi. Bosqich 2 da ham har bir buyruq alohida
so‘rov yuboradi — fon rejimi (`daemon`) LLM ga faqat `yangilik top` orqali murojaat qiladi.
