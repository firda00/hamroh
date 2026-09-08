import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { dateKey, addDays, startOfDay, parseWhen } from '../util/date.ts';
import { table, growth, bar } from '../util/fmt.ts';
import { readCsv } from '../util/office.ts';
import { enqueue } from './notify.ts';
import { readFileSync } from 'node:fs';

/**
 * (15) Sog'liq: qadam, uyqu, puls, vazn, suv.
 * Bosqich 1 — qo'lda yoki soat eksporti (CSV). Bosqich 3 — soat API si.
 */

export const KINDS: Record<string, { unit: string; label: string; goal: number }> = {
  steps: { unit: 'qadam', label: 'Qadamlar', goal: 8000 },
  sleep: { unit: 'soat', label: 'Uyqu', goal: 7 },
  pulse: { unit: 'bpm', label: 'Puls', goal: 70 },
  weight: { unit: 'kg', label: 'Vazn', goal: 0 },
  water: { unit: 'l', label: 'Suv', goal: 2 },
};

export type HealthRow = { id: number; ts: string; kind: string; value: number; unit: string; source: string };

export function dailyAvg(ctx: Ctx, kind: string, fromIso: string, toIso: string): number {
  const r = ctx.db.get<{ avg: number | null }>(
    `SELECT AVG(value) avg FROM health_metrics WHERE kind=? AND ts BETWEEN ? AND ?`,
    kind,
    fromIso,
    toIso,
  );
  return r?.avg ?? 0;
}

