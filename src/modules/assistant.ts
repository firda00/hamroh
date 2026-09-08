import type { Ctx, Module, CommandResult } from '../core/types.ts';
import type { Intent } from '../intent/types.ts';
import { parseArgs } from '../core/args.ts';
import { route, execute, describe } from '../intent/index.ts';
import { dateKey } from '../util/date.ts';
import { truncate } from '../util/fmt.ts';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Suhbat moduli: odam gapi -> buyruq -> bajarish -> javob (matn va ovoz).
 *
 * Ovozli buyruq shu yerdan o'tadi:
 *   audio -> ovoz moduli (Whisper) -> matn -> shu modul -> natija
 */

/** Jadval va bezaklarni olib tashlab, ovozga yaroqli qisqa matn qoldiradi. */
export function spokenText(raw: string, maxChars = 600): string {
  const cleaned = raw
    .split('\n')
    .filter((l) => !/^[\s─═•·]*$/.test(l) && !/^[─═]{3,}/.test(l))
    .map((l) =>
      l
        .replace(/[│┌┐└┘├┤┬┴┼]/g, ' ')
        .replace(/\s{2,}/g, ' — ')
        // Bo'sh kataklar ketma-ket tirelarga aylanadi — ovozda ular ortiqcha
        .replace(/(?:—\s*)+$/, '')
        .replace(/(?:—\s*){2,}/g, '— ')
        .trim(),
    )
    .filter(Boolean)
    .join('. ');
  return truncate(cleaned.replace(/\.{2,}/g, '.').replace(/\s+/g, ' '), maxChars);
}

export type TalkResult = {
  text: string;
  intent: Intent | null;
  result: CommandResult | null;
  audioFile?: string;
};

/** To'liq zanjir: matn -> buyruq -> bajarish -> javob. */
export async function talk(
  ctx: Ctx,
  input: string,
  opts: { confirm?: boolean; speak?: boolean; dryRun?: boolean } = {},
): Promise<TalkResult> {
  const { modules } = await import('./index.ts');
  const intent = await route(ctx, input, modules);

  if (!intent) {
    const hint = ctx.llm.smart
      ? 'Buyruqni tushunmadim. Boshqacha aytib ko‘ring.'
      : [
          'Buyruqni tushunmadim.',
          'Qoidaviy rejim cheklangan — LLM ulansa ancha ko‘p gapni tushunadi.',
          'Hozir tushunadiganlari: uchrashuv qo‘yish, eslatma, kirim-chiqim, lid,',
          'kurs, ob-havo, yangilik, reja, hisobot, to‘lovlar, javobsiz qo‘ng‘iroqlar.',
        ].join('\n');
    return { text: hint, intent: null, result: null };
  }

  if (opts.dryRun) {
    return { text: `Tushundim: ${describe(intent)}`, intent, result: null };
  }

  if (intent.needsConfirm && !opts.confirm) {
    return {
      text: [
        `⚠️ Bu buyruq tashqariga ta’sir qiladi, avtomatik bajarmadim:`,
        describe(intent),
        '',
        'Tasdiqlash uchun --tasdiq qo‘shing.',
      ].join('\n'),
      intent,
      result: null,
    };
  }

  const result = await execute(ctx, intent, modules);
  const answer = `${intent.explain}\n\n${result.text}`;

  let audioFile: string | undefined;
  if (opts.speak && ctx.tts.enabled) {
    const speech = await ctx.tts.speak(spokenText(result.text));
    mkdirSync(ctx.cfg.outDir, { recursive: true });
    audioFile = join(ctx.cfg.outDir, `javob-${Date.now()}.${speech.ext}`);
    writeFileSync(audioFile, speech.bytes);
  }

  return { text: answer, intent, result, audioFile };
}

