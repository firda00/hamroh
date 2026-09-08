import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { fetchJson, fetchText } from '../util/http.ts';
import { stamp } from '../util/date.ts';
import { truncate } from '../util/fmt.ts';
import { setting } from '../core/db.ts';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * (10) Telegram: xabar yuborish, kelganlarini o'qish, fayl jo'natish.
 * Bot API dan foydalanadi — .env da TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID kerak.
 */

type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    text?: string;
    caption?: string;
    chat: { id: number; title?: string; username?: string; first_name?: string };
    from?: { username?: string; first_name?: string };
    document?: { file_name: string; file_id: string };
    voice?: { file_id: string; duration: number };
    video?: { file_id: string };
    photo?: { file_id: string }[];
  };
};

type TgResp<T> = { ok: boolean; result: T; description?: string };

const api = (ctx: Ctx, method: string): string => `https://api.telegram.org/bot${ctx.cfg.telegram.token}/${method}`;

const needToken = (ctx: Ctx): string | null =>
  ctx.cfg.telegram.token
    ? null
    : [
        'TELEGRAM_BOT_TOKEN o‘rnatilmagan.',
        '',
        '1) Telegramda @BotFather ga /newbot yozing va tokenni oling.',
        '2) .env fayliga qo‘shing:',
        '     TELEGRAM_BOT_TOKEN=123456:AA...',
        '     TELEGRAM_CHAT_ID=<o‘z chat id ingiz>',
        '3) Chat ID ni bilish uchun botga bir marta yozing, keyin:  hamroh telegram poll',
      ].join('\n');

