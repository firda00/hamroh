import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { table, truncate } from '../util/fmt.ts';
import { loadSkills, ensureDirs, draftPath, activePath, DRAFTS_DIR, ACTIVE_DIR } from '../skills/registry.ts';
import { runInSandbox } from '../skills/sandbox.ts';
import { runToolLoop } from '../llm/tools.ts';
import { SYSTEM } from '../llm/prompts.ts';
import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * (4) Navyklar tizimi — modul.
 *
 * Xavfsizlik tartibi qat'iy:
 *   model yozadi -> skills/drafts/ (yuklanmaydi, modelga ko'rsatilmaydi)
 *        -> sandboxda tekshiriladi
 *        -> SIZ ko'rib chiqasiz
 *        -> faqat shundan keyin skills/active/ ga o'tadi
 *
 * Avtomatik faollashtirish ataylab yo'q: modelga kiradigan matn (yangilik,
 * Telegram xabari, ovoz) ishonchli emas, va "testlar o'tdi" buni ushlamaydi.
 */

const TEMPLATE = (name: string, description: string) => `import type { Ctx } from '../../src/core/types.ts';
import type { SkillMetadata, SkillResult } from '../../src/skills/types.ts';

export const SKILL: SkillMetadata = {
  type: 'function',
  function: {
    name: '${name}',
    description: '${description.replace(/'/g, "\\'")}',
    parameters: {
      type: 'object',
      properties: {
        // masalan: amount: { type: 'number', description: 'Summa' },
      },
      required: [],
    },
  },
};

export function execute(args: Record<string, unknown>, ctx: Ctx): SkillResult {
  return { status: 'ok', echo: args };
}
`;

const listDrafts = (): string[] =>
  existsSync(DRAFTS_DIR) ? readdirSync(DRAFTS_DIR).filter((f) => f.endsWith('.ts')) : [];

