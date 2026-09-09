import type { Ctx } from '../core/types.ts';
import type { GEvent } from '../gcal/index.ts';
import { addDays, stamp } from '../util/date.ts';
import { logger } from '../core/logger.ts';

/**
 * Google Calendar bilan ikki tomonlama sinxronizatsiya.
 *
 * Qoida oddiy va oldindan bashorat qilinadigan:
 *   - Google'dan kelgan hodisa — Google haqiqat manbai, mahalliy nusxa yangilanadi
 *   - Mahalliy yaratilgan hodisa (external_id yo'q) — Google'ga bir marta yuboriladi
 *   - Bekor qilingan hodisa ikkala tomonda ham yopiladi
 *
 * Murakkab konflikt yechish qasddan qilinmadi: shaxsiy kalendarda ikki tomondan
 * bir vaqtda tahrirlash deyarli uchramaydi, lekin noto'g'ri "aqlli" birlashtirish
 * uchrashuvni yo'qotib qo'yishi mumkin.
 */

const log = logger('gcal-sync');

export type SyncResult = { pulled: number; pushed: number; canceled: number; failed: number; lines: string[] };

type LocalEvent = {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  notes: string | null;
  external_id: string | null;
  status: string;
};

/** Google hodisasidan boshlanish/tugash vaqtini oladi (kun bo'yi hodisalar ham bor). */
function times(g: GEvent): { start: string; end: string } | null {
  const startRaw = g.start?.dateTime ?? (g.start?.date ? `${g.start.date}T00:00:00Z` : '');
  if (!startRaw) return null;
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return null;

  const endRaw = g.end?.dateTime ?? (g.end?.date ? `${g.end.date}T00:00:00Z` : '');
  const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + 3600_000);
  return { start: start.toISOString(), end: (Number.isNaN(end.getTime()) ? new Date(start.getTime() + 3600_000) : end).toISOString() };
}

export async function syncGcal(ctx: Ctx, days = 60): Promise<SyncResult> {
  const out: SyncResult = { pulled: 0, pushed: 0, canceled: 0, failed: 0, lines: [] };
  if (!ctx.gcal.enabled) {
    out.lines.push('Google Calendar ulanmagan (HAMROH_GCAL=off). docs/GCALENDAR.md');
    return out;
  }

  const from = addDays(ctx.now, -7);
  const to = addDays(ctx.now, days);

  // ---------- 1. Google -> mahalliy ----------
  const remote = await ctx.gcal.list(from.toISOString(), to.toISOString());
  for (const g of remote) {
    const t = times(g);
    if (!t) continue;

    if (g.status === 'cancelled') {
      const r = ctx.db.run(`UPDATE events SET status='bekor' WHERE external_id=? AND status<>'bekor'`, g.id);
      if (r.changes) {
        out.canceled++;
        out.lines.push(`✗ bekor: ${g.summary ?? '(nomsiz)'}`);
      }
      continue;
    }

    const existing = ctx.db.get<{ id: number }>(`SELECT id FROM events WHERE external_id=?`, g.id);
    if (existing) {
      ctx.db.run(
        `UPDATE events SET title=?, start_at=?, end_at=?, location=?, notes=?, status='rejada' WHERE id=?`,
        g.summary ?? '(nomsiz)',
        t.start,
        t.end,
        g.location ?? null,
        g.description ?? null,
        existing.id,
      );
    } else {
      ctx.db.run(
        `INSERT INTO events(title, start_at, end_at, location, notes, source, external_id)
         VALUES(?,?,?,?,?,'google',?)`,
        g.summary ?? '(nomsiz)',
        t.start,
        t.end,
        g.location ?? null,
        g.description ?? null,
        g.id,
      );
      out.pulled++;
      out.lines.push(`↓ ${stamp(new Date(t.start), ctx.cfg.tz)} ${g.summary ?? '(nomsiz)'}`);
    }
  }

  // ---------- 2. Mahalliy -> Google ----------
  const local = ctx.db.all<LocalEvent>(
    `SELECT * FROM events
     WHERE external_id IS NULL AND status<>'bekor' AND start_at >= ?
     ORDER BY start_at ASC LIMIT 100`,
    from.toISOString(),
  );

  for (const e of local) {
    try {
      const created = await ctx.gcal.create({
        title: e.title,
        startIso: new Date(e.start_at).toISOString(),
        endIso: new Date(e.end_at ?? new Date(new Date(e.start_at).getTime() + 3600_000)).toISOString(),
        location: e.location ?? undefined,
        description: e.notes ?? undefined,
        timeZone: ctx.cfg.tz,
      });
      ctx.db.run(`UPDATE events SET external_id=? WHERE id=?`, created.id, e.id);
      out.pushed++;
      out.lines.push(`↑ ${stamp(new Date(e.start_at), ctx.cfg.tz)} ${e.title}`);
    } catch (err) {
      out.failed++;
      out.lines.push(`✗ #${e.id} ${e.title}: ${(err as Error).message.split('\n')[0]}`);
      log.warn(`#${e.id} yuborilmadi: ${(err as Error).message}`);
    }
  }

  return out;
}

/** Bitta hodisani Google'ga yuboradi. Xato bo'lsa mahalliy yozuv baribir qoladi. */
export async function pushEvent(ctx: Ctx, localId: number): Promise<string | null> {
  if (!ctx.gcal.enabled) return null;
  const e = ctx.db.get<LocalEvent>(`SELECT * FROM events WHERE id=?`, localId);
  if (!e || e.external_id) return null;

  try {
    const created = await ctx.gcal.create({
      title: e.title,
      startIso: new Date(e.start_at).toISOString(),
      endIso: new Date(e.end_at ?? new Date(new Date(e.start_at).getTime() + 3600_000)).toISOString(),
      location: e.location ?? undefined,
      description: e.notes ?? undefined,
      timeZone: ctx.cfg.tz,
    });
    ctx.db.run(`UPDATE events SET external_id=? WHERE id=?`, created.id, localId);
    return created.id;
  } catch (err) {
    log.warn(`Google'ga yuborilmadi: ${(err as Error).message}`);
    return null;
  }
}

/** Bekor qilingan hodisani Google'da ham o'chiradi. */
export async function removeEvent(ctx: Ctx, externalId: string): Promise<boolean> {
  if (!ctx.gcal.enabled || !externalId) return false;
  try {
    await ctx.gcal.remove(externalId);
    return true;
  } catch (err) {
    log.warn(`Google'da o‘chirilmadi: ${(err as Error).message}`);
    return false;
  }
}
