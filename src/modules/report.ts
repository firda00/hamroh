import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { dateKey, startOfDay, addDays, monthKey } from '../util/date.ts';
import { money, table, growth, compact } from '../util/fmt.ts';
import { writeReport } from '../report/html.ts';
import type { Block } from '../report/html.ts';
import { buildBrief } from '../core/brief.ts';
import { join } from 'node:path';

/** (5) Kunlik ish hisoboti: o'sish darajasi, kamchiliklar, tavsiyalar. */

export type Kpi = { key: string; label: string; today: number; prev: number; unit: 'pul' | 'dona' };

export function dayKpis(ctx: Ctx, day: Date): Kpi[] {
  const from = startOfDay(day, ctx.cfg.tz).toISOString();
  const to = new Date(startOfDay(day, ctx.cfg.tz).getTime() + 86_399_999).toISOString();
  const pFrom = startOfDay(addDays(day, -1), ctx.cfg.tz).toISOString();
  const pTo = new Date(startOfDay(addDays(day, -1), ctx.cfg.tz).getTime() + 86_399_999).toISOString();

  const num = (sql: string, ...p: unknown[]): number =>
    ctx.db.get<{ v: number | null }>(sql, ...p)?.v ?? 0;

  const pair = (sql: string): [number, number] => [num(sql, from, to), num(sql, pFrom, pTo)];

  const [incT, incP] = pair(`SELECT SUM(amount) v FROM ledger WHERE kind='income' AND ts BETWEEN ? AND ?`);
  const [expT, expP] = pair(`SELECT SUM(amount) v FROM ledger WHERE kind='expense' AND ts BETWEEN ? AND ?`);
  const [leadT, leadP] = pair(`SELECT COUNT(*) v FROM leads WHERE created_at BETWEEN ? AND ?`);
  const [soldT, soldP] = pair(`SELECT COUNT(*) v FROM leads WHERE status='sotildi' AND created_at BETWEEN ? AND ?`);
  const [taskT, taskP] = pair(`SELECT COUNT(*) v FROM tasks WHERE status='done' AND completed_at BETWEEN ? AND ?`);
  const [profT, profP] = pair(
    `SELECT SUM(s.qty * s.unit_price - s.discount - s.qty * p.cost_price) v
     FROM sales s JOIN products p ON p.id = s.product_id WHERE s.ts BETWEEN ? AND ?`,
  );

  return [
    { key: 'income', label: 'Kirim', today: incT, prev: incP, unit: 'pul' },
    { key: 'expense', label: 'Chiqim', today: expT, prev: expP, unit: 'pul' },
    { key: 'net', label: 'Sof natija', today: incT - expT, prev: incP - expP, unit: 'pul' },
    { key: 'profit', label: 'Sotuv foydasi', today: profT, prev: profP, unit: 'pul' },
    { key: 'leads', label: 'Lidlar', today: leadT, prev: leadP, unit: 'dona' },
    { key: 'sold', label: 'Sotuvlar', today: soldT, prev: soldP, unit: 'dona' },
    { key: 'tasks', label: 'Bajarilgan vazifa', today: taskT, prev: taskP, unit: 'dona' },
  ];
}

