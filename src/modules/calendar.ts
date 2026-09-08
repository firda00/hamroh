import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { parseWhen, stamp, startOfDay, endOfDay, addDays, humanUntil, timeKey } from '../util/date.ts';
import { table, truncate } from '../util/fmt.ts';
import { fetchText } from '../util/http.ts';
import { enqueue } from './notify.ts';
import { existsSync, readFileSync } from 'node:fs';

/** (4) Kalendar: uchrashuvlar, bo'sh vaqt, ICS import. */

export type Event = {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  attendees: string | null;
  notes: string | null;
  source: string;
  external_id: string | null;
  status: string;
};

export function eventsBetween(ctx: Ctx, from: Date, to: Date): Event[] {
  return ctx.db.all<Event>(
    `SELECT * FROM events WHERE status <> 'bekor' AND start_at BETWEEN ? AND ? ORDER BY start_at ASC`,
    from.toISOString(),
    to.toISOString(),
  );
}

/** ICS matnidan hodisalarni ajratish (VEVENT bloklari). */
export function parseIcs(text: string): { uid: string; title: string; start: string; end: string; location: string }[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  const field = (b: string, name: string): string =>
    b.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'm'))?.[1]?.trim() ?? '';

  const toIso = (raw: string): string => {
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
    if (!m) return '';
    const [, y, mo, d, H = '00', M = '00', S = '00'] = m;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(H), Number(M), Number(S))).toISOString();
  };

  return blocks
    .map((b) => ({
      uid: field(b, 'UID'),
      title: field(b, 'SUMMARY') || '(nomsiz)',
      start: toIso(field(b, 'DTSTART')),
      end: toIso(field(b, 'DTEND')),
      location: field(b, 'LOCATION'),
    }))
    .filter((e) => e.start);
}

