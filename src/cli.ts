#!/usr/bin/env node
import { createCtx } from './core/context.ts';
import { modules, byId } from './modules/index.ts';
import { allJobs, tick } from './core/scheduler.ts';
import { buildBrief } from './core/brief.ts';
import { flush } from './modules/notify.ts';
import { table } from './util/fmt.ts';
import { stamp } from './util/date.ts';
import { closeHttp } from './util/http.ts';
import { existsSync } from 'node:fs';

/** Hamroh — buyruq qatori. */

function help(moduleId?: string): string {
  if (moduleId) {
    const m = byId(moduleId);
    if (!m) return `"${moduleId}" moduli yo‘q.\n\n${help()}`;
    return [
      `${m.title} — ${m.about}`,
      '',
      ...m.commands.map((c) => `  hamroh ${c.usage}\n      ${c.about}`),
      ...(m.jobs?.length ? ['', 'Avtomatik vazifalar:', ...m.jobs.map((j) => `  ${j.cron.padEnd(14)} ${j.name}`)] : []),
    ].join('\n');
  }

  return [
    'Hamroh — shaxsiy yordamchi (bosqich 1: LLM ulanmagan)',
    '',
    'Tez buyruqlar:',
    '  hamroh tong                 ertalabki brifing (kurs, ob-havo, yangilik, reja)',
    '  hamroh kun [--html]         kun yakuni: hisobot, o‘sish darajasi, kamchiliklar',
    '  hamroh eslat                navbatdagi eslatmalarni yetkazish',
    '  hamroh ask "<savol>"        erkin savol (LLM ulangach to‘liq ishlaydi)',
    '  hamroh gap matn "<gap>"     odam tilida buyruq berish',
    '  hamroh gap ovoz <fayl>      audio fayldagi buyruqni bajarish',
    '  hamroh doctor               tizim holatini tekshirish',
    '  hamroh jobs                 avtomatik vazifalar jadvali',
    '  hamroh tick                 rejalashtiruvchini bir marta yurgizish',
    '',
    'Modullar:',
    ...modules.map((m) => `  ${m.id.padEnd(11)} ${m.about}`),
    '',
    'Batafsil:  hamroh help <modul>      Masalan:  hamroh help moliya',
  ].join('\n');
}

