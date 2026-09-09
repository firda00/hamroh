import type { Ctx } from '../../core/types.ts';
import type { SkillMetadata, SkillResult } from '../types.ts';
import { parseWhen, stamp } from '../../util/date.ts';
import { pushEvent } from '../../modules/calendar-sync.ts';

/** Uchrashuv qo'shish — model shu navykni chaqira oladi. */

export const SKILL: SkillMetadata = {
  type: 'function',
  function: {
    name: 'create_event',
    description:
      'Kalendarga uchrashuv qo‘shadi. Google Calendar ulangan bo‘lsa u yerga ham yuboriladi. ' +
      'Vaqtni odam tilida berish mumkin: "ertaga 15:00", "juma 10:30".',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Uchrashuv nomi, masalan "Investor bilan"' },
        when: { type: 'string', description: 'Vaqt: "ertaga 15:00" yoki "2026-09-12 14:00"' },
        duration_minutes: { type: 'integer', description: 'Davomiyligi daqiqada, standart 60' },
        location: { type: 'string', description: 'Joy: ofis, Zoom va h.k.' },
      },
      required: ['title', 'when'],
    },
  },
};

export async function execute(args: Record<string, unknown>, ctx: Ctx): Promise<SkillResult> {
  const title = String(args['title']);
  const start = parseWhen(String(args['when']), ctx.cfg.tz, ctx.now);
  if (!start) return { error: `Vaqt tushunilmadi: "${String(args['when'])}"` };

  const minutes = Number(args['duration_minutes'] ?? 60) || 60;
  const end = new Date(start.getTime() + minutes * 60_000);

  const r = ctx.db.run(
    `INSERT INTO events(title, start_at, end_at, location) VALUES(?,?,?,?)`,
    title,
    start.toISOString(),
    end.toISOString(),
    args['location'] ? String(args['location']) : null,
  );

  const googleId = await pushEvent(ctx, r.lastInsertRowid);
  return {
    status: 'ok',
    id: r.lastInsertRowid,
    title,
    starts_at: stamp(start, ctx.cfg.tz),
    google_calendar: googleId ? 'yuborildi' : ctx.gcal.enabled ? 'yuborilmadi' : 'ulanmagan',
  };
}
