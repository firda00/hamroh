import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { startOfDay, stamp, parseWhen } from '../util/date.ts';
import { table, truncate } from '../util/fmt.ts';
import { readCsv } from '../util/office.ts';
import { enqueue } from './notify.ts';
import { readFileSync } from 'node:fs';
import { smsParts, smsNumber } from '../sms/index.ts';
import { startOfDay as dayStart } from '../util/date.ts';
import { logger } from '../core/logger.ts';

/**
 * (11) Qo'ng'iroqlar va SMS.
 *
 * Bosqich 1: qo'ng'iroqlar tarixi qo'lda yoki telefon eksportidan (CSV) yuklanadi,
 * SMS lar navbatga qo'yiladi. Haqiqiy yuborish uchun bosqich 3 da SMS shlyuzi
 * (Eskiz, Playmobile va h.k.) ulanadi — `sms send` shu joydan chaqiriladi.
 */

export type Call = {
  id: number;
  ts: string;
  direction: string;
  phone: string;
  name: string | null;
  duration_sec: number;
  note: string | null;
  callback_needed: number;
};

export type Msg = {
  id: number;
  ts: string;
  channel: string;
  direction: string;
  peer: string;
  body: string;
  handled: number;
};

const log = logger('sms');

export type Outgoing = { id: number; peer: string; body: string; status: string; error: string | null };

/** Navbatga qo'yish — yuborish alohida qadamda, shuning uchun xabar yo'qolmaydi. */
export function queueSms(ctx: Ctx, phone: string, body: string): number {
  const r = ctx.db.run(
    `INSERT INTO messages(ts, channel, direction, peer, body, handled, status)
     VALUES(?,?,?,?,?,0,'navbatda')`,
    ctx.now.toISOString(),
    'sms',
    'out',
    smsNumber(phone),
    body,
  );
  return r.lastInsertRowid;
}

/** Bugun nechta SMS yuborilgan — kunlik chegara uchun. */
export function sentToday(ctx: Ctx): number {
  const from = dayStart(ctx.now, ctx.cfg.tz).toISOString();
  return (
    ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM messages WHERE channel='sms' AND direction='out'
         AND status='yuborildi' AND sent_at >= ?`,
      from,
    )?.n ?? 0
  );
}

export function pendingSms(ctx: Ctx, limit = 20): Outgoing[] {
  return ctx.db.all<Outgoing>(
    `SELECT id, peer, body, status, error FROM messages
     WHERE channel='sms' AND direction='out' AND status IN ('navbatda','xato')
     ORDER BY id ASC LIMIT ?`,
    limit,
  );
}

/**
 * Navbatdagi SMS larni yuboradi.
 * Kunlik chegara — nazoratsiz sarfga qarshi himoya: avtomatlashtirilgan tizim
 * xato tufayli yuzlab SMS yuborib yubormasligi kerak.
 */
export async function flushSms(ctx: Ctx, limit = 20): Promise<{ sent: number; failed: number; lines: string[] }> {
  const lines: string[] = [];
  let sent = 0;
  let failed = 0;

  if (!ctx.sms.enabled) return { sent: 0, failed: 0, lines: ['SMS shlyuzi ulanmagan (HAMROH_SMS=off).'] };

  const already = sentToday(ctx);
  const room = ctx.cfg.smsDailyLimit - already;
  if (room <= 0) {
    return {
      sent: 0,
      failed: 0,
      lines: [`Kunlik chegara tugadi: ${already}/${ctx.cfg.smsDailyLimit}. HAMROH_SMS_DAILY_LIMIT bilan oshiring.`],
    };
  }

  for (const m of pendingSms(ctx, Math.min(limit, room))) {
    try {
      const res = await ctx.sms.send(m.peer, m.body);
      ctx.db.run(
        `UPDATE messages SET status='yuborildi', handled=1, sent_at=?, external_id=?, error=NULL WHERE id=?`,
        ctx.now.toISOString(),
        res.id ?? null,
        m.id,
      );
      sent++;
      lines.push(`✓ #${m.id} ${m.peer}`);
      log.info(`#${m.id} -> ${m.peer}`);
    } catch (e) {
      const msg = (e as Error).message;
      ctx.db.run(`UPDATE messages SET status='xato', error=? WHERE id=?`, msg.slice(0, 500), m.id);
      failed++;
      lines.push(`✗ #${m.id} ${m.peer}: ${msg.split('\n')[0]}`);
      log.warn(`#${m.id}: ${msg}`);
    }
  }
  return { sent, failed, lines };
}

