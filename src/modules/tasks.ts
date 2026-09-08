import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { parseWhen, stamp, startOfDay, endOfDay, humanUntil, addDays } from '../util/date.ts';
import { table, truncate } from '../util/fmt.ts';
import { enqueue } from './notify.ts';

/** (3) Kunlik vazifalar, eslatmalar, ketma-ket reja. */

export type Task = {
  id: number;
  title: string;
  notes: string | null;
  due_at: string | null;
  priority: number;
  status: string;
  category: string;
  est_minutes: number | null;
  created_at: string;
  completed_at: string | null;
};

const P = ['', '🔴 1', '🟠 2', '🟡 3', '🔵 4', '⚪ 5'];

export function openTasks(ctx: Ctx, from?: Date, to?: Date): Task[] {
  if (from && to) {
    return ctx.db.all<Task>(
      `SELECT * FROM tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at BETWEEN ? AND ?
       ORDER BY due_at ASC, priority ASC`,
      from.toISOString(),
      to.toISOString(),
    );
  }
  return ctx.db.all<Task>(
    `SELECT * FROM tasks WHERE status = 'open' ORDER BY priority ASC, COALESCE(due_at, '9999') ASC`,
  );
}

export function overdue(ctx: Ctx): Task[] {
  return ctx.db.all<Task>(
    `SELECT * FROM tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at < ?
     ORDER BY due_at ASC`,
    ctx.now.toISOString(),
  );
}

const row = (ctx: Ctx, t: Task): (string | number)[] => [
  t.id,
  P[t.priority] ?? t.priority,
  truncate(t.title, 42),
  t.due_at ? stamp(new Date(t.due_at), ctx.cfg.tz) : '—',
  t.category,
];

