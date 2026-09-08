# Arxitektura

## Umumiy ko‘rinish

```
                       ┌──────────────┐
   CLI  (src/cli.ts)   │              │
   Daemon (daemon.ts) ─┤   Ctx        │  { cfg, db, llm, now }
   API  (server.ts)    │              │
                       └──────┬───────┘
                              │
                    ┌─────────┴──────────┐
                    │   Modullar (17)    │  har biri: commands + jobs + morning/evening
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────┴─────┐        ┌──────┴──────┐       ┌──────┴──────┐
   │ SQLite   │        │ LlmProvider │       │ Konnektorlar│
   │ (lokal)  │        │ rules │ claude      │ CBU, meteo, │
   └──────────┘        └─────────────┘       │ RSS, TG API │
                                             └─────────────┘
```

## Asosiy tushunchalar

### `Ctx`

Har bir buyruq va job bitta kontekst oladi: sozlama, baza, LLM provayderi va "hozir" vaqti.
`now` alohida maydon bo‘lgani uchun testlarda vaqtni qotirib qo‘yish oson.

### `Module`

```ts
type Module = {
  id: string;                    // CLI dagi nomi: hamroh <id> <buyruq>
  title: string;
  about: string;
  commands: Command[];           // qo'lda chaqiriladigan buyruqlar
  jobs?: Job[];                  // cron bo'yicha avtomatik ishlar
  morning?: (ctx) => BriefSection | null;   // ertalabki brifingga hissa
  evening?: (ctx) => BriefSection | null;   // kun yakuniga hissa
};
```

Modul boshqa modul haqida bilishi shart emas. Brifing `core/brief.ts` da yig‘iladi:
har bir modul o‘z bo‘limini beradi, `order` bo‘yicha tartiblanadi. Bitta modul xato bersa,
qolganlari baribir chiqadi (xato alohida bo‘lim sifatida ko‘rsatiladi).

### `LlmProvider`

```ts
type LlmTask =
  | { kind: 'summarize'; text: string; maxSentences?: number }
  | { kind: 'classify'; text: string; labels: string[] }
  | { kind: 'advise'; topic: string; facts: string[]; question?: string }
  | { kind: 'chat'; system?: string; prompt: string };
```

Modullar "Claude" bilan emas, shu vazifalar bilan gaplashadi. Bosqich 1 da `rules`
provayderi ularni deterministik bajaradi (ekstraktiv qisqartma, kalit so‘z bo‘yicha toifalash,
faktlar ro‘yxati). Bosqich 2 da `anthropic` provayderi shu vazifalarni promptga aylantiradi.
Shuning uchun LLM ulash modul kodini o‘zgartirmaydi.

### Eslatmalar navbati

Modullar to‘g‘ridan-to‘g‘ri xabar yubormaydi — `notifications` jadvaliga yozadi
(`enqueue`). Yetkazish bitta joyda (`flush`): Telegram tokeni bo‘lsa Telegramga,
bo‘lmasa konsolga. `dedupe_key` tufayli bitta eslatma ikki marta bormaydi.

### Rejalashtiruvchi

`core/scheduler.ts` — tashqi cron kutubxonasisiz. Har daqiqada `tick()` chaqiriladi;
mos keladigan joblar `job_runs(job, slot)` jadvaliga UNIQUE yozuv qo‘yib "band qilinadi",
shuning uchun daemon qayta ishga tushsa ham bitta slot ikki marta bajarilmaydi.

## Papkalar

```
src/
  cli.ts          buyruq qatori
  server.ts       lokal HTTP API (127.0.0.1)
  daemon.ts       fon rejimi (cron + eslatmalar)
  core/
    config.ts     .env → Config
    db.ts         node:sqlite ustidan yupqa qatlam
    schema.ts     barcha jadvallar
    types.ts      Ctx, Module, Command, Job, BriefSection
    brief.ts      ertalabki/kechqurungi brifing yig'uvchisi
    scheduler.ts  cron tahlili va idempotent yurituvchi
    args.ts       CLI argumentlari, summa tahlili ("5mln")
    context.ts    createCtx()
  llm/
    provider.ts   interfeys
    rules.ts      bosqich 1 — LLM'siz
    anthropic.ts  bosqich 2 — rasmiy SDK orqali
    index.ts      tanlov + xatoda qoidaviy rejimga qaytish
  modules/        17 ta modul
  report/html.ts  HTML hisobot + ichki SVG diagramma
  util/
    date.ts       vaqt zonasi, "ertaga 10:00" tahlili
    fmt.ts        pul, foiz, jadval, matnli diagramma
    http.ts       fetch + RSS/XML tahlili
    zip.ts        minimal ZIP yozuvchi
    office.ts     .xlsx / .docx / .csv
```

## Yangi modul qo‘shish

1. `src/modules/<nom>.ts` yarating va `Module` obyektini eksport qiling.
2. Kerak bo‘lsa `src/core/schema.ts` ga jadval qo‘shing (`IF NOT EXISTS` bilan).
3. `src/modules/index.ts` dagi ro‘yxatga qo‘shing.

Boshqa hech qayerga tegish shart emas: CLI, yordam matni, HTTP API, brifing va cron
ro‘yxati modullardan avtomatik yig‘iladi.

## Nima uchun nol bog‘liqlik

- `node:sqlite` — Node 22.5+ ichida keladi, native modul kompilyatsiyasi kerak emas.
- TypeScript — Node 22.6+ tiplarni o‘zi olib tashlaydi, build qadami yo‘q.
- ZIP/OOXML — `node:zlib` ustida ~100 satr kod; `.xlsx` va `.docx` shundan chiqadi.

`typescript` faqat `npm run typecheck` uchun, `@anthropic-ai/sdk` faqat bosqich 2 uchun kerak.