export const telegramModule: Module = {
  id: 'telegram',
  title: 'Telegram',
  about: 'Xabar yuborish, kelgan xabarlarni o‘qish, fayl jo‘natish.',

  commands: [
    {
      name: 'send',
      usage: 'telegram send "<matn>" [--chat=<id>]',
      about: 'Xabar yuborish.',
      run: async (ctx, argv) => {
        const warn = needToken(ctx);
        if (warn) return { text: warn };
        const a = parseArgs(argv);
        const text = a.rest(0);
        if (!text) return { text: 'Matn kerak: telegram send "Salom"' };
        const chat = a.str('chat', ctx.cfg.telegram.chatId);
        if (!chat) return { text: 'TELEGRAM_CHAT_ID kerak (yoki --chat=<id>).' };
        const res = await fetchJson<TgResp<{ message_id: number }>>(api(ctx, 'sendMessage'), {
          offline: ctx.cfg.offline,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text }),
        });
        if (!res.ok) return { text: `Xato: ${res.description ?? 'noma’lum'}` };
        ctx.db.run(
          `INSERT INTO messages(ts, channel, direction, peer, body, handled) VALUES(?,?,?,?,?,1)`,
          ctx.now.toISOString(),
          'telegram',
          'out',
          String(chat),
          text,
        );
        return { text: `✅ Yuborildi (#${res.result.message_id}).` };
      },
    },
    {
      name: 'file',
      usage: 'telegram file <yo‘l> [--chat=<id>] [--caption="izoh"]',
      about: 'Fayl (PDF, Excel, rasm) jo‘natish.',
      run: async (ctx, argv) => {
        const warn = needToken(ctx);
        if (warn) return { text: warn };
        const a = parseArgs(argv);
        const path = a.at(0);
        if (!path || !existsSync(path)) return { text: `Fayl topilmadi: ${path}` };
        const chat = a.str('chat', ctx.cfg.telegram.chatId);
        if (!chat) return { text: 'TELEGRAM_CHAT_ID kerak.' };

        const form = new FormData();
        form.append('chat_id', String(chat));
        if (a.has('caption')) form.append('caption', a.str('caption'));
        form.append('document', new Blob([readFileSync(path)]), basename(path));

        const res = (await (
          await fetch(api(ctx, 'sendDocument'), { method: 'POST', body: form })
        ).json()) as TgResp<{ message_id: number }>;
        return {
          text: res.ok
            ? `📎 ${basename(path)} yuborildi (${Math.round(statSync(path).size / 1024)} KB).`
            : `Xato: ${res.description ?? 'noma’lum'}`,
        };
      },
    },
    {
      name: 'poll',
      usage: 'telegram poll',
      about: 'Yangi xabarlarni olish va bazaga yozish.',
      run: async (ctx) => {
        const warn = needToken(ctx);
        if (warn) return { text: warn };
        const offset = Number(setting.get(ctx.db, 'telegram:offset', '0'));
        const res = await fetchJson<TgResp<TgUpdate[]>>(
          `${api(ctx, 'getUpdates')}?timeout=0&offset=${offset + 1}`,
          { offline: ctx.cfg.offline },
        );
        if (!res.ok) return { text: `Xato: ${res.description ?? 'noma’lum'}` };

        let last = offset;
        const lines: string[] = [];
        for (const u of res.result) {
          last = Math.max(last, u.update_id);
          const m = u.message;
          if (!m) continue;
          const kind = m.voice ? '[audio]' : m.document ? `[fayl: ${m.document.file_name}]` : m.video ? '[video]' : m.photo ? '[rasm]' : '';
          const body = [kind, m.text ?? m.caption ?? ''].filter(Boolean).join(' ').trim() || '(bo‘sh)';
          const peer = m.chat.title ?? m.from?.username ?? m.from?.first_name ?? String(m.chat.id);
          ctx.db.run(
            `INSERT INTO messages(ts, channel, direction, peer, body, handled, external_id) VALUES(?,?,?,?,?,0,?)`,
            new Date(m.date * 1000).toISOString(),
            'telegram',
            'in',
            peer,
            body,
            String(m.message_id),
          );
          lines.push(`${stamp(new Date(m.date * 1000), ctx.cfg.tz).slice(5)} ${peer}: ${truncate(body, 60)}  (chat_id: ${m.chat.id})`);
        }
        setting.set(ctx.db, 'telegram:offset', String(last));
        return { text: lines.length ? [`${lines.length} ta yangi xabar:`, ...lines].join('\n') : 'Yangi xabar yo‘q.' };
      },
    },
    {
      name: 'reply',
      usage: 'telegram reply <xabar-id> "<javob>"',
      about: 'Kelgan xabarga javob berish va o‘qilgan deb belgilash.',
      run: async (ctx, argv) => {
        const warn = needToken(ctx);
        if (warn) return { text: warn };
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        const text = a.rest(1);
        const msg = ctx.db.get<{ id: number; peer: string }>(`SELECT * FROM messages WHERE id=?`, id);
        if (!msg) return { text: `Xabar #${id} topilmadi. Ro‘yxat: aloqa inbox` };
        if (!text) return { text: 'Javob matni kerak.' };
        const chat = ctx.cfg.telegram.chatId || msg.peer;
        await fetchText(api(ctx, 'sendMessage'), {
          offline: ctx.cfg.offline,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text }),
        });
        ctx.db.run(`UPDATE messages SET handled=1 WHERE id=?`, id);
        return { text: `✅ Javob yuborildi (#${id}).` };
      },
    },
    {
      name: 'status',
      usage: 'telegram status',
      about: 'Ulanish holati.',
      run: async (ctx) => {
        const warn = needToken(ctx);
        if (warn) return { text: warn };
        const me = await fetchJson<TgResp<{ username: string; first_name: string }>>(api(ctx, 'getMe'), {
          offline: ctx.cfg.offline,
        });
        return {
          text: me.ok
            ? `✅ Bot: @${me.result.username} (${me.result.first_name})\n   Chat ID: ${ctx.cfg.telegram.chatId || 'o‘rnatilmagan'}`
            : `Xato: ${me.description ?? 'token noto‘g‘ri'}`,
        };
      },
    },
  ],

  jobs: [
    {
      name: 'telegram.poll',
      cron: '*/10 * * * *',
      run: async (ctx) => {
        if (!ctx.cfg.telegram.token) return 'token yo‘q';
        const offset = Number(setting.get(ctx.db, 'telegram:offset', '0'));
        const res = await fetchJson<TgResp<TgUpdate[]>>(`${api(ctx, 'getUpdates')}?timeout=0&offset=${offset + 1}`, {
          offline: ctx.cfg.offline,
        });
        if (!res.ok) return 'xato';
        let last = offset;
        for (const u of res.result) {
          last = Math.max(last, u.update_id);
          const m = u.message;
          if (!m) continue;
          ctx.db.run(
            `INSERT INTO messages(ts, channel, direction, peer, body, handled, external_id) VALUES(?,?,?,?,?,0,?)`,
            new Date(m.date * 1000).toISOString(),
            'telegram',
            'in',
            m.chat.title ?? m.from?.username ?? String(m.chat.id),
            m.text ?? m.caption ?? '(media)',
            String(m.message_id),
          );
        }
        setting.set(ctx.db, 'telegram:offset', String(last));
        return `${res.result.length} ta update`;
      },
    },
  ],
};
