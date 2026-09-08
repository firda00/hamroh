import type { Ctx, Module } from '../core/types.ts';
import type { Intent } from '../intent/types.ts';
import type { TgUpdate } from './telegram.ts';
import { parseArgs } from '../core/args.ts';
import { setting } from '../core/db.ts';
import { logger } from '../core/logger.ts';
import { talk, spokenText } from './assistant.ts';
import { execute, describe } from '../intent/index.ts';
import { api, call, sendText, sendVoice, sendButtons, answerCallback, downloadFile, mediaOf } from './telegram.ts';
import { buildBrief } from '../core/brief.ts';
import { truncate } from '../util/fmt.ts';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Telegram bot — to'liq ishlaydigan interfeys.
 *
 * Matn ham, ovoz ham buyruq sifatida qabul qilinadi; javob matn (va TTS yoqilgan
 * bo'lsa ovoz) bo'lib qaytadi. Xavfli buyruqlar tugma bilan tasdiqlanadi.
 *
 * Ikki rejim:
 *   hamroh bot start            — long polling (server kerak emas, oddiy jarayon)
 *   hamroh bot webhook --url=.. — webhook (serverless uchun; server.ts qabul qiladi)
 */

const log = logger('bot');

/** Telegram /buyruq lari — modul buyruqlariga xarita. */
const SLASH: Record<string, { module: string; command: string; args: string[]; about: string }> = {
  '/tong': { module: 'hisobot', command: 'tong', args: [], about: 'Ertalabki brifing' },
  '/kun': { module: 'hisobot', command: 'kun', args: [], about: 'Kun yakuni va o‘sish darajasi' },
  '/reja': { module: 'vazifa', command: 'plan', args: [], about: 'Bugungi ishlar ketma-ketligi' },
  '/vazifalar': { module: 'vazifa', command: 'list', args: ['--today'], about: 'Bugungi vazifalar' },
  '/kurs': { module: 'bozor', command: 'kurs', args: [], about: 'Valyuta kursi' },
  '/obhavo': { module: 'bozor', command: 'obhavo', args: [], about: 'Ob-havo' },
  '/yangilik': { module: 'yangilik', command: 'top', args: [], about: 'Yangiliklar xulosasi' },
  '/moliya': { module: 'moliya', command: 'today', args: [], about: 'Bugungi kirim-chiqim' },
  '/tolovlar': { module: 'oylik', command: 'check', args: [], about: 'To‘lanmagan majburiyatlar' },
  '/lidlar': { module: 'lid', command: 'list', args: ['--today'], about: 'Bugungi lidlar' },
  '/uchrashuvlar': { module: 'kalendar', command: 'list', args: [], about: 'Bugungi uchrashuvlar' },
  '/hisobot': { module: 'hisobot', command: 'hafta', args: [], about: 'Haftalik ko‘rsatkichlar' },
};

const HELP = [
  'Men — Hamroh, shaxsiy yordamchingiz.',
  '',
  'Oddiy tilda yozing yoki ayting:',
  '  «ertaga soat uchda Aziz aka bilan uchrashuv qo‘y»',
  '  «ikki yuz ming so‘m ovqatga sarfladim»',
  '  «bugun rejam qanday»',
  '',
  'Ovozli xabar ham yuborishingiz mumkin — matnga o‘girib bajaraman.',
  '',
  'Tez buyruqlar:',
  ...Object.entries(SLASH).map(([cmd, v]) => `  ${cmd} — ${v.about}`),
].join('\n');

/** Kim botdan foydalana oladi. Bo'sh bo'lsa — faqat TELEGRAM_CHAT_ID. */
export function allowedIds(ctx: Ctx): string[] {
  const extra = (process.env['TELEGRAM_ALLOWED_IDS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([ctx.cfg.telegram.chatId, ...extra].filter(Boolean))];
}

export function isAllowed(ctx: Ctx, chatId: string, userId: string): boolean {
  const list = allowedIds(ctx);
  // Ro'yxat bo'sh bo'lsa hech kimga ruxsat yo'q — bu xavfsizlik uchun ataylab shunday.
  return list.includes(String(chatId)) || list.includes(String(userId));
}

/** Tasdiq kutayotgan amalni saqlaydi va qisqa kalit qaytaradi (callback_data 64 bayt). */
export function stashAction(ctx: Ctx, chatId: string, intent: Intent): string {
  const id = randomUUID().slice(0, 8);
  ctx.db.run(
    `INSERT INTO pending_actions(id, created_at, chat_id, payload) VALUES(?,?,?,?)`,
    id,
    ctx.now.toISOString(),
    String(chatId),
    JSON.stringify(intent),
  );
  return id;
}

export function takeAction(ctx: Ctx, id: string): Intent | null {
  const row = ctx.db.get<{ payload: string; status: string }>(
    `SELECT payload, status FROM pending_actions WHERE id=?`,
    id,
  );
  if (!row || row.status !== 'kutilmoqda') return null;
  ctx.db.run(`UPDATE pending_actions SET status='bajarildi' WHERE id=?`, id);
  return JSON.parse(row.payload) as Intent;
}

/** Javobni yuboradi: matn + (TTS yoqilgan bo'lsa) ovoz. */
async function reply(ctx: Ctx, chatId: string, text: string, withVoice = true): Promise<void> {
  await sendText(ctx, chatId, text);
  if (!withVoice || !ctx.tts.enabled) return;
  try {
    const speech = await ctx.tts.speak(spokenText(text, 700));
    await sendVoice(ctx, chatId, speech.bytes, speech.ext);
  } catch (e) {
    log.warn(`Ovozli javob berilmadi: ${(e as Error).message}`);
  }
}

/** Bitta matnli gapni qayta ishlaydi. */
async function handleText(ctx: Ctx, chatId: string, text: string): Promise<void> {
  const trimmed = text.trim();

  if (trimmed === '/start' || trimmed === '/help' || trimmed === '/yordam') {
    await sendText(ctx, chatId, HELP);
    return;
  }

  if (trimmed === '/status') {
    const { modules } = await import('./index.ts');
    await sendText(
      ctx,
      chatId,
      [
        `LLM: ${ctx.llm.smart ? ctx.llm.id : 'ulanmagan (qoidaviy rejim)'}`,
        `Ovoz (STT): ${ctx.stt.enabled ? ctx.stt.id : 'o‘chirilgan'}`,
        `Gapirish (TTS): ${ctx.tts.enabled ? ctx.tts.id : 'o‘chirilgan'}`,
        `Modullar: ${modules.length} ta`,
      ].join('\n'),
    );
    return;
  }

  const slash = SLASH[trimmed.split(/\s+/)[0] ?? ''];
  if (slash) {
    const { modules } = await import('./index.ts');
    const out = await execute(ctx, { ...slash, confidence: 1, explain: slash.about, needsConfirm: false, source: 'rules' }, modules);
    await reply(ctx, chatId, out.text, false);
    return;
  }

  if (trimmed.startsWith('/')) {
    await sendText(ctx, chatId, `Bunday buyruq yo‘q: ${trimmed}\n\n${HELP}`);
    return;
  }

  // Oddiy gap — tushunib bajaramiz
  const out = await talk(ctx, trimmed, { speak: false });

  if (out.intent?.needsConfirm && !out.result) {
    const id = stashAction(ctx, chatId, out.intent);
    await sendButtons(ctx, chatId, `⚠️ Tasdiqlang:\n${describe(out.intent)}`, [
      [
        { text: '✅ Ha, bajar', data: `ok:${id}` },
        { text: '❌ Yo‘q', data: `no:${id}` },
      ],
    ]);
    return;
  }

  await reply(ctx, chatId, out.text);
}

/** Ovozli xabarni qayta ishlaydi. */
async function handleVoice(ctx: Ctx, chatId: string, fileId: string): Promise<void> {
  if (!ctx.stt.enabled) {
    await sendText(ctx, chatId, 'Ovozni matnga o‘girish yoqilmagan (HAMROH_STT=off).');
    return;
  }
  const file = await downloadFile(ctx, fileId);
  const heard = await ctx.stt.transcribe(file.bytes, file.name);
  await sendText(ctx, chatId, `🎙 «${truncate(heard.text, 300)}»`);
  await handleText(ctx, chatId, heard.text);
}

/** Bitta update ni qayta ishlaydi — long polling ham, webhook ham shu funksiyani chaqiradi. */
export async function handleUpdate(ctx: Ctx, update: TgUpdate & { callback_query?: CallbackQuery }): Promise<void> {
  const cb = update.callback_query;
  if (cb) {
    const chatId = String(cb.message?.chat.id ?? '');
    if (!isAllowed(ctx, chatId, String(cb.from?.id ?? ''))) {
      await answerCallback(ctx, cb.id, 'Ruxsat yo‘q');
      return;
    }
    const [action = '', id = ''] = cb.data.split(':');
    const intent = takeAction(ctx, id);
    if (!intent) {
      await answerCallback(ctx, cb.id, 'Bu so‘rov eskirgan');
      return;
    }
    if (action === 'no') {
      await answerCallback(ctx, cb.id, 'Bekor qilindi');
      await sendText(ctx, chatId, '❌ Bekor qilindi.');
      return;
    }
    await answerCallback(ctx, cb.id, 'Bajarilmoqda…');
    const { modules } = await import('./index.ts');
    const out = await execute(ctx, intent, modules);
    await reply(ctx, chatId, `✅ ${intent.explain}\n\n${out.text}`);
    return;
  }

  const m = update.message;
  if (!m) return;
  const chatId = String(m.chat.id);
  const userId = String(m.from?.id ?? '');

  if (!isAllowed(ctx, chatId, userId)) {
    log.warn(`Ruxsatsiz murojaat: chat=${chatId} user=${userId}`);
    await sendText(ctx, chatId, 'Bu shaxsiy yordamchi. Sizga ruxsat berilmagan.');
    return;
  }

  const media = mediaOf(m);
  try {
    if (media && ['voice', 'audio', 'video_note'].includes(media.kind)) {
      await handleVoice(ctx, chatId, media.fileId);
    } else if (m.text || m.caption) {
      await handleText(ctx, chatId, m.text ?? m.caption ?? '');
    }
  } catch (e) {
    log.error(`Xato: ${(e as Error).message}`);
    await sendText(ctx, chatId, `Xato: ${(e as Error).message}`);
  }
}

type CallbackQuery = {
  id: string;
  data: string;
  from?: { id: number };
  message?: { chat: { id: number } };
};

/** Telegramda buyruqlar menyusini ko'rsatadi. */
export async function registerCommands(ctx: Ctx): Promise<void> {
  await call(ctx, 'setMyCommands', {
    commands: [
      { command: 'help', description: 'Yordam' },
      ...Object.entries(SLASH).map(([cmd, v]) => ({ command: cmd.slice(1), description: v.about })),
      { command: 'status', description: 'Tizim holati' },
    ],
  });
}

/** Long polling halqasi — to'xtatilguncha ishlaydi. */
export async function runPolling(ctx: Ctx, signal?: AbortSignal): Promise<void> {
  await call(ctx, 'deleteWebhook', { drop_pending_updates: false });
  await registerCommands(ctx);

  const me = await call<{ username: string }>(ctx, 'getMe', {});
  log.info(`@${me.username} ishga tushdi · ruxsat: ${allowedIds(ctx).join(', ') || '(hech kim!)'}`);
  if (!allowedIds(ctx).length) {
    log.warn('TELEGRAM_CHAT_ID yo‘q — bot hech kimga javob bermaydi. .env ni to‘ldiring.');
  }

  let offset = Number(setting.get(ctx.db, 'telegram:offset', '0'));

  while (!signal?.aborted) {
    try {
      const res = await fetch(
        `${api(ctx, 'getUpdates')}?timeout=30&offset=${offset + 1}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`,
        { signal: AbortSignal.timeout(45_000) },
      );
      const data = (await res.json()) as { ok: boolean; result?: (TgUpdate & { callback_query?: CallbackQuery })[]; description?: string };
      if (!data.ok) {
        log.warn(`getUpdates: ${data.description ?? 'xato'}`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      for (const update of data.result ?? []) {
        offset = Math.max(offset, update.update_id);
        setting.set(ctx.db, 'telegram:offset', String(offset));
        ctx.now = new Date();
        await handleUpdate(ctx, update);
      }
    } catch (e) {
      if (signal?.aborted) break;
      log.warn(`Halqa xatosi: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export const botModule: Module = {
  id: 'bot',
  title: 'Telegram bot',
  about: 'Telegramda matn va ovoz orqali to‘liq boshqaruv.',

  commands: [
    {
      name: 'start',
      usage: 'bot start',
      about: 'Botni ishga tushirish (long polling, to‘xtatilguncha ishlaydi).',
      run: async (ctx) => {
        if (!ctx.cfg.telegram.token) return { text: 'TELEGRAM_BOT_TOKEN yo‘q. @BotFather dan oling.' };
        await runPolling(ctx);
        return { text: 'To‘xtatildi.' };
      },
    },
    {
      name: 'webhook',
      usage: 'bot webhook --url=https://domen/telegram [--secret=...]',
      about: 'Webhook o‘rnatish (serverless yoki reverse-proxy uchun).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const url = a.str('url');
        if (!ctx.cfg.telegram.token) return { text: 'TELEGRAM_BOT_TOKEN yo‘q.' };
        if (!url) {
          const info = await call<{ url?: string; pending_update_count?: number }>(ctx, 'getWebhookInfo', {});
          return {
            text: info.url
              ? `Webhook: ${info.url}\nNavbatda: ${info.pending_update_count ?? 0} ta`
              : 'Webhook o‘rnatilmagan (long polling rejimi).',
          };
        }
        const secret = a.str('secret', process.env['TELEGRAM_WEBHOOK_SECRET'] ?? '');
        await call(ctx, 'setWebhook', {
          url,
          secret_token: secret || undefined,
          allowed_updates: ['message', 'callback_query'],
        });
        await registerCommands(ctx);
        return { text: `✅ Webhook o‘rnatildi: ${url}${secret ? '\n(secret token bilan)' : ''}` };
      },
    },
    {
      name: 'stop-webhook',
      usage: 'bot stop-webhook',
      about: 'Webhook ni o‘chirish (long polling ga qaytish).',
      run: async (ctx) => {
        await call(ctx, 'deleteWebhook', { drop_pending_updates: false });
        return { text: 'Webhook o‘chirildi.' };
      },
    },
    {
      name: 'test',
      usage: 'bot test "<matn>"',
      about: 'Botga yozilgandek sinash (Telegramsiz).',
      run: async (ctx, argv) => {
        const text = parseArgs(argv).rest(0).trim();
        if (!text) return { text: 'Matn kerak: bot test "bugun rejam qanday"' };
        if (text === '/help' || text === '/start') return { text: HELP };
        const slash = SLASH[text.split(/\s+/)[0] ?? ''];
        const { modules } = await import('./index.ts');
        if (slash) {
          const out = await execute(ctx, { ...slash, confidence: 1, explain: slash.about, needsConfirm: false, source: 'rules' }, modules);
          return { text: out.text };
        }
        const out = await talk(ctx, text);
        return { text: out.text, data: out.intent };
      },
    },
    {
      name: 'yubor',
      usage: 'bot yubor "<matn>" [--ovoz]',
      about: 'Telegramga xabar yuborish (ixtiyoriy — ovoz bilan).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const text = a.rest(0).trim();
        const chat = a.str('chat', ctx.cfg.telegram.chatId);
        if (!text) return { text: 'Matn kerak.' };
        if (!chat) return { text: 'TELEGRAM_CHAT_ID yo‘q.' };
        await reply(ctx, chat, text, a.has('ovoz'));
        return { text: '✅ Yuborildi.' };
      },
    },
  ],

  jobs: [
    {
      name: 'bot.brifing',
      cron: '0 8 * * *',
      run: async (ctx) => {
        const chat = ctx.cfg.telegram.chatId;
        if (!ctx.cfg.telegram.token || !chat) return 'telegram ulanmagan';
        const { modules } = await import('./index.ts');
        const { text } = await buildBrief(ctx, modules, 'morning');
        await sendText(ctx, chat, text);
        return 'brifing yuborildi';
      },
    },
  ],
};
