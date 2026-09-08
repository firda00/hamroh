import type { Ctx, Module } from '../core/types.ts';
import { parseArgs, parseAmount } from '../core/args.ts';
import { dateKey, startOfDay, startOfMonth, stamp } from '../util/date.ts';
import { table, money, growth } from '../util/fmt.ts';
import { writeXlsx, writeCsv, readCsv } from '../util/office.ts';
import { enqueue } from './notify.ts';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

/** (8) Lidlar: yangi mijozlar, kunlik Excel/WPS hisoboti. */

export type Lead = {
  id: number;
  created_at: string;
  name: string;
  phone: string | null;
  source: string;
  status: string;
  note: string | null;
  owner: string | null;
  amount: number | null;
};

const SOURCES = ['instagram', 'google', '2gis', 'telegram', 'youtube', 'tavsiya', 'boshqa'];
const STATUSES = ['yangi', 'aloqada', 'sotildi', 'rad'];

export function leadsSince(ctx: Ctx, iso: string): Lead[] {
  return ctx.db.all<Lead>(`SELECT * FROM leads WHERE created_at >= ? ORDER BY created_at DESC`, iso);
}

export function exportLeads(ctx: Ctx, items: Lead[], label: string): string[] {
  const headers = ['ID', 'Sana', 'Ism', 'Telefon', 'Manba', 'Holat', 'Summa', 'Mas’ul', 'Izoh'];
  const rows = items.map((l) => [
    l.id,
    stamp(new Date(l.created_at), ctx.cfg.tz),
    l.name,
    l.phone ?? '',
    l.source,
    l.status,
    l.amount ?? 0,
    l.owner ?? '',
    l.note ?? '',
  ]);
  const xlsx = writeXlsx(join(ctx.cfg.outDir, `lidlar-${label}.xlsx`), [{ name: 'Lidlar', headers, rows }]);
  const csv = writeCsv(join(ctx.cfg.outDir, `lidlar-${label}.csv`), headers, rows);
  return [xlsx, csv];
}

