import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { startOfDay, stamp, parseWhen } from '../util/date.ts';
import { table, truncate } from '../util/fmt.ts';
import { readCsv } from '../util/office.ts';
import { enqueue } from './notify.ts';
import { readFileSync } from 'node:fs';

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
      usage: 'aloqa sms <raqam> "<matn>"',
      about: 'SMS ni navbatga qo‘yish (yuborish bosqich 3 — shlyuz kerak).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const phone = a.at(0);
        const body = a.rest(1);
        if (!phone || !body) return { text: 'Masalan: aloqa sms +998901234567 "Assalomu alaykum, ertaga 10:00 da kutamiz"' };
        ctx.db.run(
          `INSERT INTO messages(ts, channel, direction, peer, body, handled) VALUES(?,?,?,?,?,0)`,
          ctx.now.toISOString(),
          'sms',
          'out',
          phone,
          body,
        );
        return {
          text: [
            `📤 SMS navbatga qo‘yildi: ${phone}`,
            `   "${truncate(body, 60)}"`,
            '',
            'Haqiqiy yuborish uchun SMS shlyuzi kerak (Eskiz/Playmobile) — bosqich 3.',
          ].join('\n'),
        };
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
