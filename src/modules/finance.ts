import type { Ctx, Module } from '../core/types.ts';
import { parseArgs, parseAmount } from '../core/args.ts';
import { dateKey, monthKey, prevMonth, startOfDay, startOfMonth, parseWhen } from '../util/date.ts';
import { money, table, growth, bar, compact } from '../util/fmt.ts';
import { readCsv } from '../util/office.ts';
import { readFileSync } from 'node:fs';

/** (5) Shaxsiy moliya: kirim-chiqim, byudjet, tejash maslahatlari. */

export type Entry = {
  id: number;
  ts: string;
  kind: 'income' | 'expense';
  amount: number;
  currency: string;
  category: string;
  counterparty: string | null;
  note: string | null;
  source: string;
  necessity: string;
};

export type Totals = { income: number; expense: number; net: number; waste: number };

export function totals(ctx: Ctx, fromIso: string, toIso: string): Totals {
  const rows = ctx.db.all<{ kind: string; necessity: string; total: number }>(
    `SELECT kind, necessity, SUM(amount) total FROM ledger WHERE ts >= ? AND ts <= ? GROUP BY kind, necessity`,
    fromIso,
    toIso,
  );
  let income = 0;
  let expense = 0;
  let waste = 0;
  for (const r of rows) {
    if (r.kind === 'income') income += r.total;
    else {
      expense += r.total;
      if (r.necessity === 'kerakmas') waste += r.total;
    }
  }
  return { income, expense, net: income - expense, waste };
}

export function byCategory(ctx: Ctx, fromIso: string, toIso: string, kind = 'expense'): { category: string; total: number }[] {
  return ctx.db.all<{ category: string; total: number }>(
    `SELECT category, SUM(amount) total FROM ledger WHERE kind=? AND ts >= ? AND ts <= ?
     GROUP BY category ORDER BY total DESC`,
    kind,
    fromIso,
    toIso,
  );
}

const monthBounds = (period: string): [string, string] => [`${period}-01T00:00:00.000Z`, `${period}-31T23:59:59.999Z`];

/** Qoidaviy tejash maslahatlari — LLM'siz ham foydali. */
export function savingTips(ctx: Ctx, period: string): string[] {
  const [from, to] = monthBounds(period);
  const t = totals(ctx, from, to);
  const cats = byCategory(ctx, from, to);
  const tips: string[] = [];

  if (t.net < 0) tips.push(`Bu oy chiqim kirimdan ${money(-t.net, ctx.cfg.currency)} ko‘p — zarar rejimida.`);
  if (t.waste > 0) {
    const share = t.expense ? (t.waste / t.expense) * 100 : 0;
    tips.push(`"kerakmas" xarajatlar: ${money(t.waste, ctx.cfg.currency)} (${share.toFixed(0)}%) — shuni kesish eng oson tejamkorlik.`);
  }
  const top = cats[0];
  if (top && t.expense > 0 && top.total / t.expense > 0.35) {
    tips.push(`"${top.category}" toifasi barcha chiqimning ${((top.total / t.expense) * 100).toFixed(0)}% ini yeyapti — limit qo‘ying.`);
  }
  const budgets = ctx.db.all<{ category: string; limit_amount: number }>(
    `SELECT category, limit_amount FROM budgets WHERE month = ?`,
    period,
  );
  for (const b of budgets) {
    const spent = cats.find((c) => c.category === b.category)?.total ?? 0;
    if (spent > b.limit_amount) {
      tips.push(`Byudjet buzildi — "${b.category}": ${money(spent, ctx.cfg.currency)} / ${money(b.limit_amount, ctx.cfg.currency)}.`);
    }
  }
  if (t.income > 0 && t.net / t.income < 0.1) {
    tips.push(`Jamg‘arma darajasi ${((t.net / t.income) * 100).toFixed(0)}% — maqsad kamida 10-20%.`);
  }
  if (!tips.length) tips.push('Moliyaviy holat barqaror — hozircha ogohlantirish yo‘q.');
  return tips;
}