export const commsModule: Module = {
  id: 'aloqa',
  title: 'Qo‘ng‘iroq va SMS',
  about: 'Qo‘ng‘iroqlar bazasi, javobsiz raqamlar, SMS navbati.',

  commands: [
    {
      name: 'call',
      usage: 'aloqa call <raqam> [--dir=in|out|missed] [--name=..] [--sec=0] [izoh]',
      about: 'Qo‘ng‘iroqni qayd qilish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const phone = a.at(0);
        if (!phone) return { text: 'Masalan: aloqa call +998901234567 --dir=missed --name="Aziz aka"' };
        const dir = a.str('dir', 'in');
        const r = ctx.db.run(
          `INSERT INTO calls(ts, direction, phone, name, duration_sec, note, callback_needed) VALUES(?,?,?,?,?,?,?)`,
          (a.has('date') ? parseWhen(a.str('date'), ctx.cfg.tz, ctx.now) ?? ctx.now : ctx.now).toISOString(),
          dir,
          phone,
          a.str('name') || null,
          a.num('sec', 0),
          a.rest(1) || null,
          dir === 'missed' ? 1 : 0,
        );
        return { text: `📞 #${r.lastInsertRowid} ${dir} — ${phone}${dir === 'missed' ? ' (qayta qo‘ng‘iroq kerak)' : ''}` };
      },
    },
    {
      name: 'calls',
      usage: 'aloqa calls [--today] [--missed] [--limit=30]',
      about: 'Qo‘ng‘iroqlar bazasi.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        let items: Call[];
        if (a.has('missed')) {
          items = ctx.db.all<Call>(`SELECT * FROM calls WHERE callback_needed=1 ORDER BY ts DESC`);
        } else if (a.has('today')) {
          items = ctx.db.all<Call>(`SELECT * FROM calls WHERE ts >= ? ORDER BY ts DESC`, startOfDay(ctx.now, ctx.cfg.tz).toISOString());
        } else {
          items = ctx.db.all<Call>(`SELECT * FROM calls ORDER BY id DESC LIMIT ?`, a.num('limit', 30));
        }
        if (!items.length) return { text: 'Qo‘ng‘iroq yozuvi yo‘q.' };
        return {
          text: table(
            ['#', 'Vaqt', 'Yo‘nalish', 'Raqam', 'Ism', 'Davomiylik'],
            items.map((c) => [
              c.id,
              stamp(new Date(c.ts), ctx.cfg.tz).slice(5),
              c.direction === 'missed' ? '⚠️ javobsiz' : c.direction === 'in' ? 'kirish' : 'chiqish',
              c.phone,
              c.name ?? '—',
              c.duration_sec ? `${Math.round(c.duration_sec / 60)} daq` : '—',
            ]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'called',
      usage: 'aloqa called <id>',
      about: 'Qayta qo‘ng‘iroq qilindi deb belgilash.',
      run: (ctx, argv) => {
        const id = Number(parseArgs(argv).at(0));
        const r = ctx.db.run(`UPDATE calls SET callback_needed=0 WHERE id=?`, id);
        return { text: r.changes ? `✅ #${id} yopildi.` : `#${id} topilmadi.` };
      },
    },
    {
      name: 'import',
      usage: 'aloqa import <fayl.csv>',
      about: 'Telefon qo‘ng‘iroqlar tarixini yuklash (date;phone;direction;duration).',
      run: (ctx, argv) => {
        const file = parseArgs(argv).at(0);
        if (!file) return { text: 'Fayl kerak: aloqa import ./calls.csv' };
        const { headers, rows } = readCsv(readFileSync(file, 'utf8'));
        const col = (n: string[]): number => headers.findIndex((h) => n.some((x) => h.toLowerCase().includes(x)));
        const iDate = col(['date', 'sana', 'time']);
        const iPhone = col(['phone', 'raqam', 'number']);
        const iDir = col(['dir', 'type', 'tur']);
        const iDur = col(['dur', 'davom', 'length']);
        if (iPhone < 0) return { text: `Raqam ustuni topilmadi. Bor: ${headers.join(', ')}` };
        let n = 0;
        ctx.db.tx(() => {
          for (const r of rows) {
            const phone = r[iPhone];
            if (!phone) continue;
            const dirRaw = (iDir >= 0 ? r[iDir] ?? '' : '').toLowerCase();
            const dir = dirRaw.includes('miss') || dirRaw.includes('javobsiz') ? 'missed' : dirRaw.includes('out') ? 'out' : 'in';
            ctx.db.run(
              `INSERT INTO calls(ts, direction, phone, duration_sec, callback_needed) VALUES(?,?,?,?,?)`,
              (iDate >= 0 ? parseWhen(r[iDate] ?? '', ctx.cfg.tz, ctx.now) ?? ctx.now : ctx.now).toISOString(),
              dir,
              phone,
              iDur >= 0 ? Number(r[iDur]) || 0 : 0,
              dir === 'missed' ? 1 : 0,
            );
            n++;
          }
        });
        return { text: `📥 ${n} ta qo‘ng‘iroq yuklandi.` };
      },
    },
    {
      name: 'sms',
      usage: 'aloqa sms <raqam> "<matn>" [--keyin]',
      about: 'SMS yuborish (--keyin bilan faqat navbatga qo‘yadi).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const phone = a.at(0);
        const body = a.rest(1);
        if (!phone || !body) return { text: 'Masalan: aloqa sms +998901234567 "Ertaga soat 10 da kutamiz"' };

        const id = queueSms(ctx, phone, body);
        const size = smsParts(body);
        const info = `${size.length} belgi · ${size.parts} ta SMS${size.unicode ? ' (kirill/o‘zbekcha — 70 belgi chegara)' : ''}`;

        if (a.has('keyin') || !ctx.sms.enabled) {
          return {
            text: [
              `📤 Navbatga qo‘yildi #${id}: ${smsNumber(phone)}`,
              `   "${truncate(body, 60)}"`,
              `   ${info}`,
              ctx.sms.enabled ? '   Yuborish:  aloqa send' : '   Shlyuz ulanmagan — docs/SMS.md',
            ].join('\n'),
          };
        }

        const r = await flushSms(ctx, 1);
        return { text: [`${r.lines[0] ?? ''} — ${smsNumber(phone)}`, `   ${info}`].join('\n'), data: r };
      },
    },
    {
      name: 'send',
      usage: 'aloqa send [--limit=20]',
      about: 'Navbatdagi SMS larni yuborish.',
      run: async (ctx, argv) => {
        const r = await flushSms(ctx, parseArgs(argv).num('limit', 20));
        if (!r.lines.length) return { text: 'Navbatda SMS yo‘q.' };
        return {
          text: [...r.lines, '', `Yuborildi: ${r.sent}, xato: ${r.failed} · bugun jami: ${sentToday(ctx)}/${ctx.cfg.smsDailyLimit}`].join('\n'),
          data: r,
        };
      },
    },
    {
      name: 'outbox',
      usage: 'aloqa outbox',
      about: 'Yuborilmagan SMS lar.',
      run: (ctx) => {
        const items = pendingSms(ctx, 50);
        if (!items.length) return { text: `Navbat bo‘sh. Bugun yuborilgan: ${sentToday(ctx)}/${ctx.cfg.smsDailyLimit}` };
        return {
          text: table(
            ['#', 'Raqam', 'Holat', 'Matn', 'Xato'],
            items.map((m) => [m.id, m.peer, m.status, truncate(m.body, 40), truncate(m.error ?? '', 30)]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'balans',
      usage: 'aloqa balans',
      about: 'SMS shlyuzidagi balans.',
      run: async (ctx) => {
        if (!ctx.sms.enabled) return { text: 'SMS shlyuzi ulanmagan (HAMROH_SMS=off). docs/SMS.md' };
        if (!ctx.sms.balance) return { text: `${ctx.sms.id}: balansni ko‘rsatmaydi.` };
        const value = await ctx.sms.balance();
        return { text: `${ctx.sms.id}\nBalans: ${value}\nBugun yuborildi: ${sentToday(ctx)}/${ctx.cfg.smsDailyLimit}` };
      },
    },
    {
      name: 'inbox',
      usage: 'aloqa inbox [--all]',
      about: 'Kelgan SMS/xabarlar.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const items = a.has('all')
          ? ctx.db.all<Msg>(`SELECT * FROM messages ORDER BY id DESC LIMIT 50`)
          : ctx.db.all<Msg>(`SELECT * FROM messages WHERE handled=0 ORDER BY id DESC`);
        if (!items.length) return { text: 'Yangi xabar yo‘q.' };
        return {
          text: items
            .map((m) => `#${m.id} ${stamp(new Date(m.ts), ctx.cfg.tz).slice(5)} [${m.channel}/${m.direction}] ${m.peer}: ${truncate(m.body, 70)}`)
            .join('\n'),
          data: items,
        };
      },
    },
  ],

  jobs: [
    {
      name: 'aloqa.sms-navbat',
      cron: '*/5 * * * *',
      run: async (ctx) => {
        if (!ctx.sms.enabled) return 'shlyuz ulanmagan';
        const r = await flushSms(ctx, 10);
        return r.sent || r.failed ? `yuborildi ${r.sent}, xato ${r.failed}` : 'navbat bo‘sh';
      },
    },
    {
      name: 'aloqa.javobsiz',
      cron: '0 12,18 * * *',
      run: (ctx) => {
        const missed = ctx.db.all<Call>(`SELECT * FROM calls WHERE callback_needed=1 ORDER BY ts DESC`);
        if (!missed.length) return 'javobsiz qo‘ng‘iroq yo‘q';
        enqueue(ctx, {
          module: 'aloqa',
          title: `Javobsiz qo‘ng‘iroqlar: ${missed.length} ta`,
          body: missed.slice(0, 10).map((c) => `${c.phone}${c.name ? ` (${c.name})` : ''}`).join('\n'),
          dedupeKey: `calls-missed:${stamp(ctx.now, ctx.cfg.tz).slice(0, 13)}`,
        });
        return `${missed.length} ta javobsiz`;
      },
    },
  ],

  morning: (ctx) => {
    const missed = ctx.db.all<Call>(`SELECT * FROM calls WHERE callback_needed=1 ORDER BY ts DESC LIMIT 8`);
    const unread = ctx.db.all<Msg>(`SELECT * FROM messages WHERE handled=0 AND direction='in' LIMIT 5`);
    if (!missed.length && !unread.length) return null;
    return {
      order: 55,
      title: 'Aloqa',
      lines: [
        ...(missed.length ? [`Qayta qo‘ng‘iroq kerak: ${missed.length} ta`] : []),
        ...missed.slice(0, 5).map((c) => `  · ${c.phone}${c.name ? ` (${c.name})` : ''}`),
        ...(unread.length ? [`O‘qilmagan xabar: ${unread.length} ta`] : []),
      ],
      alert: missed.length > 0,
    };
  },
};