export const healthModule: Module = {
  id: 'soglik',
  title: 'Sog‘liq',
  about: 'Qadam, uyqu, puls, vazn, suv — kuzatuv va tahlil.',

  commands: [
    {
      name: 'log',
      usage: `soglik log <${Object.keys(KINDS).join('|')}> <qiymat> [--date="bugun"]`,
      about: 'Ko‘rsatkich yozish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const kind = a.at(0);
        const value = Number(a.at(1).replace(',', '.'));
        const spec = KINDS[kind];
        if (!spec || !Number.isFinite(value)) return { text: `Masalan: soglik log steps 9200` };
        const when = a.has('date') ? parseWhen(a.str('date'), ctx.cfg.tz, ctx.now) ?? ctx.now : ctx.now;
        ctx.db.run(
          `INSERT INTO health_metrics(ts, kind, value, unit, source) VALUES(?,?,?,?,?)`,
          when.toISOString(),
          kind,
          value,
          spec.unit,
          a.str('source', 'manual'),
        );
        const vs = spec.goal ? ` (maqsad ${spec.goal} ${spec.unit})` : '';
        return { text: `❤️ ${spec.label}: ${value} ${spec.unit}${vs}` };
      },
    },
    {
      name: 'import',
      usage: 'soglik import <fayl.csv>',
      about: 'Soat/telefon eksportini yuklash (date;kind;value).',
      run: (ctx, argv) => {
        const file = parseArgs(argv).at(0);
        if (!file) return { text: 'Fayl kerak: soglik import ./watch.csv' };
        const { headers, rows } = readCsv(readFileSync(file, 'utf8'));
        const col = (n: string[]): number => headers.findIndex((h) => n.some((x) => h.toLowerCase().includes(x)));
        const iDate = col(['date', 'sana']);
        const iKind = col(['kind', 'type', 'tur']);
        const iValue = col(['value', 'qiymat']);
        if ([iDate, iKind, iValue].some((i) => i < 0)) return { text: `Ustunlar: date, kind, value. Bor: ${headers.join(', ')}` };
        let n = 0;
        ctx.db.tx(() => {
          for (const r of rows) {
            const kind = (r[iKind] ?? '').toLowerCase();
            const value = Number((r[iValue] ?? '').replace(',', '.'));
            if (!KINDS[kind] || !Number.isFinite(value)) continue;
            const when = parseWhen(r[iDate] ?? '', ctx.cfg.tz, ctx.now) ?? ctx.now;
            ctx.db.run(
              `INSERT INTO health_metrics(ts, kind, value, unit, source) VALUES(?,?,?,?,?)`,
              when.toISOString(),
              kind,
              value,
              KINDS[kind].unit,
              'watch',
            );
            n++;
          }
        });
        return { text: `📥 ${n} ta o‘lchov yuklandi.` };
      },
    },
    {
      name: 'report',
      usage: 'soglik report [--days=7]',
      about: 'Haftalik tahlil va maqsadga nisbatan holat.',
      run: (ctx, argv) => {
        const days = parseArgs(argv).num('days', 7);
        const to = ctx.now.toISOString();
        const from = addDays(ctx.now, -days).toISOString();
        const prevFrom = addDays(ctx.now, -days * 2).toISOString();

        const rows = Object.entries(KINDS)
          .map(([kind, spec]): (string | number)[] | null => {
            const cur = dailyAvg(ctx, kind, from, to);
            const prev = dailyAvg(ctx, kind, prevFrom, from);
            if (!cur && !prev) return null;
            const goalText = spec.goal ? `${bar(cur, spec.goal, 12)} ${((cur / spec.goal) * 100).toFixed(0)}%` : '—';
            return [spec.label, `${cur.toFixed(1)} ${spec.unit}`, prev ? prev.toFixed(1) : '—', growth(prev, cur).text, goalText];
          })
          .filter((r) => r !== null);

        if (!rows.length) return { text: 'Ma’lumot yo‘q. Yozish: soglik log steps 9200' };
        return {
          text: [`Oxirgi ${days} kun (kunlik o‘rtacha):`, '', table(['Ko‘rsatkich', 'Joriy', 'Oldingi', 'O‘zgarish', 'Maqsad'], rows)].join('\n'),
          data: rows,
        };
      },
    },
    {
      name: 'advise',
      usage: 'soglik advise',
      about: 'Sog‘liq bo‘yicha tavsiyalar (tibbiy maslahat emas).',
      run: async (ctx) => {
        const to = ctx.now.toISOString();
        const from = addDays(ctx.now, -7).toISOString();
        const facts = Object.entries(KINDS)
          .map(([kind, spec]) => {
            const v = dailyAvg(ctx, kind, from, to);
            return v ? `${spec.label}: kunlik o‘rtacha ${v.toFixed(1)} ${spec.unit}${spec.goal ? ` (maqsad ${spec.goal})` : ''}` : '';
          })
          .filter(Boolean);
        if (!facts.length) return { text: 'Tahlil uchun ma’lumot yetarli emas.' };
        const res = await ctx.llm.run({
          kind: 'advise',
          topic: 'Sog‘liq odatlari (oxirgi 7 kun)',
          facts,
          question: 'Kundalik rejimni qanday yaxshilash mumkin? Amaliy 3-4 ta qadam.',
        });
        return { text: `${res.text}\n\n⚕️ Eslatma: bu tibbiy maslahat emas, shifokor o‘rnini bosmaydi.` };
      },
    },
  ],

  jobs: [
    {
      name: 'soglik.kunlik',
      cron: '0 21 * * *',
      run: (ctx) => {
        const from = startOfDay(ctx.now, ctx.cfg.tz).toISOString();
        const steps = ctx.db.get<{ v: number | null }>(
          `SELECT SUM(value) v FROM health_metrics WHERE kind='steps' AND ts >= ?`,
          from,
        );
        const goal = KINDS['steps']?.goal ?? 8000;
        if ((steps?.v ?? 0) < goal) {
          enqueue(ctx, {
            module: 'soglik',
            title: 'Qadam maqsadi bajarilmadi',
            body: `Bugun ${Math.round(steps?.v ?? 0)} qadam (maqsad ${goal}). Kechqurun qisqa yurish rejalashtiring.`,
            dedupeKey: `health-steps:${dateKey(ctx.now, ctx.cfg.tz)}`,
          });
          return 'ogohlantirish qo‘yildi';
        }
        return 'maqsad bajarildi';
      },
    },
  ],

  evening: (ctx) => {
    const from = startOfDay(ctx.now, ctx.cfg.tz).toISOString();
    const rows = ctx.db.all<{ kind: string; total: number }>(
      `SELECT kind, SUM(value) total FROM health_metrics WHERE ts >= ? GROUP BY kind`,
      from,
    );
    if (!rows.length) return null;
    return {
      order: 80,
      title: 'Sog‘liq',
      lines: rows.map((r) => {
        const spec = KINDS[r.kind];
        return `${spec?.label ?? r.kind}: ${r.total.toFixed(1)} ${spec?.unit ?? ''}`;
      }),
    };
  },
};
