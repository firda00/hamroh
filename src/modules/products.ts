import type { Ctx, Module } from '../core/types.ts';
import { parseArgs, parseAmount } from '../core/args.ts';
import { monthKey, prevMonth, parts, daysInMonth, parseWhen } from '../util/date.ts';
import { money, table, bar, growth } from '../util/fmt.ts';
import { writeXlsx } from '../util/office.ts';
import { enqueue } from './notify.ts';
import { join } from 'node:path';

/** (14) Mahsulotlar va sotuvlar: eng ko'p sotilgan, foyda, oy oxiridagi fayl. */

export type Product = {
  id: number;
  sku: string | null;
  name: string;
  category: string;
  cost_price: number;
  sell_price: number;
  active: number;
};

export type ProductStat = {
  id: number;
  name: string;
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
};

const bounds = (period: string): [string, string] => [
  `${period}-01T00:00:00.000Z`,
  `${period}-${String(daysInMonth(period)).padStart(2, '0')}T23:59:59.999Z`,
];

export function stats(ctx: Ctx, period: string): ProductStat[] {
  const [from, to] = bounds(period);
  return ctx.db.all<ProductStat>(
    `SELECT p.id, p.name, p.category,
            SUM(s.qty) qty,
            SUM(s.qty * s.unit_price - s.discount) revenue,
            SUM(s.qty * p.cost_price) cost,
            SUM(s.qty * s.unit_price - s.discount - s.qty * p.cost_price) profit
     FROM sales s JOIN products p ON p.id = s.product_id
     WHERE s.ts BETWEEN ? AND ?
     GROUP BY p.id ORDER BY profit DESC`,
    from,
    to,
  );
}

export function exportMonth(ctx: Ctx, period: string): string {
  const rows = stats(ctx, period);
  const total = rows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, revenue: acc.revenue + r.revenue, profit: acc.profit + r.profit }),
    { qty: 0, revenue: 0, profit: 0 },
  );
  const sheet = {
    name: `Sotuv ${period}`,
    headers: ['Mahsulot', 'Toifa', 'Soni', 'Tushum', 'Tannarx', 'Foyda', 'Marja %'],
    rows: [
      ...rows.map((r) => [
        r.name,
        r.category,
        r.qty,
        Math.round(r.revenue),
        Math.round(r.cost),
        Math.round(r.profit),
        r.revenue ? Number(((r.profit / r.revenue) * 100).toFixed(1)) : 0,
      ]),
      ['JAMI', '', total.qty, Math.round(total.revenue), '', Math.round(total.profit), ''],
    ] as (string | number | null)[][],
  };
  return writeXlsx(join(ctx.cfg.outDir, `sotuv-${period}.xlsx`), [sheet]);
}

