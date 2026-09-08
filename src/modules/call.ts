import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { allowedNumbers, isAllowedNumber, normalizeNumber } from '../tel/index.ts';
import { naturalizeForSpeech } from '../util/speech.ts';
import { spokenText, talk } from './assistant.ts';
import { buildBrief } from '../core/brief.ts';
import { pending } from './notify.ts';
import { logger } from '../core/logger.ts';
import { truncate } from '../util/fmt.ts';
import { readFileSync } from 'node:fs';

/**
 * Telefon qo'ng'irog'i: agent o'zi qo'ng'iroq qilib, gapni aytadi.
 *
 * Zanjir:  matn -> TTS -> operator (Asterisk/Twilio) -> qo'ng'iroq
 *          va operator javobni yozib bera olsa: yozuv -> Whisper -> buyruq
 *
 * Xavfsizlik: faqat ruxsat berilgan raqamlarga. Ro'yxat bo'sh bo'lsa — hech kimga.
 * Sababi oddiy: noto'g'ri eshitilgan gap begona odamga qo'ng'iroq qilib yubormasligi kerak.
 */

const log = logger('qongiroq');

export type CallOutcome = {
  ok: boolean;
  to: string;
  said: string;
  heard?: string;
  acted?: string;
};

/** Bitta qo'ng'iroq: matnni aytadi, javob yozilgan bo'lsa uni tushunadi. */
export async function makeCall(ctx: Ctx, to: string, text: string, record = false): Promise<CallOutcome> {
  const number = normalizeNumber(to);

  if (!ctx.tel.enabled) throw new Error('Qo‘ng‘iroq yoqilmagan (HAMROH_TEL=off). docs/CALLS.md');
  if (!ctx.tts.enabled) throw new Error('Qo‘ng‘iroq uchun TTS kerak (HAMROH_TTS). docs/VOICE.md');
  if (!isAllowedNumber(ctx.cfg, number)) {
    const list = allowedNumbers(ctx.cfg);
    throw new Error(
      list.length
        ? `${number} ruxsat ro‘yxatida yo‘q. Ruxsat berilganlar: ${list.join(', ')}`
        : 'Ruxsat ro‘yxati bo‘sh — HAMROH_TEL_MY_NUMBER ni to‘ldiring.',
    );
  }

  const said = naturalizeForSpeech(text);
  const audio = await ctx.tts.speak(said);
  const res = await ctx.tel.call({ to: number, text: said, record }, audio);
  log.info(`${number} — ${res.ok ? 'bajarildi' : 'xato'}${res.id ? ` (${res.id})` : ''}`);

  const out: CallOutcome = { ok: res.ok, to: number, said };

  // Javob yozib olingan bo'lsa — matnga o'girib, buyruq sifatida qaraymiz
  if (res.recordingPath && ctx.stt.enabled) {
    try {
      const heard = await ctx.stt.transcribe(new Uint8Array(readFileSync(res.recordingPath)), 'javob.wav');
      out.heard = heard.text;
      if (heard.text.trim()) {
        const acted = await talk(ctx, heard.text, { speak: false });
        out.acted = acted.text;
      }
    } catch (e) {
      log.warn(`Javobni o‘qib bo‘lmadi: ${(e as Error).message}`);
    }
  }

  ctx.db.run(
    `INSERT INTO calls(ts, direction, phone, name, note) VALUES(?,?,?,?,?)`,
    ctx.now.toISOString(),
    'out',
    number,
    'Hamroh',
    truncate(said, 300),
  );
  return out;
}

