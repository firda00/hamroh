import type { BriefSection, Ctx, Module } from './types.ts';
import { dateKey, stamp, weekdayUz } from '../util/date.ts';
import { logger } from './logger.ts';

const log = logger('brief');

export type BriefKind = 'morning' | 'evening';

/** Har bir moduldan bo'lim yig'adi; bittasi yiqilsa qolganlari baribir chiqadi. */
export async function collect(ctx: Ctx, modules: Module[], kind: BriefKind): Promise<BriefSection[]> {
  const out: BriefSection[] = [];
  for (const m of modules) {
    const fn = kind === 'morning' ? m.morning : m.evening;
    if (!fn) continue;
    try {
      const section = await fn(ctx);
      if (section) out.push(section);
    } catch (e) {
      log.warn(`${m.id}: ${(e as Error).message}`);
      out.push({ order: 999, title: `${m.title} (xato)`, lines: [(e as Error).message], alert: true });
    }
  }
  return out.sort((a, b) => a.order - b.order);
}

export function render(ctx: Ctx, kind: BriefKind, sections: BriefSection[]): string {
  const head =
    kind === 'morning'
      ? `☀️  XAYRLI TONG — ${dateKey(ctx.now, ctx.cfg.tz)}, ${weekdayUz(ctx.now, ctx.cfg.tz)}`
      : `🌙  KUN YAKUNI — ${dateKey(ctx.now, ctx.cfg.tz)}, ${weekdayUz(ctx.now, ctx.cfg.tz)}`;

  const body = sections.map((s) => {
    const mark = s.alert ? '❗' : '·';
    return [`${mark} ${s.title.toUpperCase()}`, ...s.lines.map((l) => `   ${l}`)].join('\n');
  });

  const alerts = sections.filter((s) => s.alert).length;
  const foot = alerts ? `\n❗ Diqqat talab qiladi: ${alerts} ta bo‘lim.` : '\n✅ Diqqat talab qiladigan holat yo‘q.';

  return [head, '═'.repeat(Math.min(64, head.length + 4)), '', ...body, foot, `\n${stamp(ctx.now, ctx.cfg.tz)} · ${ctx.llm.smart ? 'LLM yoqilgan' : 'LLM ulanmagan (qoidaviy rejim)'}`].join('\n');
}

/** Brifingni yig'adi, matn qaytaradi va suratini bazaga saqlaydi. */
export async function buildBrief(ctx: Ctx, modules: Module[], kind: BriefKind): Promise<{ text: string; sections: BriefSection[] }> {
  const sections = await collect(ctx, modules, kind);
  const text = render(ctx, kind, sections);
  ctx.db.run(
    `INSERT INTO daily_reports(date, kind, payload, created_at) VALUES(?,?,?,?)
     ON CONFLICT(date, kind) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
    dateKey(ctx.now, ctx.cfg.tz),
    kind,
    JSON.stringify(sections),
    ctx.now.toISOString(),
  );
  return { text, sections };
}