export const tasksModule: Module = {
  id: 'vazifa',
  title: 'Vazifalar va eslatmalar',
  about: 'Kunlik ishlar, muddatlar, ketma-ket reja va ogohlantirishlar.',

  commands: [
    {
      name: 'add',
      usage: 'vazifa add "<sarlavha>" [--due="ertaga 10:00"] [--priority=1..5] [--cat=ish] [--est=45] [--notes=".."]',
      about: 'Yangi vazifa qo‘shish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.rest(0).trim();
        if (!title) return { text: 'Sarlavha kerak. Masalan: vazifa add "Bankka borish" --due="ertaga 10:00"' };
        const dueRaw = a.str('due');
        const due = dueRaw ? parseWhen(dueRaw, ctx.cfg.tz, ctx.now) : null;
        if (dueRaw && !due) return { text: `Vaqtni tushunmadim: "${dueRaw}". Masalan: --due="ertaga 10:00"` };

        const r = ctx.db.run(
          `INSERT INTO tasks(title, notes, due_at, priority, category, est_minutes, created_at)
           VALUES(?,?,?,?,?,?,?)`,
          title,
          a.str('notes') || null,
          due ? due.toISOString() : null,
          Math.min(5, Math.max(1, a.num('priority', 3))),
          a.str('cat', 'ish'),
          a.num('est', 0) || null,
          ctx.now.toISOString(),
        );
        const when = due ? ` — ${stamp(due, ctx.cfg.tz)} (${humanUntil(due, ctx.now)})` : '';
        return { text: `✅ #${r.lastInsertRowid} qo‘shildi: ${title}${when}`, data: { id: r.lastInsertRowid } };
      },
    },
    {
      name: 'list',
      usage: 'vazifa list [--today] [--week] [--all]',
      about: 'Ochiq vazifalar ro‘yxati.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        let items: Task[];
        if (a.has('today')) items = openTasks(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
        else if (a.has('week')) items = openTasks(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(addDays(ctx.now, 7), ctx.cfg.tz));
        else items = openTasks(ctx);

        if (!items.length) return { text: 'Ochiq vazifa yo‘q. 👌' };
        return {
          text: table(['#', 'Muhim', 'Vazifa', 'Muddat', 'Toifa'], items.map((t) => row(ctx, t))),
          data: items,
        };
      },
    },
    {
      name: 'plan',
      usage: 'vazifa plan',
      about: 'Bugungi ishlarni ketma-ketlikda, vaqtini ko‘rsatib beradi.',
      run: (ctx) => {
        const today = openTasks(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
        const floating = openTasks(ctx).filter((t) => !t.due_at);
        const late = overdue(ctx);

        const lines: string[] = [];
        if (late.length) {
          lines.push('⚠️  Kechikkan ishlar — avval shular:');
          late.forEach((t, i) => lines.push(`  ${i + 1}. #${t.id} ${t.title} (${humanUntil(new Date(t.due_at ?? ''), ctx.now)})`));
          lines.push('');
        }
        lines.push('Bugungi tartib:');
        if (!today.length) lines.push('  (muddatli ish yo‘q)');
        today.forEach((t, i) => {
          const at = stamp(new Date(t.due_at ?? ''), ctx.cfg.tz).slice(11);
          const est = t.est_minutes ? ` · ~${t.est_minutes} daq` : '';
          lines.push(`  ${i + 1}. ${at}  #${t.id} ${t.title}${est}`);
        });
        if (floating.length) {
          lines.push('', 'Vaqti belgilanmagan (bo‘sh payt uchun):');
          floating.slice(0, 5).forEach((t) => lines.push(`  · #${t.id} ${t.title}`));
        }
        return { text: lines.join('\n'), data: { today, floating, late } };
      },
    },
    {
      name: 'done',
      usage: 'vazifa done <id>',
      about: 'Vazifani bajarildi deb belgilash.',
      run: (ctx, argv) => {
        const id = Number(parseArgs(argv).at(0));
        if (!id) return { text: 'ID kerak: vazifa done 12' };
        const r = ctx.db.run(
          `UPDATE tasks SET status='done', completed_at=? WHERE id=? AND status='open'`,
          ctx.now.toISOString(),
          id,
        );
        return { text: r.changes ? `✅ #${id} bajarildi.` : `#${id} topilmadi yoki allaqachon yopilgan.` };
      },
    },
    {
      name: 'rm',
      usage: 'vazifa rm <id>',
      about: 'Vazifani bekor qilish.',
      run: (ctx, argv) => {
        const id = Number(parseArgs(argv).at(0));
        const r = ctx.db.run(`UPDATE tasks SET status='canceled' WHERE id=?`, id);
        return { text: r.changes ? `🗑 #${id} bekor qilindi.` : `#${id} topilmadi.` };
      },
    },
  ],

  jobs: [
    {
      name: 'vazifa.reminder',
      cron: '*/15 * * * *',
      run: (ctx) => {
        const soon = new Date(ctx.now.getTime() + 30 * 60_000);
        const due = ctx.db.all<Task>(
          `SELECT * FROM tasks WHERE status='open' AND due_at BETWEEN ? AND ?`,
          ctx.now.toISOString(),
          soon.toISOString(),
        );
        for (const t of due) {
          enqueue(ctx, {
            module: 'vazifa',
            title: `Eslatma: ${t.title}`,
            body: `${stamp(new Date(t.due_at ?? ''), ctx.cfg.tz)} — ${humanUntil(new Date(t.due_at ?? ''), ctx.now)}`,
            dedupeKey: `task:${t.id}:${t.due_at}`,
          });
        }
        return `${due.length} ta eslatma navbatga qo‘yildi`;
      },
    },
  ],

  morning: (ctx) => {
    const today = openTasks(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
    const late = overdue(ctx);
    const lines: string[] = [];
    const lateIds = new Set(late.map((t) => t.id));
    late.forEach((t) => lines.push(`⚠️  KECHIKKAN: #${t.id} ${t.title}`));
    today
      .filter((t) => !lateIds.has(t.id))
      .forEach((t) => lines.push(`${stamp(new Date(t.due_at ?? ''), ctx.cfg.tz).slice(11)}  #${t.id} ${t.title}`));
    if (!lines.length) lines.push('Bugunga muddatli ish yo‘q.');
    return { order: 30, title: `Bugungi vazifalar (${today.length})`, lines, alert: late.length > 0 };
  },

  evening: (ctx) => {
    const from = startOfDay(ctx.now, ctx.cfg.tz).toISOString();
    const doneToday = ctx.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM tasks WHERE status='done' AND completed_at >= ?`,
      from,
    );
    const left = openTasks(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
    const lines = [`Bajarildi: ${doneToday?.n ?? 0} ta`, `Qoldi: ${left.length} ta`];
    left.slice(0, 5).forEach((t) => lines.push(`  · #${t.id} ${t.title}`));
    return { order: 30, title: 'Vazifalar yakuni', lines, alert: left.length > 0 };
  },
};