export const callModule: Module = {
  id: 'qongiroq',
  title: 'Telefon qo‘ng‘irog‘i',
  about: 'Agent o‘zi qo‘ng‘iroq qilib, brifing yoki eslatmani aytib beradi.',

  commands: [
    {
      name: 'status',
      usage: 'qongiroq status',
      about: 'Qo‘ng‘iroq zanjiri holati.',
      run: (ctx) => ({
        text: [
          `Operator:   ${ctx.tel.enabled ? ctx.tel.id : 'o‘chirilgan (HAMROH_TEL=off)'}`,
          `Ovoz (TTS): ${ctx.tts.enabled ? ctx.tts.id : 'o‘chirilgan — qo‘ng‘iroq uchun shart'}`,
          `Eshitish:   ${ctx.stt.enabled ? ctx.stt.id : 'o‘chirilgan (javobni tushunmaydi)'}`,
          `Ruxsat:     ${allowedNumbers(ctx.cfg).join(', ') || 'hech kim (HAMROH_TEL_MY_NUMBER bo‘sh)'}`,
        ].join('\n'),
      }),
    },
    {
      name: 'qil',
      usage: 'qongiroq qil <raqam> "<matn>" [--javob]',
      about: 'Qo‘ng‘iroq qilib matnni aytish (--javob bilan javobni ham eshitadi).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const to = a.at(0);
        const text = a.rest(1).trim();
        if (!to || !text) return { text: 'Masalan: qongiroq qil +998901234567 "Arenda to‘lovi bugun"' };

        const out = await makeCall(ctx, to, text, a.has('javob'));
        const lines = [`📞 ${out.to} — ${out.ok ? 'qo‘ng‘iroq qilindi' : 'xato'}`, `   Aytildi: "${truncate(out.said, 120)}"`];
        if (out.heard) lines.push(`   Eshitildi: "${truncate(out.heard, 120)}"`);
        if (out.acted) lines.push('', out.acted);
        return { text: lines.join('\n'), data: out };
      },
    },
    {
      name: 'brifing',
      usage: 'qongiroq brifing [--kechqurun]',
      about: 'Menga qo‘ng‘iroq qilib, kun brifingini o‘qib berish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const to = ctx.cfg.telMyNumber;
        if (!to) return { text: 'HAMROH_TEL_MY_NUMBER o‘rnatilmagan.' };
        const { modules } = await import('./index.ts');
        const { text } = await buildBrief(ctx, modules, a.has('kechqurun') ? 'evening' : 'morning');
        const out = await makeCall(ctx, to, spokenText(text, 1200));
        return { text: `📞 ${out.to} — brifing o‘qildi.`, data: out };
      },
    },
    {
      name: 'eslatma',
      usage: 'qongiroq eslatma',
      about: 'Navbatdagi eslatmalarni qo‘ng‘iroq orqali aytish.',
      run: async (ctx) => {
        const to = ctx.cfg.telMyNumber;
        if (!to) return { text: 'HAMROH_TEL_MY_NUMBER o‘rnatilmagan.' };
        const items = pending(ctx);
        if (!items.length) return { text: 'Aytiladigan eslatma yo‘q.' };

        const text = items.map((n) => `${n.title}. ${n.body}`).join('. ');
        const out = await makeCall(ctx, to, truncate(text, 1200));
        for (const n of items) ctx.db.run(`UPDATE notifications SET status='yuborildi' WHERE id=?`, n.id);
        return { text: `📞 ${items.length} ta eslatma aytildi (${out.to}).`, data: out };
      },
    },
  ],

  jobs: [
    {
      name: 'qongiroq.shoshilinch',
      cron: '*/30 8-21 * * *',
      run: async (ctx) => {
        // Faqat ataylab yoqilganda ishlaydi — qo'ng'iroq bezovta qiladigan narsa
        if (process.env['HAMROH_TEL_URGENT'] !== '1') return 'o‘chirilgan';
        if (!ctx.tel.enabled || !ctx.cfg.telMyNumber) return 'sozlanmagan';

        // Shoshilinch: bugun muddati o'tgan to'lov yoki kechikkan vazifa
        const urgent = ctx.db.all<{ title: string }>(
          `SELECT title FROM notifications WHERE status='kutilmoqda' AND module IN ('oylik','buxgalter')`,
        );
        if (!urgent.length) return 'shoshilinch narsa yo‘q';

        const text = `Shoshilinch. ${urgent.map((u) => u.title).join('. ')}`;
        await makeCall(ctx, ctx.cfg.telMyNumber, text);
        return `${urgent.length} ta shoshilinch xabar aytildi`;
      },
    },
  ],
};