/** Kamchiliklar — raqamlar asosida, o'ylab topilmagan. */
export function weakSpots(ctx: Ctx, kpis: Kpi[]): string[] {
  const out: string[] = [];
  const get = (k: string): Kpi | undefined => kpis.find((x) => x.key === k);

  const net = get('net');
  if (net && net.today < 0) out.push(`Kun zarar bilan yakunlandi: ${money(net.today, ctx.cfg.currency)}.`);

  const leads = get('leads');
  if (leads && leads.today === 0) out.push('Bugun bironta ham yangi lid yo‘q — marketing kanallarini tekshiring.');
  else if (leads && leads.prev > 0 && leads.today < leads.prev * 0.5) out.push('Lidlar oqimi ikki barobardan ko‘p kamaydi.');

  const tasks = get('tasks');
  if (tasks && tasks.today === 0) out.push('Bugun bironta vazifa yopilmadi.');

  const overdue = ctx.db.get<{ n: number }>(
    `SELECT COUNT(*) n FROM tasks WHERE status='open' AND due_at < ?`,
    ctx.now.toISOString(),
  );
  if (overdue?.n) out.push(`Muddati o‘tgan vazifalar: ${overdue.n} ta.`);

  const missed = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM calls WHERE callback_needed=1`);
  if (missed?.n) out.push(`Javobsiz qo‘ng‘iroqlar: ${missed.n} ta — qayta aloqa kerak.`);

  if (!out.length) out.push('Jiddiy kamchilik topilmadi.');
  return out;
}

const fmt = (k: Kpi, ctx: Ctx): string => (k.unit === 'pul' ? money(k.today, ctx.cfg.currency) : `${k.today} ta`);

export const reportModule: Module = {
  id: 'hisobot',
  title: 'Hisobotlar',
  about: 'Kunlik/haftalik ish hisoboti, o‘sish darajasi, kamchiliklar.',

  commands: [
    {
      name: 'tong',
      usage: 'hisobot tong',
      about: 'Ertalabki brifing (barcha modullardan).',
      run: async (ctx) => {
        const { modules } = await import('./index.ts');
        const { text } = await buildBrief(ctx, modules, 'morning');
        return { text };
      },
    },
    {
      name: 'kun',
      usage: 'hisobot kun [--html]',
      about: 'Kun yakuni: brifing + o‘sish darajasi + kamchiliklar.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const { modules } = await import('./index.ts');
        const { text } = await buildBrief(ctx, modules, 'evening');
        const kpis = dayKpis(ctx, ctx.now);
        const weak = weakSpots(ctx, kpis);

        const kpiTable = table(
          ['Ko‘rsatkich', 'Bugun', 'Kecha', 'O‘sish'],
          kpis.map((k) => [
            k.label,
            fmt(k, ctx),
            k.unit === 'pul' ? money(k.prev, ctx.cfg.currency) : `${k.prev} ta`,
            growth(k.prev, k.today).text,
          ]),
        );

        const full = [text, '', '📊 O‘SISH DARAJASI', kpiTable, '', '🔍 KAMCHILIKLAR', ...weak.map((w) => `   • ${w}`)].join('\n');

        const files: string[] = [];
        if (a.has('html')) {
          const blocks: Block[] = [
            {
              type: 'kpis',
              items: kpis.map((k) => {
                const g = growth(k.prev, k.today);
                return { label: k.label, value: k.unit === 'pul' ? compact(k.today) : String(k.today), delta: g.text, up: g.up };
              }),
            },
            {
              type: 'line',
              title: 'Oxirgi 14 kun — sof natija',
              points: Array.from({ length: 14 }, (_, i) => {
                const d = addDays(ctx.now, -13 + i);
                const k = dayKpis(ctx, d).find((x) => x.key === 'net');
                return { label: dateKey(d, ctx.cfg.tz).slice(5), value: k?.today ?? 0 };
              }),
            },
            {
              type: 'table',
              title: 'Kunlik ko‘rsatkichlar',
              headers: ['Ko‘rsatkich', 'Bugun', 'Kecha', 'O‘sish'],
              rows: kpis.map((k) => [
                k.label,
                k.unit === 'pul' ? compact(k.today) : k.today,
                k.unit === 'pul' ? compact(k.prev) : k.prev,
                growth(k.prev, k.today).text,
              ]),
            },
            { type: 'text', title: 'Kamchiliklar va e’tibor', body: weak },
          ];
          files.push(
            writeReport(join(ctx.cfg.outDir, `hisobot-${dateKey(ctx.now, ctx.cfg.tz)}.html`), {
              title: 'Kunlik hisobot',
              subtitle: dateKey(ctx.now, ctx.cfg.tz),
              blocks,
            }),
          );
        }

        return { text: files.length ? `${full}\n\n📄 ${files[0]}` : full, data: { kpis, weak }, files };
      },
    },
    {
      name: 'hafta',
      usage: 'hisobot hafta',
      about: 'Haftalik yig‘ma ko‘rsatkichlar.',
      run: (ctx) => {
        const rows = Array.from({ length: 7 }, (_, i) => {
          const d = addDays(ctx.now, -6 + i);
          const k = dayKpis(ctx, d);
          const pick = (key: string): number => k.find((x) => x.key === key)?.today ?? 0;
          return [dateKey(d, ctx.cfg.tz).slice(5), compact(pick('income')), compact(pick('expense')), pick('leads'), pick('tasks')];
        });
        const totals = rows.reduce((s, r) => s + Number(r[3]), 0);
        return {
          text: [
            table(['Sana', 'Kirim', 'Chiqim', 'Lid', 'Vazifa'], rows),
            '',
            `Hafta bo‘yicha lidlar: ${totals} ta`,
          ].join('\n'),
          data: rows,
        };
      },
    },
    {
      name: 'oy',
      usage: 'hisobot oy [--period=2026-09]',
      about: 'Oylik yig‘ma hisobot.',
      run: (ctx, argv) => {
        const period = parseArgs(argv).str('period', monthKey(ctx.now, ctx.cfg.tz));
        const from = `${period}-01T00:00:00.000Z`;
        const to = `${period}-31T23:59:59.999Z`;
        const num = (sql: string): number => ctx.db.get<{ v: number | null }>(sql, from, to)?.v ?? 0;
        const income = num(`SELECT SUM(amount) v FROM ledger WHERE kind='income' AND ts BETWEEN ? AND ?`);
        const expense = num(`SELECT SUM(amount) v FROM ledger WHERE kind='expense' AND ts BETWEEN ? AND ?`);
        const leads = num(`SELECT COUNT(*) v FROM leads WHERE created_at BETWEEN ? AND ?`);
        const sold = num(`SELECT COUNT(*) v FROM leads WHERE status='sotildi' AND created_at BETWEEN ? AND ?`);
        return {
          text: [
            `Davr: ${period}`,
            `Kirim:  ${money(income, ctx.cfg.currency)}`,
            `Chiqim: ${money(expense, ctx.cfg.currency)}`,
            `Sof:    ${money(income - expense, ctx.cfg.currency)}`,
            `Lidlar: ${leads} ta (sotildi ${sold} ta, konversiya ${leads ? ((sold / leads) * 100).toFixed(0) : 0}%)`,
          ].join('\n'),
          data: { period, income, expense, leads, sold },
        };
      },
    },
  ],

  jobs: [
    {
      name: 'hisobot.kun-yakuni',
      cron: '0 20 * * *',
      run: async (ctx) => {
        const { modules } = await import('./index.ts');
        const { enqueue } = await import('./notify.ts');
        const { text } = await buildBrief(ctx, modules, 'evening');
        const kpis = dayKpis(ctx, ctx.now);
        const weak = weakSpots(ctx, kpis);
        enqueue(ctx, {
          module: 'hisobot',
          title: `Kun yakuni — ${dateKey(ctx.now, ctx.cfg.tz)}`,
          body: [text, '', 'Kamchiliklar:', ...weak.map((w) => `• ${w}`)].join('\n'),
          dedupeKey: `evening:${dateKey(ctx.now, ctx.cfg.tz)}`,
        });
        return 'kun yakuni tayyor';
      },
    },
    {
      name: 'hisobot.tong',
      cron: '0 8 * * *',
      run: async (ctx) => {
        const { modules } = await import('./index.ts');
        const { enqueue } = await import('./notify.ts');
        const { text } = await buildBrief(ctx, modules, 'morning');
        enqueue(ctx, {
          module: 'hisobot',
          title: `Ertalabki brifing — ${dateKey(ctx.now, ctx.cfg.tz)}`,
          body: text,
          dedupeKey: `morning:${dateKey(ctx.now, ctx.cfg.tz)}`,
        });
        return 'brifing tayyor';
      },
    },
  ],
};
