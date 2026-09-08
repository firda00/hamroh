import type { Ctx, Module } from '../core/types.ts';
import { parseArgs, parseAmount } from '../core/args.ts';
import { monthKey, prevMonth, parts, parseWhen, stamp } from '../util/date.ts';
import { money, table } from '../util/fmt.ts';
import { enqueue } from './notify.ts';
import { totals } from './finance.ts';

/** (6) Shaxsiy buxgalter: hisobotlar, muddatlar, har oyning 10-kunidagi eslatma. */

export type AcctReport = {
  id: number;
  period: string;
  kind: string;
  status: string;
  due_at: string | null;
  received_at: string | null;
  file_path: string | null;
  amount: number | null;
  notes: string | null;
};

const KINDS = ['soliq', 'qqs', 'oylik', 'ijtimoiy', 'boshqa'];

export function openReports(ctx: Ctx): AcctReport[] {
  return ctx.db.all<AcctReport>(
    `SELECT * FROM acct_reports WHERE status <> 'topshirildi' ORDER BY COALESCE(due_at, '9999') ASC`,
  );
}

export const accountingModule: Module = {
  id: 'buxgalter',
  title: 'Buxgalteriya',
  about: 'Hisobotlar, muddatlar, tahlil va har oyning 10-kunidagi eslatma.',

  commands: [
    {
      name: 'add',
      usage: 'buxgalter add <tur> [--period=2026-08] [--due="2026-09-10"] [--amount=..] [izoh]',
      about: `Hisobot qo‘shish. Turlar: ${KINDS.join(', ')}`,
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const kind = a.at(0) || 'boshqa';
        const period = a.str('period', prevMonth(monthKey(ctx.now, ctx.cfg.tz)));
        const dueRaw = a.str('due');
        const due = dueRaw ? parseWhen(dueRaw, ctx.cfg.tz, ctx.now) : null;
        const r = ctx.db.run(
          `INSERT INTO acct_reports(period, kind, due_at, amount, notes) VALUES(?,?,?,?,?)`,
          period,
          kind,
          due ? due.toISOString() : null,
          a.num('amount', 0) || null,
          a.rest(1) || null,
        );
        return { text: `🧾 #${r.lastInsertRowid} ${kind} (${period})${due ? ` — muddat ${stamp(due, ctx.cfg.tz)}` : ''}` };
      },
    },
    {
      name: 'received',
      usage: 'buxgalter received <id> [--file=./hisobot.xlsx] [--amount=..]',
      about: 'Kelgan hisobotni qayd qilish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        const r = ctx.db.run(
          `UPDATE acct_reports SET status='qabul', received_at=?, file_path=COALESCE(?, file_path), amount=COALESCE(?, amount) WHERE id=?`,
          ctx.now.toISOString(),
          a.str('file') || null,
          a.num('amount', 0) || null,
          id,
        );
        if (!r.changes) return { text: `#${id} topilmadi.` };
        enqueue(ctx, {
          module: 'buxgalter',
          title: `Hisobot keldi — #${id}`,
          body: 'Tekshirib, topshirilganini belgilang: buxgalter done ' + id,
          dedupeKey: `acct-received:${id}`,
        });
        return { text: `📥 #${id} qabul qilindi va tekshirishga qo‘yildi.` };
      },
    },
    {
      name: 'done',
      usage: 'buxgalter done <id>',
      about: 'Hisobot topshirildi.',
      run: (ctx, argv) => {
        const id = Number(parseArgs(argv).at(0));
        const r = ctx.db.run(`UPDATE acct_reports SET status='topshirildi' WHERE id=?`, id);
        return { text: r.changes ? `✅ #${id} topshirildi.` : `#${id} topilmadi.` };
      },
    },
    {
      name: 'list',
      usage: 'buxgalter list [--all]',
      about: 'Hisobotlar holati.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const items = a.has('all')
          ? ctx.db.all<AcctReport>(`SELECT * FROM acct_reports ORDER BY period DESC, id DESC`)
          : openReports(ctx);
        if (!items.length) return { text: 'Ochiq hisobot yo‘q.' };
        return {
          text: table(
            ['#', 'Davr', 'Tur', 'Holat', 'Muddat', 'Summa'],
            items.map((r) => [
              r.id,
              r.period,
              r.kind,
              r.status,
              r.due_at ? stamp(new Date(r.due_at), ctx.cfg.tz).slice(0, 10) : '—',
              r.amount ? money(r.amount, ctx.cfg.currency) : '—',
            ]),
          ),
          data: items,
        };
      },
    },
    {
      name: 'analyze',
      usage: 'buxgalter analyze [--period=2026-08]',
      about: 'Davr bo‘yicha moliyaviy tahlil va buxgalteriya izohi.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const period = a.str('period', prevMonth(monthKey(ctx.now, ctx.cfg.tz)));
        const t = totals(ctx, `${period}-01T00:00:00.000Z`, `${period}-31T23:59:59.999Z`);
        const reports = ctx.db.all<AcctReport>(`SELECT * FROM acct_reports WHERE period=?`, period);
        const facts = [
          `Davr: ${period}`,
          `Kirim: ${money(t.income, ctx.cfg.currency)}`,
          `Chiqim: ${money(t.expense, ctx.cfg.currency)}`,
          `Sof natija: ${money(t.net, ctx.cfg.currency)}`,
          `Hisobotlar: ${reports.length} ta, topshirilgan ${reports.filter((r) => r.status === 'topshirildi').length} ta`,
        ];
        if (t.net < 0) facts.push('Davr zarar bilan yakunlangan — xarajat tuzilmasini ko‘rib chiqish kerak.');
        const res = await ctx.llm.run({
          kind: 'advise',
          topic: `Buxgalteriya tahlili ${period}`,
          facts,
          question: 'Buxgalteriya nuqtai nazaridan qanday xatolar bo‘lishi mumkin va nima qilish kerak?',
        });
        return { text: res.text, data: { period, totals: t, reports } };
      },
    },
  ],

  jobs: [
    {
      name: 'buxgalter.10-kun',
      cron: '0 10 10 * *',
      run: (ctx) => {
        const period = prevMonth(monthKey(ctx.now, ctx.cfg.tz));
        enqueue(ctx, {
          module: 'buxgalter',
          title: `Bugun 10-kun — ${period} hisobotini tayyorlash vaqti`,
          body: [
            `${period} davri uchun hisobotlarni tayyorlang.`,
            `Ochiq hisobotlar: ${openReports(ctx).length} ta.`,
            'Ko‘rish:  hamroh buxgalter list',
          ].join('\n'),
          dedupeKey: `acct-10th:${period}`,
        });
        return `10-kun eslatmasi (${period})`;
      },
    },
  ],

  morning: (ctx) => {
    const items = openReports(ctx);
    const day = parts(ctx.now, ctx.cfg.tz).d;
    if (!items.length && day !== 10) return null;
    const lines = items.map(
      (r) => `${r.kind} (${r.period}) — ${r.status}${r.due_at ? ` · muddat ${stamp(new Date(r.due_at), ctx.cfg.tz).slice(0, 10)}` : ''}`,
    );
    if (day === 10) lines.unshift('❗ Bugun 10-kun — oylik hisobotni tayyorlash kerak.');
    return { order: 65, title: 'Buxgalteriya', lines: lines.length ? lines : ['Ochiq hisobot yo‘q.'], alert: day === 10 };
  },
};