export const skillsModule: Module = {
  id: 'navlar',
  title: 'Navyklar',
  about: 'Modul-plaginlar: ro‘yxat, tekshirish, qoralamalarni tasdiqlash.',

  commands: [
    {
      name: 'list',
      usage: 'navlar list',
      about: 'Faol navyklar va qoralamalar.',
      run: async (ctx) => {
        const reg = await loadSkills();
        const drafts = listDrafts();

        const rows = reg.skills.map((s) => [
          s.name,
          s.origin === 'builtin' ? 'ichki' : 'qo‘shilgan',
          Object.keys(s.metadata.function.parameters.properties).join(', ') || '—',
          truncate(s.metadata.function.description, 44),
        ]);

        const lines = [rows.length ? table(['Nom', 'Manba', 'Argumentlar', 'Tavsif'], rows) : 'Navyk yo‘q.'];

        if (reg.errors.length) {
          lines.push('', '⚠️ Yuklanmagan fayllar:');
          for (const e of reg.errors) lines.push(`   ${basename(e.file)}: ${e.reason}`);
        }
        if (drafts.length) {
          lines.push('', `📝 Qoralamalar (${drafts.length}) — faol emas:`);
          for (const d of drafts) lines.push(`   ${d}   →  navlar korish ${d.replace(/\.ts$/, '')}`);
        }
        return { text: lines.join('\n'), data: { skills: reg.skills.map((s) => s.name), drafts } };
      },
    },
    {
      name: 'yangi',
      usage: 'navlar yangi <nom> "<tavsif>"',
      about: 'Qoralama shabloni yaratish (qo‘lda yozish uchun).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const name = a.at(0);
        const description = a.rest(1) || 'Tavsif yozilmagan';
        if (!/^[a-z][a-z0-9_]{2,47}$/.test(name)) {
          return { text: 'Nom: kichik lotin harflari, raqam va _ (masalan: hisob_chiqar)' };
        }
        ensureDirs();
        const file = draftPath(name);
        if (existsSync(file)) return { text: `${file} allaqachon bor.` };
        writeFileSync(file, TEMPLATE(name, description), 'utf8');
        return { text: `📝 ${file}\n   Tahrirlang, so‘ng:  navlar tekshir ${name}`, files: [file] };
      },
    },
    {
      name: 'yarat',
      usage: 'navlar yarat "<nima qilsin>"',
      about: 'Model qoralama yozadi (faollashtirilmaydi — avval siz ko‘rasiz).',
      run: async (ctx, argv) => {
        const wish = parseArgs(argv).rest(0).trim();
        if (!wish) return { text: 'Masalan: navlar yarat "mijozga chegirma summasini hisoblasin"' };
        if (!ctx.llm.smart) {
          return {
            text: [
              'Buning uchun LLM kerak (HAMROH_LLM=local yoki anthropic).',
              'LLM‘siz shablon yaratib, qo‘lda yozish mumkin:',
              '  navlar yangi hisob_chegirma "Chegirma summasini hisoblaydi"',
            ].join('\n'),
          };
        }

        const res = await ctx.llm.run({
          kind: 'chat',
          system:
            'Sen TypeScript da Hamroh navygini yozasan. Faqat kod qaytar, izohsiz, markdown belgilarisiz.\n' +
            'Namuna tuzilma:\n' +
            TEMPLATE('nom_shu_yerda', 'Tavsif shu yerda'),
          prompt: `Quyidagi vazifa uchun navyk yoz:\n${wish}\n\nFaqat .ts fayl mazmunini qaytar.`,
        });

        const code = res.text.replace(/^```[a-z]*\n?/gm, '').replace(/```$/gm, '').trim();
        const name = code.match(/name:\s*'([a-z][a-z0-9_]{2,47})'/)?.[1];
        if (!name) return { text: `Model to‘g‘ri navyk yozmadi. Javob:\n\n${truncate(code, 400)}` };

        ensureDirs();
        const file = draftPath(name);
        writeFileSync(file, `${code}\n`, 'utf8');

        const check = await runInSandbox(file);
        return {
          text: [
            `📝 Qoralama yozildi: ${file}`,
            check.ok ? '   ✓ sandbox tekshiruvi o‘tdi' : `   ✗ tekshiruv: ${check.error}`,
            '',
            'Bu navyk HALI ISHLAMAYDI. Kodni o‘qing, so‘ng:',
            `   navlar korish ${name}      — kodni ko‘rish`,
            `   navlar tekshir ${name}     — sandboxda sinash`,
            `   navlar yoq ${name}         — faollashtirish`,
          ].join('\n'),
          files: [file],
        };
      },
    },
    {
      name: 'korish',
      usage: 'navlar korish <nom>',
      about: 'Qoralama kodini ko‘rish.',
      run: (_ctx, argv) => {
        const name = parseArgs(argv).at(0);
        const file = draftPath(name);
        if (!existsSync(file)) return { text: `Qoralama topilmadi: ${file}` };
        return { text: `${file}\n${'─'.repeat(60)}\n${readFileSync(file, 'utf8')}` };
      },
    },
    {
      name: 'tekshir',
      usage: 'navlar tekshir <nom> [--args=\'{"a":1}\']',
      about: 'Qoralamani izolyatsiyada sinash.',
      run: async (_ctx, argv) => {
        const a = parseArgs(argv);
        const name = a.at(0);
        const file = existsSync(draftPath(name)) ? draftPath(name) : activePath(name);
        if (!existsSync(file)) return { text: `Topilmadi: ${name}` };

        let args: Record<string, unknown> | undefined;
        if (a.has('args')) {
          try {
            args = JSON.parse(a.str('args')) as Record<string, unknown>;
          } catch {
            return { text: '--args JSON emas' };
          }
        }

        const r = await runInSandbox(file, args);
        const lines = [
          `${file} · ${r.ms} ms`,
          r.ok ? '✓ o‘tdi' : `✗ ${r.error}`,
          r.value !== undefined ? `natija: ${JSON.stringify(r.value)}` : '',
          r.stderr ? `stderr: ${truncate(r.stderr, 300)}` : '',
          '',
          'Eslatma: sandbox faylga va dochyor jarayonga ruxsat bermaydi, lekin',
          'tarmoqni bloklamaydi. Kodni baribir o‘zingiz o‘qing.',
        ].filter(Boolean);
        return { text: lines.join('\n'), data: r };
      },
    },
    {
      name: 'yoq',
      usage: 'navlar yoq <nom>',
      about: 'Qoralamani faollashtirish (ko‘rib chiqqaningizdan keyin).',
      run: async (_ctx, argv) => {
        const name = parseArgs(argv).at(0);
        const from = draftPath(name);
        if (!existsSync(from)) return { text: `Qoralama topilmadi: ${from}` };

        const check = await runInSandbox(from);
        if (!check.ok) {
          return { text: `Faollashtirilmadi — tekshiruv o‘tmadi:\n   ${check.error}\n\nKodni tuzating va qayta urinib ko‘ring.` };
        }

        ensureDirs();
        const to = activePath(name);
        if (existsSync(to)) return { text: `${to} allaqachon bor — avval eskisini o‘chiring.` };
        renameSync(from, to);

        const reg = await loadSkills();
        const loaded = reg.byName(name);
        return {
          text: loaded
            ? `✅ "${name}" faollashtirildi va modelga ko‘rinadi.\n   ${to}`
            : `Fayl ko‘chirildi, lekin yuklanmadi:\n   ${reg.errors.map((e) => e.reason).join('; ')}`,
        };
      },
    },
    {
      name: 'ochir',
      usage: 'navlar ochir <nom>',
      about: 'Navykni o‘chirish (qoralama yoki faol).',
      run: (_ctx, argv) => {
        const name = parseArgs(argv).at(0);
        for (const file of [draftPath(name), activePath(name)]) {
          if (existsSync(file)) {
            unlinkSync(file);
            return { text: `🗑 ${file} o‘chirildi.` };
          }
        }
        return { text: `Topilmadi: ${name}` };
      },
    },
    {
      name: 'ishlat',
      usage: 'navlar ishlat "<gap>"',
      about: 'Modelga navyklarni berib, gapni bajartirish (nativ tool calling).',
      run: async (ctx, argv) => {
        const prompt = parseArgs(argv).rest(0).trim();
        if (!prompt) return { text: 'Masalan: navlar ishlat "ertaga soat uchda Aziz bilan uchrashuv qo‘y"' };
        if (ctx.cfg.llm !== 'local') {
          return {
            text: [
              'Nativ tool calling hozircha OpenAI-mos endpoint uchun (HAMROH_LLM=local).',
              'Ollama, vLLM va LM Studio shunga kiradi.',
              'Qoidaviy rejimda o‘sha ishni "gap matn" buyrug‘i bajaradi.',
            ].join('\n'),
          };
        }

        const reg = await loadSkills();
        const out = await runToolLoop({
          url: ctx.cfg.llmUrl,
          model: ctx.cfg.llmModel,
          apiKey: ctx.cfg.llmKey,
          system: SYSTEM,
          prompt,
          tools: reg.toolsSchema(),
          onCall: (name, args) => reg.execute(name, args, ctx),
        });

        const lines = out.calls.map((c) => `  → ${c.name}(${JSON.stringify(c.args)})\n    ${JSON.stringify(c.result)}`);
        return {
          text: [out.text, ...(lines.length ? ['', 'Bajarilgan navyklar:', ...lines] : [])].join('\n'),
          data: out,
        };
      },
    },
  ],
};