export const leadsModule: Module = {
  id: 'lid',
  title: 'Lidlar',
  about: 'Yangi mijozlar, manbalar bo‘yicha tahlil, kunlik Excel hisoboti.',

  commands: [
    {
      name: 'add',
      usage: 'lid add "<ism>" [--phone=+998..] [--source=instagram] [--amount=..] [izoh]',
      about: `Yangi lid. Manbalar: ${SOURCES.join(', ')}`,
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const name = a.at(0);
        if (!name) return { text: 'Masalan: lid add "Aziz aka" --phone=+998901234567 --source=instagram' };
        const r = ctx.db.run(
          `INSERT INTO leads(created_at, name, phone, source, note, owner, amount) VALUES(?,?,?,?,?,?,?)`,
          ctx.now.toISOString(),
          name,
          a.str('phone') || null,
          a.str('source', 'boshqa'),
          a.rest(1) || null,
          a.str('owner') || null,
          parseAmount(a.str('amount', '0')) || null,
        );
        return { text: `🧲 #${r.lastInsertRowid} lid qo‘shildi: ${name} (${a.str('source', 'boshqa')})` };
      },
    },
    {
      name: 'status',
      usage: `lid status <id> <${STATUSES.join('|')}> [--amount=..]`,
      about: 'Lid holatini o‘zgartirish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        const status = a.at(1);
        if (!id || !STATUSES.includes(status)) return { text: `Masalan: lid status 4 sotildi --amount=2mln` };
        const amount = parseAmount(a.str('amount', '0'));
        const r = ctx.db.run(
          `UPDATE leads SET status=?, amount=COALESCE(?, amount) WHERE id=?`,
          status,
          amount || null,
          id,
        );
        if (r.changes && status === 'sotildi' && amount) {
          ctx.db.run(
            `INSERT INTO ledger(ts, kind, amount, currency, category, note, source) VALUES(?,?,?,?,?,?,?)`,
            ctx.now.toISOString(),
            'income',
            amount,
            ctx.cfg.currency,
            'savdo',
            `Lid #${id}`,
            'manual',
          );
        }
        return { text: r.changes ? `✅ #${id} → ${status}` : `#${id} topilmadi.` };
      },
    },
    {
      name: 'list',
      usage: 'lid list [--today] [--status=yangi] [--limit=30]',
      about: 'Lidlar ro‘yxati.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const items = a.has('today')
          ? leadsSince(ctx, startOfDay(ctx.now, ctx.cfg.tz).toISOString())
          : ctx.db.all<Lead>(`SELECT * FROM leads ORDER BY id DESC LIMIT ?`, a.num('limit', 30));
        const filtered = a.has('status') ? items.filter((l) => l.status === a.str('status')) : items;
        if (!filtered.length) return { text: 'Lid topilmadi.' };
        return {
          text: table(
            ['#', 'Sana', 'Ism', 'Telefon', 'Manba', 'Holat', 'Summa'],
            filtered.map((l) => [
              l.id,
              stamp(new Date(l.created_at), ctx.cfg.tz).slice(5),
              l.name,
              l.phone ?? '—',
              l.source,
              l.status,
              l.amount ? money(l.amount, ctx.cfg.currency) : '—',
            ]),
          ),
          data: filtered,
        };
      },
    },
    {
      name: 'export',
      usage: 'lid export [--today] [--month]',
      about: 'Excel (.xlsx) va CSV hisobot yaratish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const isMonth = a.has('month');
        const from = isMonth ? startOfMonth(ctx.now, ctx.cfg.tz) : startOfDay(ctx.now, ctx.cfg.tz);
        const label = isMonth ? dateKey(ctx.now, ctx.cfg.tz).slice(0, 7) : dateKey(ctx.now, ctx.cfg.tz);
        const items = leadsSince(ctx, from.toISOString());
        const files = exportLeads(ctx, items, label);
        return { text: [`📊 ${items.length} ta lid eksport qilindi:`, ...files.map((f) => `  ${f}`)].join('\n'), files };
      },
    },
    {
      name: 'import',
      usage: 'lid import <fayl.csv>',
      about: 'CSV dan lidlarni yuklash (ism;telefon;manba).',
      run: (ctx, argv) => {
        const file = parseArgs(argv).at(0);
        if (!file) return { text: 'Fayl kerak: lid import ./lidlar.csv' };
        const { headers, rows } = readCsv(readFileSync(file, 'utf8'));
        const idx = (names: string[]): number => headers.findIndex((h) => names.some((n) => h.toLowerCase().includes(n)));
        const iName = idx(['ism', 'name', 'имя']);
        const iPhone = idx(['tel', 'phone', 'телефон']);
        const iSrc = idx(['manba', 'source', 'источник']);
        if (iName < 0) return { text: `Ism ustuni topilmadi. Ustunlar: ${headers.join(', ')}` };
        let n = 0;
        ctx.db.tx(() => {
          for (const r of rows) {
            if (!r[iName]) continue;
            ctx.db.run(
              `INSERT INTO leads(created_at, name, phone, source) VALUES(?,?,?,?)`,
              ctx.now.toISOString(),
              r[iName],
              iPhone >= 0 ? r[iPhone] ?? null : null,
              iSrc >= 0 ? r[iSrc] ?? 'boshqa' : 'boshqa',
            );
            n++;
          }
        });
        return { text: `📥 ${n} ta lid yuklandi.` };
      },
    },
    {
      name: 'funnel',
      usage: 'lid funnel [--days=30]',
      about: 'Manbalar va konversiya tahlili.',
      run: (ctx, argv) => {
        const days = parseArgs(argv).num('days', 30);
        const from = new Date(ctx.now.getTime() - days * 86_400_000).toISOString();
        const rows = ctx.db.all<{ source: string; total: number; sold: number; revenue: number }>(
          `SELECT source, COUNT(*) total,
                  SUM(CASE WHEN status='sotildi' THEN 1 ELSE 0 END) sold,
                  SUM(CASE WHEN status='sotildi' THEN COALESCE(amount,0) ELSE 0 END) revenue
           FROM leads WHERE created_at >= ? GROUP BY source ORDER BY total DESC`,
          from,
        );
        if (!rows.length) return { text: `Oxirgi ${days} kunda lid yo‘q.` };
        return {
          text: table(
            ['Manba', 'Lid', 'Sotildi', 'Konversiya', 'Daromad'],
            rows.map((r) => [
              r.source,
              r.total,
              r.sold,
              `${((r.sold / r.total) * 100).toFixed(0)}%`,
              money(r.revenue, ctx.cfg.currency),
            ]),
          ),
          data: rows,
        };
      },
    },
  ],

  jobs: [
    {
      name: 'lid.kunlik-eksport',
      cron: '0 19 * * *',
      run: (ctx) => {
        const items = leadsSince(ctx, startOfDay(ctx.now, ctx.cfg.tz).toISOString());
        if (!items.length) return 'bugun lid yo‘q';
        const files = exportLeads(ctx, items, dateKey(ctx.now, ctx.cfg.tz));
        enqueue(ctx, {
          module: 'lid',
          title: `Bugungi lidlar: ${items.length} ta`,
          body: files.join('\n'),
          dedupeKey: `leads-export:${dateKey(ctx.now, ctx.cfg.tz)}`,
        });
        return `${items.length} ta lid eksport qilindi`;
      },
    },
  ],

  evening: (ctx) => {
    const today = leadsSince(ctx, startOfDay(ctx.now, ctx.cfg.tz).toISOString());
    const yesterday = ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM leads WHERE created_at >= ? AND created_at < ?`,
      new Date(startOfDay(ctx.now, ctx.cfg.tz).getTime() - 86_400_000).toISOString(),
      startOfDay(ctx.now, ctx.cfg.tz).toISOString(),
    );
    const g = growth(yesterday?.n ?? 0, today.length);
    return {
      order: 45,
      title: 'Lidlar',
      lines: [
        `Bugun: ${today.length} ta (kecha ${yesterday?.n ?? 0}) ${g.text}`,
        ...today.slice(0, 5).map((l) => `  · ${l.name} — ${l.source} — ${l.status}`),
      ],
      alert: today.length === 0,
    };
  },
};