export const productsModule: Module = {
  id: 'mahsulot',
  title: 'Mahsulot va sotuv',
  about: 'Eng ko‘p sotilgan mahsulotlar, foyda hisobi, oy oxiridagi Excel hisobot.',

  commands: [
    {
      name: 'add',
      usage: 'mahsulot add "<nom>" --cost=<tannarx> --price=<narx> [--sku=A1] [--cat=umumiy]',
      about: 'Mahsulot qo‘shish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const name = a.at(0);
        if (!name) return { text: 'Masalan: mahsulot add "Kurs A" --cost=200000 --price=900000' };
        const r = ctx.db.run(
          `INSERT INTO products(sku, name, category, cost_price, sell_price) VALUES(?,?,?,?,?)`,
          a.str('sku') || null,
          name,
          a.str('cat', 'umumiy'),
          parseAmount(a.str('cost', '0')),
          parseAmount(a.str('price', '0')),
        );
        return { text: `📦 #${r.lastInsertRowid} ${name} qo‘shildi.` };
      },
    },
    {
      name: 'sell',
      usage: 'mahsulot sell <mahsulot-id> [--qty=1] [--price=..] [--discount=0] [--date=..] [--channel=ofis]',
      about: 'Sotuvni qayd qilish (kirim ham yoziladi).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        const p = ctx.db.get<Product>(`SELECT * FROM products WHERE id=?`, id);
        if (!p) return { text: `Mahsulot #${id} topilmadi. Ro‘yxat: mahsulot list` };
        const qty = a.num('qty', 1);
        const price = parseAmount(a.str('price', String(p.sell_price)));
        const discount = parseAmount(a.str('discount', '0'));
        const when = a.has('date') ? parseWhen(a.str('date'), ctx.cfg.tz, ctx.now) ?? ctx.now : ctx.now;
        const total = qty * price - discount;

        ctx.db.run(
          `INSERT INTO sales(ts, product_id, qty, unit_price, discount, channel) VALUES(?,?,?,?,?,?)`,
          when.toISOString(),
          id,
          qty,
          price,
          discount,
          a.str('channel', 'ofis'),
        );
        ctx.db.run(
          `INSERT INTO ledger(ts, kind, amount, currency, category, note, source) VALUES(?,?,?,?,?,?,?)`,
          when.toISOString(),
          'income',
          total,
          ctx.cfg.currency,
          'savdo',
          `${p.name} x${qty}`,
          'manual',
        );
        const profit = total - qty * p.cost_price;
        return { text: `💰 ${p.name} x${qty} = ${money(total, ctx.cfg.currency)} · foyda ${money(profit, ctx.cfg.currency)}` };
      },
    },
    {
      name: 'list',
      usage: 'mahsulot list',
      about: 'Mahsulotlar ro‘yxati.',
      run: (ctx) => {
        const items = ctx.db.all<Product>(`SELECT * FROM products WHERE active=1 ORDER BY id`);
        if (!items.length) return { text: 'Mahsulot yo‘q. Qo‘shish: mahsulot add "Nom" --cost=.. --price=..' };
        return {
          text: table(
            ['#', 'SKU', 'Nom', 'Toifa', 'Tannarx', 'Narx', 'Marja'],
            items.map((p) => [
              p.id,
              p.sku ?? '—',
              p.name,
              p.category,
              money(p.cost_price, ctx.cfg.currency),
              money(p.sell_price, ctx.cfg.currency),
              p.sell_price ? `${(((p.sell_price - p.cost_price) / p.sell_price) * 100).toFixed(0)}%` : '—',
            ]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'top',
      usage: 'mahsulot top [--period=2026-09]',
      about: 'Eng ko‘p sotilgan va eng foydali mahsulotlar.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const period = a.str('period', monthKey(ctx.now, ctx.cfg.tz));
        const rows = stats(ctx, period);
        if (!rows.length) return { text: `${period} davrida sotuv yo‘q.` };
        const maxQty = Math.max(...rows.map((r) => r.qty));
        const prev = stats(ctx, prevMonth(period));
        const prevProfit = prev.reduce((s, r) => s + r.profit, 0);
        const curProfit = rows.reduce((s, r) => s + r.profit, 0);

        return {
          text: [
            `Davr: ${period}`,
            '',
            table(
              ['Mahsulot', 'Soni', 'Tushum', 'Foyda', 'Marja'],
              rows.map((r) => [
                r.name,
                `${r.qty} ${bar(r.qty, maxQty, 10)}`,
                money(r.revenue, ctx.cfg.currency),
                money(r.profit, ctx.cfg.currency),
                r.revenue ? `${((r.profit / r.revenue) * 100).toFixed(0)}%` : '—',
              ]),
            ),
            '',
            `Jami foyda: ${money(curProfit, ctx.cfg.currency)} (o‘tgan oy ${money(prevProfit, ctx.cfg.currency)}) ${growth(prevProfit, curProfit).text}`,
          ].join('\n'),
          data: rows,
        };
      },
    },
    {
      name: 'export',
      usage: 'mahsulot export [--period=2026-09]',
      about: 'Oylik sotuv hisobotini Excel fayl qilib saqlash.',
      run: (ctx, argv) => {
        const period = parseArgs(argv).str('period', monthKey(ctx.now, ctx.cfg.tz));
        const file = exportMonth(ctx, period);
        return { text: `📊 ${period} hisoboti: ${file}`, files: [file] };
      },
    },
  ],

  jobs: [
    {
      name: 'mahsulot.oy-oxiri',
      cron: '0 18 28-31 * *',
      run: (ctx) => {
        const period = monthKey(ctx.now, ctx.cfg.tz);
        const day = parts(ctx.now, ctx.cfg.tz).d;
        // Faqat oyning haqiqiy oxirgi kunida (yoki 30-kunida) ishlaydi.
        const last = daysInMonth(period);
        if (day !== Math.min(30, last)) return 'oy oxiri emas';
        const file = exportMonth(ctx, period);
        const rows = stats(ctx, period);
        enqueue(ctx, {
          module: 'mahsulot',
          title: `${period} oylik sotuv hisoboti tayyor`,
          body: [
            `Mahsulotlar: ${rows.length} ta`,
            `Jami foyda: ${money(rows.reduce((s, r) => s + r.profit, 0), ctx.cfg.currency)}`,
            file,
          ].join('\n'),
          dedupeKey: `product-month:${period}`,
        });
        return `hisobot: ${file}`;
      },
    },
  ],
};