async function main(argv: string[]): Promise<number> {
  const [first = '', second = '', ...rest] = argv;

  if (!first || first === 'help' || first === '--help' || first === '-h') {
    console.log(help(second || undefined));
    return 0;
  }

  const ctx = await createCtx();
  // Modul nomi tez buyruqdan ustun turadi — kelajakda nom to'qnashuvi bo'lmasin.
  const isModule = byId(first) !== undefined;
  try {
    // --- Tez buyruqlar ---
    if (!isModule && (first === 'tong' || first === 'kun')) {
      const kind = first === 'tong' ? 'morning' : 'evening';
      if (first === 'kun') {
        const m = byId('hisobot');
        const cmd = m?.commands.find((c) => c.name === 'kun');
        const out = await cmd?.run(ctx, [second, ...rest].filter(Boolean));
        console.log(out?.text ?? '');
        return 0;
      }
      const { text } = await buildBrief(ctx, modules, kind);
      console.log(text);
      return 0;
    }

    if (!isModule && first === 'eslat') {
      const r = await flush(ctx);
      console.log(r.lines.length ? [...r.lines, '', `Yuborildi: ${r.sent}`].join('\n') : 'Yuboriladigan eslatma yo‘q.');
      return 0;
    }

    if (!isModule && first === 'ask') {
      const res = await ctx.llm.run({ kind: 'chat', prompt: [second, ...rest].join(' ') });
      console.log(res.text);
      return 0;
    }

    if (!isModule && first === 'jobs') {
      console.log(
        table(
          ['Modul', 'Cron', 'Vazifa'],
          allJobs(modules).map(({ module, job }) => [module, job.cron, job.name]),
        ),
      );
      return 0;
    }

    if (!isModule && first === 'tick') {
      const r = await tick(ctx, modules);
      console.log(r.ran.length ? r.ran.join('\n') : `Bu daqiqada vazifa yo‘q (${stamp(ctx.now, ctx.cfg.tz)}).`);
      return 0;
    }

    if (!isModule && first === 'doctor') {
      let llmLine = `${ctx.llm.id}${ctx.llm.smart ? '' : ' — qoidaviy rejim (LLM ulanmagan)'}`;
      if (ctx.cfg.llm === 'local') {
        const { localStatus } = await import('./llm/local.ts');
        const st = await localStatus(ctx.cfg.llmUrl, ctx.cfg.llmKey);
        llmLine += st.ok
          ? `
             server ✓ ${ctx.cfg.llmUrl} · modellar: ${st.models.join(', ') || '(ro‘yxat bo‘sh)'}`
          : `
             server ✗ ${ctx.cfg.llmUrl} — ${st.error}`;
      }
      let sttLine = ctx.stt.enabled ? ctx.stt.id : 'o‘chirilgan (HAMROH_STT=off)';
      if (ctx.stt.enabled) {
        const { sttStatus } = await import('./stt/local.ts');
        const st = await sttStatus(ctx.cfg.sttUrl, ctx.cfg.sttKey);
        sttLine += st.ok ? `
             server ✓ ${ctx.cfg.sttUrl}` : `
             server ✗ ${ctx.cfg.sttUrl} — ${st.error}`;
      }
      const lines = [
        `Vaqt:        ${stamp(ctx.now, ctx.cfg.tz)} (${ctx.cfg.tz})`,
        `Baza:        ${ctx.cfg.dbPath} ${existsSync(ctx.cfg.dbPath) ? '✓' : '(yangi yaratiladi)'}`,
        `Shahar:      ${ctx.cfg.city}`,
        `Valyuta:     ${ctx.cfg.currency}`,
        `Internet:    ${ctx.cfg.offline ? 'o‘chirilgan (HAMROH_OFFLINE=1)' : 'ruxsat berilgan'}`,
        `LLM:         ${llmLine}`,
        `Ovoz (STT):  ${sttLine}`,
        `Gapirish:    ${ctx.tts.enabled ? ctx.tts.id : 'o‘chirilgan (HAMROH_TTS=off)'}`,
        `Ovozli buyruq: ${ctx.cfg.voiceCommands ? 'yoqilgan' : 'o‘chirilgan'}`,
        `SMS:         ${ctx.sms.enabled ? ctx.sms.id : 'ulanmagan (HAMROH_SMS=off)'}`,
        `Kalendar:    ${ctx.gcal.enabled ? ctx.gcal.id : 'Google ulanmagan (HAMROH_GCAL=off)'}`,
        `Qo‘ng‘iroq:  ${ctx.tel.enabled ? ctx.tel.id : 'o‘chirilgan (HAMROH_TEL=off)'}`,
        `Telegram:    ${ctx.cfg.telegram.token ? 'token bor' : 'ulanmagan'}`,
        `Modullar:    ${modules.length} ta`,
        `Vazifalar:   ${allJobs(modules).length} ta cron`,
        '',
        'Jadvallardagi yozuvlar:',
        ...['tasks', 'events', 'ledger', 'leads', 'recurring', 'news_items', 'marketing_metrics', 'products', 'sales', 'health_metrics'].map(
          (t) => `  ${t.padEnd(20)} ${ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)?.n ?? 0}`,
        ),
      ];
      console.log(lines.join('\n'));
      return 0;
    }

    // --- Modul buyruqlari ---
    const mod = byId(first);
    if (!mod) {
      console.error(`Noma’lum buyruq: "${first}"\n`);
      console.log(help());
      return 1;
    }
    if (!second) {
      console.log(help(first));
      return 0;
    }
    const cmd = mod.commands.find((c) => c.name === second);
    if (!cmd) {
      console.error(`"${first}" modulida "${second}" buyrug‘i yo‘q.\n`);
      console.log(help(first));
      return 1;
    }

    const out = await cmd.run(ctx, rest);
    console.log(out.text);
    if (out.files?.length) console.log(`\nFayllar:\n${out.files.map((f) => `  ${f}`).join('\n')}`);
    return 0;
  } finally {
    ctx.db.close();
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    console.error(`Xato: ${(e as Error).message}`);
    if (process.env['HAMROH_LOG'] === 'debug') console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    // fetch (undici) ochiq soketlarni ushlab turadi — ularni yopamiz,
    // aks holda buyruq chiqmay osilib qoladi.
    void closeHttp();
  });
