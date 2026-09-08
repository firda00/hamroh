import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { stamp } from '../util/date.ts';
import { table, truncate } from '../util/fmt.ts';
import { sttStatus } from '../stt/local.ts';
import { downloadFile, sendText, sendVoice } from './telegram.ts';
import { talk } from './assistant.ts';
import { enqueue } from './notify.ts';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * (10) Ovozli xabarlar → matn.
 *
 * Telegramdan kelgan ovozli xabar `messages` jadvalida `media_kind='voice'` bilan yotadi;
 * shu modul uni yuklab olib, Whisper serveriga yuboradi va matnini o'sha yozuvga qaytaradi.
 */

export type VoiceMessage = {
  id: number;
  ts: string;
  peer: string;
  body: string;
  media_kind: string | null;
  media_id: string | null;
  duration_sec: number | null;
  transcribed_at: string | null;
};

/** Ovoz sifatida ko'riladigan turlar. */
const AUDIO_KINDS = ['voice', 'audio', 'video_note'];

export function pendingVoice(ctx: Ctx, limit = 20): VoiceMessage[] {
  return ctx.db.all<VoiceMessage>(
    `SELECT * FROM messages
     WHERE channel='telegram' AND direction='in'
       AND media_kind IN (${AUDIO_KINDS.map(() => '?').join(',')})
       AND transcribed_at IS NULL AND media_id IS NOT NULL
     ORDER BY id DESC LIMIT ?`,
    ...AUDIO_KINDS,
    limit,
  );
}

/** Bitta xabarni matnga o'giradi va bazaga yozadi. */
export async function transcribeMessage(ctx: Ctx, msg: VoiceMessage): Promise<string> {
  if (!msg.media_id) throw new Error(`#${msg.id}: media_id yo‘q`);
  const file = await downloadFile(ctx, msg.media_id);
  const res = await ctx.stt.transcribe(file.bytes, file.name);

  ctx.db.run(
    `UPDATE messages SET body=?, transcribed_at=? WHERE id=?`,
    res.text,
    ctx.now.toISOString(),
    msg.id,
  );
  return res.text;
}

/**
 * O'girilgan matnni buyruq sifatida bajaradi va javobni Telegramga qaytaradi.
 * HAMROH_VOICE_COMMANDS=1 bo'lmasa hech narsa qilmaydi.
 */
export async function actOnVoice(ctx: Ctx, msg: VoiceMessage, text: string): Promise<string | null> {
  if (!ctx.cfg.voiceCommands) return null;

  const out = await talk(ctx, text, { speak: ctx.tts.enabled });
  const chat = ctx.cfg.telegram.chatId;

  if (chat && ctx.cfg.telegram.token) {
    try {
      await sendText(ctx, chat, `🎙 "${truncate(text, 200)}"\n\n${out.text}`);
      if (out.audioFile) {
        const { readFileSync: read } = await import('node:fs');
        const ext = out.audioFile.split('.').pop() ?? 'mp3';
        await sendVoice(ctx, chat, new Uint8Array(read(out.audioFile)), ext);
      }
    } catch (e) {
      // Javob yetkazilmasa ham transkripsiya saqlanib qoladi
      return `javob yuborilmadi: ${(e as Error).message}`;
    }
  }
  if (out.intent) ctx.db.run(`UPDATE messages SET handled=1 WHERE id=?`, msg.id);
  return out.text;
}

