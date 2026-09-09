import type { Platform } from '../modules/marketing.ts';

/**
 * Marketing manbalari — rasmiy API'lar.
 *
 * Prinsip: **hech qanday skrejping yo'q.** Sayt sahifasini «qirqib olish»
 * platformalarning shartlarini buzadi va hisobni bloklashga olib keladi.
 * Shuning uchun faqat rasmiy API, faqat siz bergan ruxsat bilan, faqat
 * o'qish uchun.
 *
 * Har bir manba mustaqil: biri sozlanmagan bo'lsa qolganlari ishlayveradi.
 * Sozlanmagan manba xato bermaydi — nima qilish kerakligini aytadi.
 */

export type MetricPoint = {
  date: string; // YYYY-MM-DD
  metric: string; // marketing.ts dagi METRICS kalitlari
  value: number;
  account?: string;
};

export type PullResult = {
  points: MetricPoint[];
  /** Diagnostika uchun: qaysi hisob, nechta kun. */
  note: string;
};

export type MarketingSource = {
  id: Platform;
  /** Sozlangan va ishlashga tayyor. */
  ready: boolean;
  /** Tayyor bo'lmasa — nima qilish kerakligi. Tayyor bo'lsa — hisob nomi. */
  status: string;
  pull: (from: string, to: string) => Promise<PullResult>;
};

/** Sozlanmagan manba: chaqirilsa ko'rsatma qaytaradi, yiqilmaydi. */
export function disabledSource(id: Platform, status: string): MarketingSource {
  return {
    id,
    ready: false,
    status,
    pull: () => Promise.reject(new Error(`${id}: ${status}`)),
  };
}

/**
 * Platformaning javobidagi xatoni odam tushunadigan matnga aylantiradi.
 * Ayniqsa 401/403 — bu deyarli har doim ruxsat masalasi, kod xatosi emas.
 */
export function apiError(platform: string, status: number, body: string, hint = ''): Error {
  const short = body.length > 400 ? `${body.slice(0, 400)}…` : body;

  // Platformalar sababni JSON ichida yozadi. Uni birinchi qatorga chiqaramiz,
  // aks holda foydalanuvchi faqat «HTTP 400» ni ko'radi va nima qilishni bilmaydi.
  let said = '';
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string; error_user_msg?: string } | string;
      error_description?: string;
      message?: string;
    };
    const e = typeof j.error === 'string' ? j.error : j.error?.error_user_msg || j.error?.message;
    said = e || j.error_description || j.message || '';
  } catch {
    /* JSON emas */
  }
  const common =
    status === 401
      ? 'token eskirgan yoki noto‘g‘ri'
      : status === 403
        ? 'ruxsat yetarli emas (scope yoki hisob huquqi)'
        : status === 429
          ? 'so‘rovlar chegarasi — keyinroq urinib ko‘ring'
          : `HTTP ${status}`;
  const head = [common, said, hint].filter(Boolean).join(' · ');
  return new Error(`${platform}: ${head}\n${short}`);
}

/** Barcha manbalar uchun bir xil so'rov: taymaut va JSON tekshiruvi bilan. */
export async function getJson<T>(
  platform: string,
  url: string,
  init: RequestInit = {},
  hint = '',
): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw apiError(platform, res.status, text, hint);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${platform}: javob JSON emas\n${text.slice(0, 200)}`);
  }
}

/** `2026-09-01` → `{year:2026, month:9, day:1}` — Google ba'zi API'larda shunday so'raydi. */
export function dateParts(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y ?? 0, month: m ?? 0, day: d ?? 0 };
}

/** Kunlar ro'yxati: from dan to gacha (ikkalasi ham kiradi). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
