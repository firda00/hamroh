import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * API himoyasi.
 *
 * Veb-panel cookie bilan ishlaydi, lekin JSON API (`/run`, `/modules`, `/brief/*`)
 * brauzerdan emas — skript, mobil ilova yoki boshqa xizmatdan chaqiriladi.
 * Shuning uchun u faqat sarlavhadagi kalitni qabul qiladi:
 *
 *   Authorization: Bearer <HAMROH_WEB_TOKEN>
 *   X-Hamroh-Token: <HAMROH_WEB_TOKEN>
 *
 * Cookie ataylab qabul qilinmaydi: aks holda boshqa saytdagi forma brauzeringiz
 * nomidan `POST /run` yuborishi mumkin bo'lardi (CSRF). Kalit sarlavhada bo'lgani
 * uchun bunday hujum ishlamaydi.
 *
 * Kalit umuman qo'yilmagan bo'lsa — API yopiq (503). Bu panel bilan bir xil
 * qoida: sozlanmagan narsa ochiq qolmaydi.
 */

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Sarlavhadan kalitni oladi (Bearer yoki X-Hamroh-Token). */
export function headerToken(req: IncomingMessage): string {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^bearer[ \t]+(.+)$/i.exec(auth.trim());
    if (m?.[1]) return m[1].trim();
  }
  const own = req.headers['x-hamroh-token'];
  return typeof own === 'string' ? own.trim() : '';
}

export type ApiVerdict = 'ok' | 'kalit-yoq' | 'notogri' | 'bloklangan';

// ---------------- kalit topishga urinishlarni cheklash ----------------

const WINDOW_MS = 5 * 60_000;
const LIMIT = 10;
const fails = new Map<string, { n: number; until: number }>();

export function isBlocked(ip: string, now = Date.now()): boolean {
  const e = fails.get(ip);
  if (!e) return false;
  if (now >= e.until) {
    fails.delete(ip);
    return false;
  }
  return e.n >= LIMIT;
}

export function noteFail(ip: string, now = Date.now()): void {
  const e = fails.get(ip);
  if (!e || now >= e.until) fails.set(ip, { n: 1, until: now + WINDOW_MS });
  else e.n += 1;
}

export function clearFails(ip: string): void {
  fails.delete(ip);
}

/** Testlar uchun: hisoblagichni tozalaydi. */
export function resetGuard(): void {
  fails.clear();
}

/**
 * So'rovni tekshiradi. Muvaffaqiyatsiz urinishlar shu yerda sanaladi —
 * chaqiruvchi faqat javob qaytaradi.
 */
export function checkApi(req: IncomingMessage, token: string, now = Date.now()): ApiVerdict {
  if (!token) return 'kalit-yoq';
  const ip = req.socket.remoteAddress ?? '?';
  if (isBlocked(ip, now)) return 'bloklangan';
  if (safeEqual(headerToken(req), token)) {
    clearFails(ip);
    return 'ok';
  }
  noteFail(ip, now);
  return 'notogri';
}

const MESSAGES: Record<Exclude<ApiVerdict, 'ok'>, { code: number; body: Record<string, string> }> = {
  'kalit-yoq': {
    code: 503,
    body: {
      error: 'API yopiq',
      sabab: 'HAMROH_WEB_TOKEN qo‘yilmagan',
      yechim: '.env ga HAMROH_WEB_TOKEN=<uzun tasodifiy satr> yozing va serverni qayta ishga tushiring',
    },
  },
  notogri: {
    code: 401,
    body: {
      error: 'kalit talab qilinadi',
      qanday: 'Authorization: Bearer <HAMROH_WEB_TOKEN>',
    },
  },
  bloklangan: {
    code: 429,
    body: {
      error: 'juda ko‘p urinish',
      qachon: '5 daqiqadan keyin qayta urinib ko‘ring',
    },
  },
};

/** Rad javobini yozadi. Faqat `verdict !== 'ok'` bo'lganda chaqiriladi. */
export function denyApi(res: ServerResponse, verdict: Exclude<ApiVerdict, 'ok'>): void {
  const { code, body } = MESSAGES[verdict];
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}
