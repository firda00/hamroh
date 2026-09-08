import type { Ctx, Job, Module } from './types.ts';
import { parts } from '../util/date.ts';
import { logger } from './logger.ts';

const log = logger('scheduler');

/** cron maydonini tekshiradi: "*", "*\/5", "1,15", "9-18", "7". */
export function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    if (part === '*') return true;
    const step = part.match(/^(\*|\d+-\d+)\/(\d+)$/);
    if (step) {
      const n = Number(step[2]);
      if (!n) return false;
      if (step[1] === '*') return value % n === 0;
      const [a, b] = (step[1] ?? '').split('-').map(Number);
      return value >= (a ?? 0) && value <= (b ?? 0) && (value - (a ?? 0)) % n === 0;
    }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return Number(part) === value;
  });
}

/** "min soat kun oy hafta" — foydalanuvchi vaqt zonasida tekshiriladi. */
export function cronMatches(expr: string, now: Date, tz: string): boolean {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const p = parts(now, tz);
  const weekday = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return (
    fieldMatches(f[0] ?? '*', p.M) &&
    fieldMatches(f[1] ?? '*', p.H) &&
    fieldMatches(f[2] ?? '*', p.d) &&
    fieldMatches(f[3] ?? '*', p.m) &&
    fieldMatches(f[4] ?? '*', weekday)
  );
}

export function allJobs(modules: Module[]): { module: string; job: Job }[] {
  return modules.flatMap((m) => (m.jobs ?? []).map((job) => ({ module: m.id, job })));
}

const slotOf = (now: Date, tz: string): string => {
  const p = parts(now, tz);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.H)}:${pad(p.M)}`;
};

/**
 * Bir "tik": mos keladigan joblarni ishga tushiradi.
 * job_runs jadvali tufayli bitta slot ikki marta bajarilmaydi.
 */
export async function tick(ctx: Ctx, modules: Module[]): Promise<{ ran: string[]; skipped: number }> {
  const slot = slotOf(ctx.now, ctx.cfg.tz);
  const ran: string[] = [];
  let skipped = 0;

  for (const { job } of allJobs(modules)) {
    if (!cronMatches(job.cron, ctx.now, ctx.cfg.tz)) continue;
    const claim = ctx.db.run(
      `INSERT OR IGNORE INTO job_runs(job, slot, ran_at) VALUES(?,?,?)`,
      job.name,
      slot,
      ctx.now.toISOString(),
    );
    if (!claim.changes) {
      skipped++;
      continue;
    }
    try {
      const msg = await job.run(ctx);
      ctx.db.run(`UPDATE job_runs SET ok=1, message=? WHERE job=? AND slot=?`, msg, job.name, slot);
      log.info(`${job.name}: ${msg}`);
      ran.push(`${job.name}: ${msg}`);
    } catch (e) {
      const msg = (e as Error).message;
      ctx.db.run(`UPDATE job_runs SET ok=0, message=? WHERE job=? AND slot=?`, msg, job.name, slot);
      log.error(`${job.name} xato: ${msg}`);
      ran.push(`${job.name}: XATO — ${msg}`);
    }
  }
  return { ran, skipped };
}
