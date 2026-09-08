/**
 * Vaqt zonasi bilan ishlash — tashqi kutubxonasiz, Intl orqali.
 * Bazada hamma vaqt ISO/UTC saqlanadi, ko'rsatishda foydalanuvchi zonasiga o'giriladi.
 */

export type Parts = { y: number; m: number; d: number; H: number; M: number; S: number };

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FMT_CACHE.set(tz, f);
  }
  return f;
}

export function parts(date: Date, tz: string): Parts {
  const map: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(date)) map[p.type] = p.value;
  const n = (k: string): number => Number(map[k] ?? '0');
  const H = n('hour');
  return { y: n('year'), m: n('month'), d: n('day'), H: H === 24 ? 0 : H, M: n('minute'), S: n('second') };
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** 'YYYY-MM-DD' foydalanuvchi zonasida. */
export function dateKey(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** 'YYYY-MM' foydalanuvchi zonasida. */
export function monthKey(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${p.y}-${pad(p.m)}`;
}

/** 'HH:MM' foydalanuvchi zonasida. */
export function timeKey(date: Date, tz: string): string {
  const p = parts(date, tz);
  return `${pad(p.H)}:${pad(p.M)}`;
}

/** 'YYYY-MM-DD HH:MM' foydalanuvchi zonasida. */
export function stamp(date: Date, tz: string): string {
  return `${dateKey(date, tz)} ${timeKey(date, tz)}`;
}

function offsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Zonadagi "devor soati"ni haqiqiy UTC lahzasiga aylantiradi. */
export function zonedToUtc(p: Partial<Parts> & { y: number; m: number; d: number }, tz: string): Date {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.H ?? 0, p.M ?? 0, p.S ?? 0);
  let out = guess - offsetMs(new Date(guess), tz);
  out = guess - offsetMs(new Date(out), tz);
  return new Date(out);
}

export function startOfDay(date: Date, tz: string): Date {
  const p = parts(date, tz);
  return zonedToUtc({ y: p.y, m: p.m, d: p.d, H: 0, M: 0, S: 0 }, tz);
}

export function endOfDay(date: Date, tz: string): Date {
  return new Date(startOfDay(date, tz).getTime() + 24 * 3600_000 - 1);
}

export function startOfMonth(date: Date, tz: string): Date {
  const p = parts(date, tz);
  return zonedToUtc({ y: p.y, m: p.m, d: 1, H: 0, M: 0, S: 0 }, tz);
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 24 * 3600_000);
}

/** 'YYYY-MM' oyining oxirgi kuni. */
export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
}

/** Oldingi oy: '2026-09' -> '2026-08'. */
export function prevMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 2, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export const WEEKDAYS_UZ = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

export function weekdayUz(date: Date, tz: string): string {
  const p = parts(date, tz);
  const idx = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return WEEKDAYS_UZ[idx] ?? '';
}

/**
 * Foydalanuvchi yozgan vaqtni tushunadi:
 *   "bugun 15:00", "ertaga 10:30", "indinga", "+2h", "+30m",
 *   "2026-09-12", "2026-09-12 14:00", "14:00", "dushanba 09:00"
 * Tushunmasa null qaytaradi.
 */
export function parseWhen(input: string, tz: string, now = new Date()): Date | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const rel = s.match(/^\+(\d+)\s*(m|min|h|soat|d|kun)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2] ?? 'm';
    const ms = unit.startsWith('m') ? n * 60_000 : unit.startsWith('h') || unit === 'soat' ? n * 3600_000 : n * 86_400_000;
    return new Date(now.getTime() + ms);
  }

  const timeAt = s.match(/(\d{1,2}):(\d{2})/);
  const H = timeAt ? Number(timeAt[1]) : 9;
  const M = timeAt ? Number(timeAt[2]) : 0;

  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return zonedToUtc({ y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]), H, M, S: 0 }, tz);
  }

  const dm = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?/);
  if (dm) {
    const p = parts(now, tz);
    return zonedToUtc({ y: dm[3] ? Number(dm[3]) : p.y, m: Number(dm[2]), d: Number(dm[1]), H, M, S: 0 }, tz);
  }

  const dayShift = s.startsWith('ertaga') ? 1 : s.startsWith('indinga') ? 2 : s.startsWith('kecha') ? -1 : s.startsWith('bugun') ? 0 : null;
  if (dayShift !== null) {
    const p = parts(addDays(now, dayShift), tz);
    return zonedToUtc({ y: p.y, m: p.m, d: p.d, H, M, S: 0 }, tz);
  }

  const wd = WEEKDAYS_UZ.findIndex((w) => s.startsWith(w));
  if (wd >= 0) {
    const p = parts(now, tz);
    const today = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    const shift = (wd - today + 7) % 7 || 7;
    const t = parts(addDays(now, shift), tz);
    return zonedToUtc({ y: t.y, m: t.m, d: t.d, H, M, S: 0 }, tz);
  }

  if (timeAt) {
    const p = parts(now, tz);
    const at = zonedToUtc({ y: p.y, m: p.m, d: p.d, H, M, S: 0 }, tz);
    return at.getTime() < now.getTime() ? addDays(at, 1) : at;
  }

  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "3 soat 20 daqiqa qoldi" ko'rinishidagi masofa. */
export function humanUntil(target: Date, now = new Date()): string {
  const diff = target.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const text =
    mins < 60
      ? `${mins} daqiqa`
      : mins < 60 * 24
        ? `${Math.floor(mins / 60)} soat ${mins % 60 ? `${mins % 60} daqiqa` : ''}`.trim()
        : `${Math.floor(mins / (60 * 24))} kun`;
  return diff >= 0 ? `${text} qoldi` : `${text} kechikdi`;
}