function addEntry(ctx: Ctx, kind: 'income' | 'expense', argv: string[]) {
  const a = parseArgs(argv);
  const amount = parseAmount(a.at(0));
  if (!amount) return { text: `Summa kerak. Masalan: moliya ${kind === 'income' ? 'in' : 'out'} 250000 --cat=ovqat` };
  const whenRaw = a.str('date');
  const when = whenRaw ? parseWhen(whenRaw, ctx.cfg.tz, ctx.now) ?? ctx.now : ctx.now;

  const r = ctx.db.run(
    `INSERT INTO ledger(ts, kind, amount, currency, category, counterparty, note, source, necessity)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    when.toISOString(),
    kind,
    amount,
    a.str('cur', ctx.cfg.currency),
    a.str('cat', kind === 'income' ? 'savdo' : 'boshqa'),
    a.str('who') || null,
    a.rest(1) || a.str('note') || null,
    'manual',
    a.str('need', 'kerak'),
  );
  const sign = kind === 'income' ? '+' : '−';
  return { text: `${sign} ${money(amount, ctx.cfg.currency)} yozildi (#${r.lastInsertRowid}, ${a.str('cat', kind === 'income' ? 'savdo' : 'boshqa')})` };
}

export const financeModule: Module = {
  id: 'moliya',
  title: 'Shaxsiy moliya',
  about: 'Kirim-chiqim, byudjet, kunlik va oylik moliyaviy hisobot, tejash maslahatlari.',

  commands: [
    {
      name: 'in',
      usage: 'moliya in <summa> [--cat=savdo] [--who=kim] [--date="bugun"] [izoh]',
      about: 'Kirim yozish.',
      run: (ctx, argv) => addEntry(ctx, 'income', argv),
    },
    {
      name: 'out',
      usage: 'moliya out <summa> [--cat=ovqat] [--need=kerak|kerakmas] [--date=..] [izoh]',
      about: 'Chiqim yozish.',
      run: (ctx, argv) => addEntry(ctx, 'expense', argv),
    },
    {
      name: 'today',
      usage: 'moliya today',
      about: 'Bugungi kirim-chiqim.',
      run: (ctx) => {
        const from = startOfDay(ctx.now, ctx.cfg.tz).toISOString();
        const to = ctx.now.toISOString();
        const t = totals(ctx, from, to);
        const items = ctx.db.all<Entry>(`SELECT * FROM ledger WHERE ts >= ? ORDER BY ts`, from);
        const lines = [
          `Kirim:  ${money(t.income, ctx.cfg.currency)}`,
          `Chiqim: ${money(t.expense, ctx.cfg.currency)}`,
          `Qoldi:  ${money(t.net, ctx.cfg.currency)}`,
        ];
        if (items.length) {
          lines.push(
            '',
            table(
              ['#', 'Tur', 'Summa', 'Toifa', 'Izoh'],
              items.map((e) => [e.id, e.kind === 'income' ? '+' : '−', compact(e.amount), e.category, e.note ?? '']),
            ),
          );
        }
        return { text: lines.join('\n'), data: { totals: t, items } };
      },
    },
    {
      name: 'month',
      usage: 'moliya month [--period=2026-09]',
      about: 'Oylik hisobot: toifalar, o‘sish, byudjet.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const period = a.str('period', monthKey(ctx.now, ctx.cfg.tz));
        const [from, to] = monthBounds(period);
        const [pfrom, pto] = monthBounds(prevMonth(period));
        const cur = totals(ctx, from, to);
        const prev = totals(ctx, pfrom, pto);
        const cats = byCategory(ctx, from, to);
        const max = cats[0]?.total ?? 0;

        const lines = [
          `Davr: ${period}`,
          '',
          table(
            ['Ko‘rsatkich', 'Joriy', 'O‘tgan oy', 'O‘zgarish'],
            [
              ['Kirim', money(cur.income, ctx.cfg.currency), money(prev.income, ctx.cfg.currency), growth(prev.income, cur.income).text],
              ['Chiqim', money(cur.expense, ctx.cfg.currency), money(prev.expense, ctx.cfg.currency), growth(prev.expense, cur.expense).text],
              ['Sof qoldiq', money(cur.net, ctx.cfg.currency), money(prev.net, ctx.cfg.currency), growth(prev.net, cur.net).text],
            ],
          ),
          '',
          'Chiqim toifalari:',
          ...cats.map((c) => `  ${c.category.padEnd(14)} ${bar(c.total, max, 20)} ${money(c.total, ctx.cfg.currency)}`),
          '',
          'Maslahatlar:',
          ...savingTips(ctx, period).map((s) => `  • ${s}`),
        ];
        return { text: lines.join('\n'), data: { period, cur, prev, cats } };
      },
    },
    {
      name: 'budget',
      usage: 'moliya budget <toifa> <summa> [--period=2026-09]',
      about: 'Toifa uchun oylik limit belgilash.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const cat = a.at(0);
        const amount = parseAmount(a.at(1));
        if (!cat || !amount) return { text: 'Masalan: moliya budget ovqat 2mln' };
        const period = a.str('period', monthKey(ctx.now, ctx.cfg.tz));
        ctx.db.run(
          `INSERT INTO budgets(category, month, limit_amount, currency) VALUES(?,?,?,?)
           ON CONFLICT(category, month) DO UPDATE SET limit_amount = excluded.limit_amount`,
          cat,
          period,
          amount,
          ctx.cfg.currency,
        );
        return { text: `📊 ${period} uchun "${cat}" limiti: ${money(amount, ctx.cfg.currency)}` };
      },
    },
    {
      name: 'advise',
      usage: 'moliya advise [--period=2026-09]',
      about: 'Tejash va moliyaviy intizom bo‘yicha maslahat.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const period = a.str('period', monthKey(ctx.now, ctx.cfg.tz));
        const facts = savingTips(ctx, period);
        const [from, to] = monthBounds(period);
        const cats = byCategory(ctx, from, to).slice(0, 6);
        const res = await ctx.llm.run({
          kind: 'advise',
          topic: `Shaxsiy moliya, ${period}`,
          facts: [...facts, ...cats.map((c) => `${c.category}: ${money(c.total, ctx.cfg.currency)}`)],
          question: 'Qanday tejash mumkin? 4 ta aniq, bajarish mumkin bo‘lgan qadam ayt.',
        });
        return { text: res.text, data: { facts } };
      },
    },
    {
      name: 'import',
      usage: 'moliya import <fayl.csv> [--cat=bank]',
      about: 'Bank/CSV ko‘chirmasini yuklash (ustunlar: sana;summa;izoh).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const file = a.at(0);
        if (!file) return { text: 'Fayl yo‘li kerak: moliya import ./koshirma.csv' };
        const { headers, rows } = readCsv(readFileSync(file, 'utf8'));
        const idx = (names: string[]): number =>
          headers.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
        const iDate = idx(['sana', 'date', 'дата']);
        const iAmount = idx(['summa', 'amount', 'сумма']);
        const iNote = idx(['izoh', 'note', 'назнач', 'description']);
        if (iDate < 0 || iAmount < 0) return { text: `Ustunlar topilmadi. Topilgani: ${headers.join(', ')}` };

        let n = 0;
        ctx.db.tx(() => {
          for (const r of rows) {
            const amount = parseAmount(r[iAmount] ?? '');
            if (!amount) continue;
            const when = parseWhen(r[iDate] ?? '', ctx.cfg.tz, ctx.now) ?? ctx.now;
            ctx.db.run(
              `INSERT INTO ledger(ts, kind, amount, currency, category, note, source) VALUES(?,?,?,?,?,?,?)`,
              when.toISOString(),
              amount > 0 ? 'income' : 'expense',
              Math.abs(amount),
              ctx.cfg.currency,
              a.str('cat', 'bank'),
              iNote >= 0 ? r[iNote] ?? null : null,
              'import',
            );
            n++;
          }
        });
        return { text: `📥 ${n} ta yozuv yuklandi (${file}).` };
      },
    },
  ],

  evening: (ctx) => {
    const from = startOfDay(ctx.now, ctx.cfg.tz).toISOString();
    const t = totals(ctx, from, ctx.now.toISOString());
    const lines = [
      `Kirim ${money(t.income, ctx.cfg.currency)} · Chiqim ${money(t.expense, ctx.cfg.currency)} · Sof ${money(t.net, ctx.cfg.currency)}`,
    ];
    if (t.waste > 0) lines.push(`Keraksiz xarajat: ${money(t.waste, ctx.cfg.currency)}`);
    const mtd = totals(ctx, startOfMonth(ctx.now, ctx.cfg.tz).toISOString(), ctx.now.toISOString());
    lines.push(`Oy boshidan: sof ${money(mtd.net, ctx.cfg.currency)}`);
    return { order: 50, title: `Moliya — ${dateKey(ctx.now, ctx.cfg.tz)}`, lines, alert: t.net < 0 };
  },
};
