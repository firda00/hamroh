import type { Ctx, Module } from '../core/types.ts';
import { parseArgs, parseAmount } from '../core/args.ts';
import { monthKey, parts, daysInMonth } from '../util/date.ts';
import { money, table } from '../util/fmt.ts';
import { enqueue } from './notify.ts';

/** (12) Har oylik doimiy to'lovlar: arenda, kommunal, obunalar, kredit. */

export type Recurring = {
  id: number;
  title: string;
  amount: number;
  currency: string;
  day_of_month: number;
  category: string;
  active: number;
  notes: string | null;
  last_paid_period: string | null;
};

export function activeItems(ctx: Ctx): Recurring[] {
  return ctx.db.all<Recurring>(`SELECT * FROM recurring WHERE active=1 ORDER BY day_of_month ASC`);
}

/** Shu oyda hali to'lanmaganlar. */
export function unpaid(ctx: Ctx): Recurring[] {
  const period = monthKey(ctx.now, ctx.cfg.tz);
  return activeItems(ctx).filter((r) => r.last_paid_period !== period);
}

export const recurringModule: Module = {
  id: 'oylik',
  title: 'Oylik majburiy to‘lovlar',
  about: 'Arenda, kommunal, obuna va boshqa har oy takrorlanadigan to‘lovlar.',

  commands: [
    {
      name: 'add',
      usage: 'oylik add "<nom>" <summa> --day=5 [--cat=arenda] [--notes=".."]',
      about: 'Yangi doimiy to‘lov qo‘shish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.at(0);
        const amount = parseAmount(a.at(1));
        const day = a.num('day', 1);
        if (!title || !amount) return { text: 'Masalan: oylik add "Ofis arendasi" 5mln --day=5 --cat=arenda' };
        const r = ctx.db.run(
          `INSERT INTO recurring(title, amount, currency, day_of_month, category, notes) VALUES(?,?,?,?,?,?)`,
          title,
          amount,
          ctx.cfg.currency,
          Math.min(31, Math.max(1, day)),
          a.str('cat', 'majburiy'),
          a.str('notes') || null,
        );
        return { text: `📌 #${r.lastInsertRowid} ${title} — har oy ${day}-kuni, ${money(amount, ctx.cfg.currency)}` };
      },
    },
    {
      name: 'list',
      usage: 'oylik list',
      about: 'Barcha doimiy to‘lovlar va holati.',
      run: (ctx) => {
        const items = activeItems(ctx);
        if (!items.length) return { text: 'Doimiy to‘lov qo‘shilmagan.' };
        const period = monthKey(ctx.now, ctx.cfg.tz);
        const total = items.reduce((s, r) => s + r.amount, 0);
        return {
          text: [
            table(
              ['#', 'Nom', 'Kun', 'Summa', 'Toifa', `${period} holati`],
              items.map((r) => [
                r.id,
                r.title,
                r.day_of_month,
                money(r.amount, r.currency),
                r.category,
                r.last_paid_period === period ? '✓ to‘landi' : '• kutilmoqda',
              ]),
            ),
            '',
            `Oylik yuk: ${money(total, ctx.cfg.currency)}`,
          ].join('\n'),
          data: items,
        };
      },
    },
    {
      name: 'paid',
      usage: 'oylik paid <id> [--period=2026-09] [--ledger]',
      about: 'To‘landi deb belgilash (--ledger bilan chiqimga ham yozadi).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        const period = a.str('period', monthKey(ctx.now, ctx.cfg.tz));
        const item = ctx.db.get<Recurring>(`SELECT * FROM recurring WHERE id=?`, id);
        if (!item) return { text: `#${id} topilmadi.` };
        ctx.db.run(`UPDATE recurring SET last_paid_period=? WHERE id=?`, period, id);
        if (a.has('ledger')) {
          ctx.db.run(
            `INSERT INTO ledger(ts, kind, amount, currency, category, note, source) VALUES(?,?,?,?,?,?,?)`,
            ctx.now.toISOString(),
            'expense',
            item.amount,
            item.currency,
            item.category,
            `${item.title} (${period})`,
            'manual',
          );
        }
        return { text: `✅ ${item.title} — ${period} uchun to‘landi.` };
      },
    },
    {
      name: 'check',
      usage: 'oylik check',
      about: 'Shu oyda to‘lanmaganlarni ko‘rsatadi va eslatma qo‘yadi.',
      run: (ctx) => {
        const items = unpaid(ctx);
        const period = monthKey(ctx.now, ctx.cfg.tz);
        const today = parts(ctx.now, ctx.cfg.tz).d;
        if (!items.length) return { text: `${period}: hamma doimiy to‘lovlar bajarilgan. 👌` };
        const lines = items.map((r) => {
          const left = r.day_of_month - today;
          const state = left < 0 ? `⚠️ ${-left} kun kechikdi` : left === 0 ? '❗ bugun' : `${left} kun qoldi`;
          enqueue(ctx, {
            module: 'oylik',
            title: `To‘lov: ${r.title}`,
            body: `${money(r.amount, r.currency)} — ${r.day_of_month}-kun (${state})`,
            dedupeKey: `recurring:${r.id}:${period}`,
          });
          return `  • ${r.title} — ${money(r.amount, r.currency)} — ${state}`;
        });
        const total = items.reduce((s, r) => s + r.amount, 0);
        return { text: [`${period} — to‘lanmagan (${items.length}):`, ...lines, '', `Jami: ${money(total, ctx.cfg.currency)}`].join('\n'), data: items };
      },
    },
  ],

  jobs: [
    {
      name: 'oylik.month-start',
      cron: '0 9 1 * *',
      run: (ctx) => {
        const items = activeItems(ctx);
        const period = monthKey(ctx.now, ctx.cfg.tz);
        const total = items.reduce((s, r) => s + r.amount, 0);
        enqueue(ctx, {
          module: 'oylik',
          title: `${period}: oylik to‘lovlar rejasi`,
          body: [
            ...items.map((r) => `${r.day_of_month}-kun · ${r.title} · ${money(r.amount, r.currency)}`),
            `Jami: ${money(total, ctx.cfg.currency)}`,
          ].join('\n'),
          dedupeKey: `recurring-plan:${period}`,
        });
        return `${items.length} ta to‘lov rejaga qo‘yildi`;
      },
    },
    {
      name: 'oylik.daily-check',
      cron: '0 9 * * *',
      run: (ctx) => {
        const today = parts(ctx.now, ctx.cfg.tz).d;
        const period = monthKey(ctx.now, ctx.cfg.tz);
        const dim = daysInMonth(period);
        let n = 0;
        for (const r of unpaid(ctx)) {
          const dueDay = Math.min(r.day_of_month, dim);
          if (dueDay - today <= 3) {
            enqueue(ctx, {
              module: 'oylik',
              title: `To‘lov yaqinlashdi: ${r.title}`,
              body: `${money(r.amount, r.currency)} — ${dueDay}-kun`,
              dedupeKey: `recurring-due:${r.id}:${period}`,
            });
            n++;
          }
        }
        return `${n} ta ogohlantirish`;
      },
    },
  ],

  morning: (ctx) => {
    const items = unpaid(ctx);
    if (!items.length) return null;
    const today = parts(ctx.now, ctx.cfg.tz).d;
    const soon = items.filter((r) => r.day_of_month - today <= 5);
    if (!soon.length) return null;
    return {
      order: 60,
      title: 'Yaqin to‘lovlar',
      lines: soon.map((r) => {
        const left = r.day_of_month - today;
        return `${r.title} — ${money(r.amount, r.currency)} — ${left < 0 ? `${-left} kun kechikdi` : left === 0 ? 'BUGUN' : `${left} kun qoldi`}`;
      }),
      alert: soon.some((r) => r.day_of_month - today <= 0),
    };
  },
};