export const assistantModule: Module = {
  id: 'gap',
  title: 'Suhbat va ovozli buyruqlar',
  about: 'Odam tilida aytilgan buyruqni tushunib bajaradi, javobni matn yoki ovoz qilib beradi.',

  commands: [
    {
      name: 'matn',
      usage: 'gap matn "<gap>" [--ovoz] [--tasdiq]',
      about: 'Matnli buyruqni tushunib bajarish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const input = a.rest(0).trim();
        if (!input) return { text: 'Masalan: gap matn "ertaga soat uchda Aziz aka bilan uchrashuv qo‘y"' };
        const out = await talk(ctx, input, { confirm: a.has('tasdiq'), speak: a.has('ovoz') });
        return { text: out.text, data: out.intent, files: out.audioFile ? [out.audioFile] : [] };
      },
    },
    {
      name: 'tushun',
      usage: 'gap tushun "<gap>"',
      about: 'Faqat tushunganini ko‘rsatadi, bajarmaydi.',
      run: async (ctx, argv) => {
        const input = parseArgs(argv).rest(0).trim();
        if (!input) return { text: 'Gap kerak.' };
        const out = await talk(ctx, input, { dryRun: true });
        return { text: out.text, data: out.intent };
      },
    },
    {
      name: 'ovoz',
      usage: 'gap ovoz <fayl.ogg> [--ovoz] [--tasdiq]',
      about: 'Audio fayldagi buyruqni tushunib bajarish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const path = a.at(0);
        if (!path) return { text: 'Fayl kerak: gap ovoz ./buyruq.ogg' };
        if (!existsSync(path)) return { text: `Fayl topilmadi: ${path}` };
        if (!ctx.stt.enabled) return { text: 'Ovozni matnga o‘girish yoqilmagan (HAMROH_STT=off). docs/VOICE.md' };

        const heard = await ctx.stt.transcribe(new Uint8Array(readFileSync(path)), basename(path));
        const out = await talk(ctx, heard.text, { confirm: a.has('tasdiq'), speak: a.has('ovoz') });
        return {
          text: [`🎙 Eshitdim: "${heard.text}"`, '', out.text].join('\n'),
          data: { heard: heard.text, intent: out.intent },
          files: out.audioFile ? [out.audioFile] : [],
        };
      },
    },
    {
      name: 'ayt',
      usage: 'gap ayt "<matn>" [--fayl=javob.mp3]',
      about: 'Matnni ovozga aylantirish (TTS tekshiruvi).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const text = a.rest(0).trim();
        if (!text) return { text: 'Matn kerak: gap ayt "Assalomu alaykum"' };
        const speech = await ctx.tts.speak(text);
        mkdirSync(ctx.cfg.outDir, { recursive: true });
        const file = join(ctx.cfg.outDir, a.str('fayl', `ovoz-${dateKey(ctx.now, ctx.cfg.tz)}.${speech.ext}`));
        writeFileSync(file, speech.bytes);
        return { text: `🔊 ${Math.round(speech.bytes.length / 1024)} KB · ${speech.provider}`, files: [file] };
      },
    },
    {
      name: 'status',
      usage: 'gap status',
      about: 'Suhbat zanjiri holati: eshitish, tushunish, gapirish.',
      run: (ctx) => ({
        text: [
          `Eshitish (STT):   ${ctx.stt.enabled ? ctx.stt.id : 'o‘chirilgan (HAMROH_STT=off)'}`,
          `Tushunish:        qoidalar${ctx.llm.smart ? ` + ${ctx.llm.id}` : ' (LLM ulanmagan — cheklangan)'}`,
          `Gapirish (TTS):   ${ctx.tts.enabled ? ctx.tts.id : 'o‘chirilgan (HAMROH_TTS=off)'}`,
          `Ovozli buyruqlar: ${ctx.cfg.voiceCommands ? 'yoqilgan' : 'o‘chirilgan (HAMROH_VOICE_COMMANDS=1)'}`,
          '',
          'Sinash:  hamroh gap tushun "ertaga soat uchda uchrashuv qo‘y"',
        ].join('\n'),
      }),
    },
  ],
};