export const voiceModule: Module = {
  id: 'ovoz',
  title: 'Ovozli xabarlar',
  about: 'Telegram ovozli xabarlarini va audio fayllarni matnga o‘girish (Whisper).',

  commands: [
    {
      name: 'status',
      usage: 'ovoz status',
      about: 'Whisper serveri holati.',
      run: async (ctx) => {
        if (!ctx.stt.enabled) {
          return { text: 'Ovoz moduli o‘chirilgan (HAMROH_STT=off).\nYoqish: docs/VOICE.md' };
        }
        const st = await sttStatus(ctx.cfg.sttUrl, ctx.cfg.sttKey);
        const waiting = pendingVoice(ctx, 100).length;
        return {
          text: [
            `Provayder:  ${ctx.stt.id}`,
            `Server:     ${st.ok ? '✓' : '✗'} ${ctx.cfg.sttUrl}${st.ok ? '' : ` — ${st.error}`}`,
            st.ok && st.models.length ? `Modellar:   ${st.models.join(', ')}` : '',
            `Til:        ${ctx.cfg.sttLang || '(avtomatik aniqlash)'}`,
            `Navbatda:   ${waiting} ta ovozli xabar`,
          ]
            .filter(Boolean)
            .join('\n'),
          data: st,
        };
      },
    },
    {
      name: 'fayl',
      usage: 'ovoz fayl <yo‘l.ogg> [--save]',
      about: 'Lokal audio faylni matnga o‘girish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const path = a.at(0);
        if (!path) return { text: 'Fayl kerak: ovoz fayl ./yozuv.ogg' };
        if (!existsSync(path)) return { text: `Fayl topilmadi: ${path}` };

        const started = Date.now();
        const res = await ctx.stt.transcribe(new Uint8Array(readFileSync(path)), basename(path));
        const secs = ((Date.now() - started) / 1000).toFixed(1);

        const files: string[] = [];
        if (a.has('save')) {
          mkdirSync(ctx.cfg.outDir, { recursive: true });
          const out = join(ctx.cfg.outDir, `${basename(path).replace(/\.[^.]+$/, '')}.txt`);
          writeFileSync(out, res.text, 'utf8');
          files.push(out);
        }
        return {
          text: [res.text, '', `(${secs}s · ${res.provider}${res.language ? ` · til: ${res.language}` : ''})`].join('\n'),
          data: res,
          files,
        };
      },
    },
    {
      name: 'sync',
      usage: 'ovoz sync [--limit=10]',
      about: 'Telegramdan kelgan ovozli xabarlarni matnga o‘girish.',
      run: async (ctx, argv) => {
        if (!ctx.stt.enabled) return { text: 'Ovoz moduli o‘chirilgan (HAMROH_STT=off). Batafsil: docs/VOICE.md' };
        const limit = parseArgs(argv).num('limit', 10);
        const items = pendingVoice(ctx, limit);
        if (!items.length) return { text: 'Matnga o‘giriladigan ovozli xabar yo‘q.' };

        const lines: string[] = [];
        let ok = 0;
        for (const m of items) {
          try {
            const text = await transcribeMessage(ctx, m);
            ok++;
            lines.push(`✓ #${m.id} ${m.peer} (${m.duration_sec ?? '?'}s): ${truncate(text, 70)}`);
            const acted = await actOnVoice(ctx, m, text);
            if (acted) lines.push(`   ↳ ${truncate(acted.split('\n')[0] ?? '', 70)}`);
          } catch (e) {
            lines.push(`✗ #${m.id} ${m.peer}: ${(e as Error).message.split('\n')[0]}`);
          }
        }
        return { text: [...lines, '', `${ok}/${items.length} ta o‘girildi.`].join('\n'), data: { ok, total: items.length } };
      },
    },
    {
      name: 'list',
      usage: 'ovoz list [--limit=20]',
      about: 'O‘girilgan ovozli xabarlar.',
      run: (ctx, argv) => {
        const limit = parseArgs(argv).num('limit', 20);
        const items = ctx.db.all<VoiceMessage>(
          `SELECT * FROM messages WHERE media_kind IN ('voice','audio','video_note')
           ORDER BY id DESC LIMIT ?`,
          limit,
        );
        if (!items.length) return { text: 'Ovozli xabar yo‘q.' };
        return {
          text: table(
            ['#', 'Vaqt', 'Kim', 'Uzunlik', 'Holat', 'Matn'],
            items.map((m) => [
              m.id,
              stamp(new Date(m.ts), ctx.cfg.tz).slice(5),
              truncate(m.peer, 16),
              m.duration_sec ? `${m.duration_sec}s` : '—',
              m.transcribed_at ? '✓' : 'kutilmoqda',
              truncate(m.body, 40),
            ]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'xulosa',
      usage: 'ovoz xulosa <xabar-id>',
      about: 'Uzun ovozli xabarning qisqacha mazmuni (LLM ulangan bo‘lsa).',
      run: async (ctx, argv) => {
        const id = Number(parseArgs(argv).at(0));
        const m = ctx.db.get<VoiceMessage>(`SELECT * FROM messages WHERE id=?`, id);
        if (!m) return { text: `#${id} topilmadi.` };
        if (!m.transcribed_at) return { text: `#${id} hali matnga o‘girilmagan. Avval:  ovoz sync` };
        const res = await ctx.llm.run({ kind: 'summarize', text: m.body, maxSentences: 3 });
        return { text: [`#${id} · ${m.peer}`, '', res.text].join('\n') };
      },
    },
  ],

  jobs: [
    {
      name: 'ovoz.sync',
      cron: '*/10 * * * *',
      run: async (ctx) => {
        if (!ctx.stt.enabled || !ctx.cfg.telegram.token) return 'o‘chirilgan';
        const items = pendingVoice(ctx, 5);
        if (!items.length) return 'navbat bo‘sh';
        let ok = 0;
        for (const m of items) {
          try {
            const text = await transcribeMessage(ctx, m);
            ok++;
            const acted = await actOnVoice(ctx, m, text);
            if (acted) continue; // javob allaqachon Telegramga ketdi
            enqueue(ctx, {
              module: 'ovoz',
              title: `Ovozli xabar: ${m.peer}`,
              body: truncate(text, 500),
              dedupeKey: `voice:${m.id}`,
            });
          } catch {
            // keyingi tikda qayta urinadi — transcribed_at o'zgarmagan
          }
        }
        return `${ok}/${items.length} ta o‘girildi`;
      },
    },
  ],

  morning: (ctx) => {
    const items = ctx.db.all<VoiceMessage>(
      `SELECT * FROM messages WHERE media_kind IN ('voice','audio','video_note')
         AND transcribed_at IS NOT NULL AND handled=0 ORDER BY id DESC LIMIT 5`,
    );
    if (!items.length) return null;
    return {
      order: 56,
      title: `O‘qilmagan ovozli xabarlar (${items.length})`,
      lines: items.map((m) => `${m.peer}: ${truncate(m.body, 70)}`),
    };
  },
};