export const calendarModule: Module = {
  id: 'kalendar',
  title: 'Kalendar va uchrashuvlar',
  about: 'Uchrashuvlarni belgilash, kun jadvalini ko‘rish, ICS import.',

  commands: [
    {
      name: 'add',
      usage: 'kalendar add "<nom>" --at="ertaga 15:00" [--dur=60] [--where=ofis] [--with="Ali, Vali"]',
      about: 'Uchrashuv belgilash.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.at(0) || a.rest(0);
        const atRaw = a.str('at');
        if (!title || !atRaw) return { text: 'Masalan: kalendar add "Investor bilan" --at="ertaga 15:00" --dur=60' };
        const start = parseWhen(atRaw, ctx.cfg.tz, ctx.now);
        if (!start) return { text: `Vaqtni tushunmadim: "${atRaw}"` };
        const dur = a.num('dur', 60);
        const end = new Date(start.getTime() + dur * 60_000);

        const r = ctx.db.run(
          `INSERT INTO events(title, start_at, end_at, location, attendees, notes) VALUES(?,?,?,?,?,?)`,
          title,
          start.toISOString(),
          end.toISOString(),
          a.str('where') || null,
          a.str('with') || null,
          a.str('notes') || null,
        );
        return {
          text: `📅 #${r.lastInsertRowid} ${title} — ${stamp(start, ctx.cfg.tz)}–${timeKey(end, ctx.cfg.tz)} (${humanUntil(start, ctx.now)})`,
        };
      },
    },
    {
      name: 'list',
      usage: 'kalendar list [--today] [--week]',
      about: 'Uchrashuvlar jadvali.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const from = startOfDay(ctx.now, ctx.cfg.tz);
        const to = a.has('week') ? endOfDay(addDays(ctx.now, 7), ctx.cfg.tz) : endOfDay(ctx.now, ctx.cfg.tz);
        const items = eventsBetween(ctx, from, to);
        if (!items.length) return { text: 'Bu davrda uchrashuv yo‘q.' };
        return {
          text: table(
            ['#', 'Vaqt', 'Uchrashuv', 'Joy', 'Kim bilan'],
            items.map((e) => [
              e.id,
              stamp(new Date(e.start_at), ctx.cfg.tz),
              truncate(e.title, 36),
              e.location ?? '—',
              e.attendees ?? '—',
            ]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'free',
      usage: 'kalendar free [--day="ertaga"] [--from=09:00] [--to=19:00]',
      about: 'Bo‘sh oynalarni ko‘rsatadi.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const base = a.has('day') ? parseWhen(a.str('day'), ctx.cfg.tz, ctx.now) ?? ctx.now : ctx.now;
        const dayStart = parseWhen(`${a.str('from', '09:00')}`, ctx.cfg.tz, startOfDay(base, ctx.cfg.tz)) ?? startOfDay(base, ctx.cfg.tz);
        const dayEnd = parseWhen(`${a.str('to', '19:00')}`, ctx.cfg.tz, startOfDay(base, ctx.cfg.tz)) ?? endOfDay(base, ctx.cfg.tz);
        const items = eventsBetween(ctx, startOfDay(base, ctx.cfg.tz), endOfDay(base, ctx.cfg.tz));

        const slots: string[] = [];
        let cursor = dayStart.getTime();
        for (const e of items) {
          const s = new Date(e.start_at).getTime();
          const en = e.end_at ? new Date(e.end_at).getTime() : s + 3600_000;
          if (s - cursor >= 30 * 60_000) {
            slots.push(`${timeKey(new Date(cursor), ctx.cfg.tz)}–${timeKey(new Date(s), ctx.cfg.tz)}`);
          }
          cursor = Math.max(cursor, en);
        }
        if (dayEnd.getTime() - cursor >= 30 * 60_000) {
          slots.push(`${timeKey(new Date(cursor), ctx.cfg.tz)}–${timeKey(dayEnd, ctx.cfg.tz)}`);
        }
        return {
          text: slots.length ? `Bo‘sh oynalar:\n${slots.map((s) => `  · ${s}`).join('\n')}` : 'Bo‘sh oyna yo‘q.',
          data: slots,
        };
      },
    },
    {
      name: 'rm',
      usage: 'kalendar rm <id>',
      about: 'Uchrashuvni bekor qilish.',
      run: (ctx, argv) => {
        const id = Number(parseArgs(argv).at(0));
        const r = ctx.db.run(`UPDATE events SET status='bekor' WHERE id=?`, id);
        return { text: r.changes ? `🗑 #${id} bekor qilindi.` : `#${id} topilmadi.` };
      },
    },
    {
      name: 'ics',
      usage: 'kalendar ics <url yoki fayl.ics>',
      about: 'Google Calendar / Outlook ICS havolasidan import.',
      run: async (ctx, argv) => {
        const src = parseArgs(argv).at(0) || process.env['GOOGLE_CALENDAR_ICS_URL'] || '';
        if (!src) return { text: 'ICS havolasi kerak (yoki .env da GOOGLE_CALENDAR_ICS_URL).' };
        const text = existsSync(src) ? readFileSync(src, 'utf8') : await fetchText(src, { offline: ctx.cfg.offline });
        const events = parseIcs(text);
        let n = 0;
        ctx.db.tx(() => {
          for (const e of events) {
            const exists = e.uid ? ctx.db.get(`SELECT id FROM events WHERE external_id=?`, e.uid) : undefined;
            if (exists) continue;
            ctx.db.run(
              `INSERT INTO events(title, start_at, end_at, location, source, external_id) VALUES(?,?,?,?,?,?)`,
              e.title,
              e.start,
              e.end || null,
              e.location || null,
              'ics',
              e.uid || null,
            );
            n++;
          }
        });
        return { text: `📥 ${n} ta yangi uchrashuv import qilindi (jami ${events.length}).` };
      },
    },
  ],

  jobs: [
    {
      name: 'kalendar.reminder',
      cron: '*/15 * * * *',
      run: (ctx) => {
        const soon = new Date(ctx.now.getTime() + 45 * 60_000);
        const items = eventsBetween(ctx, ctx.now, soon);
        for (const e of items) {
          enqueue(ctx, {
            module: 'kalendar',
            title: `Uchrashuv: ${e.title}`,
            body: `${stamp(new Date(e.start_at), ctx.cfg.tz)} · ${e.location ?? 'joy ko‘rsatilmagan'} — ${humanUntil(new Date(e.start_at), ctx.now)}`,
            dedupeKey: `event:${e.id}`,
          });
        }
        return `${items.length} ta uchrashuv eslatmasi`;
      },
    },
  ],

  morning: (ctx) => {
    const items = eventsBetween(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
    return {
      order: 40,
      title: `Bugungi uchrashuvlar (${items.length})`,
      lines: items.length
        ? items.map((e) => `${timeKey(new Date(e.start_at), ctx.cfg.tz)} — ${e.title}${e.location ? ` · ${e.location}` : ''}`)
        : ['Uchrashuv yo‘q.'],
    };
  },
};
