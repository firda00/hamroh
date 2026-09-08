import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { stamp } from '../util/date.ts';
import { fetchText } from '../util/http.ts';
import { logger } from '../core/logger.ts';

/** Eslatmalar navbati — barcha modullar shu yerga yozadi, bitta joydan yetkaziladi. */

const log = logger('notify');

export type Notification = {
  id: number;
  created_at: string;
  deliver_at: string;
  channel: string;
  module: string;
  title: string;
  body: string;
  status: string;
  dedupe_key: string | null;
};

export function enqueue(
  ctx: Ctx,
  n: { module: string; title: string; body: string; dedupeKey?: string; deliverAt?: Date; channel?: string },
): boolean {
  const r = ctx.db.run(
    `INSERT OR IGNORE INTO notifications(created_at, deliver_at, channel, module, title, body, dedupe_key)
     VALUES(?,?,?,?,?,?,?)`,
    ctx.now.toISOString(),
    (n.deliverAt ?? ctx.now).toISOString(),
    n.channel ?? (ctx.cfg.telegram.token ? 'telegram' : 'console'),
    n.module,
    n.title,
    n.body,
    n.dedupeKey ?? null,
  );
  return r.changes > 0;
}

export function pending(ctx: Ctx): Notification[] {
  return ctx.db.all<Notification>(
    `SELECT * FROM notifications WHERE status='kutilmoqda' AND deliver_at <= ? ORDER BY deliver_at ASC`,
    ctx.now.toISOString(),
  );
}

/** Navbatdagilarni yetkazadi. Telegram tokeni bo'lmasa — konsolga. */
export async function flush(ctx: Ctx): Promise<{ sent: number; failed: number; lines: string[] }> {
  const items = pending(ctx);
  const lines: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const n of items) {
    const text = `🔔 ${n.title}\n${n.body}`;
    let ok = true;
    if (n.channel === 'telegram' && ctx.cfg.telegram.token && ctx.cfg.telegram.chatId) {
      try {
        const url = `https://api.telegram.org/bot${ctx.cfg.telegram.token}/sendMessage`;
        await fetchText(url, {
          offline: ctx.cfg.offline,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: ctx.cfg.telegram.chatId, text }),
        });
      } catch (e) {
        ok = false;
        log.warn(`Telegram xatosi: ${(e as Error).message}`);
      }
    }
    ctx.db.run(`UPDATE notifications SET status=? WHERE id=?`, ok ? 'yuborildi' : 'xato', n.id);
    if (ok) sent++;
    else failed++;
    lines.push(`${stamp(new Date(n.deliver_at), ctx.cfg.tz)}  ${ok ? '✓' : '✗'} [${n.module}] ${n.title}`);
  }
  return { sent, failed, lines };
}

export const notifyModule: Module = {
  id: 'eslatma',
  title: 'Eslatmalar',
  about: 'Barcha modullardan kelgan ogohlantirishlar navbati.',

  commands: [
    {
      name: 'list',
      usage: 'eslatma list [--all]',
      about: 'Navbatdagi eslatmalar.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const items = a.has('all')
          ? ctx.db.all<Notification>(`SELECT * FROM notifications ORDER BY id DESC LIMIT 50`)
          : pending(ctx);
        if (!items.length) return { text: 'Navbat bo‘sh.' };
        return {
          text: items
            .map((n) => `${stamp(new Date(n.deliver_at), ctx.cfg.tz)} [${n.status}] ${n.title} — ${n.body}`)
            .join('\n'),
          data: items,
        };
      },
    },
    {
      name: 'send',
      usage: 'eslatma send',
      about: 'Navbatdagilarni yetkazish (konsol yoki Telegram).',
      run: async (ctx) => {
        const r = await flush(ctx);
        return {
          text: r.lines.length ? [...r.lines, '', `Yuborildi: ${r.sent}, xato: ${r.failed}`].join('\n') : 'Yuboriladigan eslatma yo‘q.',
          data: r,
        };
      },
    },
    {
      name: 'add',
      usage: 'eslatma add "<sarlavha>" "<matn>"',
      about: 'Qo‘lda eslatma qo‘shish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.at(0);
        if (!title) return { text: 'Sarlavha kerak.' };
        enqueue(ctx, { module: 'manual', title, body: a.rest(1) || '—' });
        return { text: `🔔 Navbatga qo‘shildi: ${title}` };
      },
    },
  ],
};
