import type { Ctx } from '../core/types.ts';
import type { Kpi, KpiVerdict, RolePack } from './types.ts';
import { record, EVENTS } from './audit.ts';

/**
 * KPI baholash.
 *
 * Qoida: **raqam o'ylab topilmaydi.** Ma'lumot yetarli bo'lmasa
 * «ma'lumot yo'q» deb yoziladi, nol yoki taxmin emas. Sotiladigan rol uchun
 * bu muhim: mijoz ko'rsatkichni ishonchli deb qabul qiladi.
 */

export type KpiResult = {
  id: string;
  title: string;
  unit: string;
  value: number | null;
  target: number;
  direction: 'up' | 'down';
  verdict: KpiVerdict;
  /** Maqsadga necha foiz yetdi (100 = maqsad bajarildi). */
  attainment: number | null;
  why: string;
};

/** Chegara: maqsaddan 10% ichida — «chegarada», undan yomoni — «yomon». */
const TOLERANCE = 0.1;

export function judge(value: number | null, target: number, direction: 'up' | 'down'): KpiVerdict {
  if (value === null || !Number.isFinite(value)) return 'ma’lumot yo‘q';
  if (direction === 'up') {
    if (value >= target) return 'yaxshi';
    return value >= target * (1 - TOLERANCE) ? 'chegarada' : 'yomon';
  }
  if (value <= target) return 'yaxshi';
  return value <= target * (1 + TOLERANCE) ? 'chegarada' : 'yomon';
}

/** Maqsadga yetish darajasi, foizda. Yo'nalishga qarab hisoblanadi. */
export function attainmentOf(value: number | null, target: number, direction: 'up' | 'down'): number | null {
  if (value === null || !Number.isFinite(value) || target === 0) return null;
  // Kam bo'lgani yaxshi bo'lgan ko'rsatkichda nol — mукammal natija.
  // Bo'lishda cheksizlik chiqadi, shuning uchun alohida ushlanadi.
  if (direction === 'down' && value === 0) return 999;
  const raw = direction === 'up' ? value / target : target / value;
  if (!Number.isFinite(raw)) return null;
  return Math.min(999, Math.round(raw * 100));
}

/**
 * KPI qiymatini ko'rsatish uchun formatlaydi.
 *
 * compact() katta summalar uchun yaxshi, lekin 0.45% ni «0» qilib yuboradi —
 * ya'ni CTR umuman ko'rinmay qoladi. Shuning uchun kichik va kasrli
 * qiymatlar aynan o'zi kabi yoziladi.
 */
export function formatKpi(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return 'ma’lumot yo‘q';
  const abs = Math.abs(value);
  let text: string;
  if (abs >= 10_000) {
    const k = abs >= 1_000_000 ? { d: 1_000_000, s: 'mln' } : { d: 1_000, s: 'ming' };
    text = `${(value / k.d).toFixed(1)} ${k.s}`;
  } else if (Number.isInteger(value)) {
    text = value.toLocaleString('ru-RU');
  } else {
    text = value.toFixed(abs < 10 ? 2 : 1);
  }
  return unit ? `${text} ${unit}` : text;
}

export function evaluateKpi(ctx: Ctx, kpi: Kpi, from: string, to: string): KpiResult {
  let value: number | null;
  try {
    value = kpi.measure(ctx, from, to);
  } catch {
    // O'lchov yiqilsa butun hisobot yiqilmasin — bu ko'rsatkich «ma'lumot yo'q» bo'ladi.
    value = null;
  }
  if (value !== null && !Number.isFinite(value)) value = null;

  return {
    id: kpi.id,
    title: kpi.title,
    unit: kpi.unit,
    value,
    target: kpi.target,
    direction: kpi.direction,
    verdict: judge(value, kpi.target, kpi.direction),
    attainment: attainmentOf(value, kpi.target, kpi.direction),
    why: kpi.why,
  };
}

export function evaluateAll(ctx: Ctx, pack: RolePack, from: string, to: string, log = false): KpiResult[] {
  const results = pack.kpis.map((k) => evaluateKpi(ctx, k, from, to));
  if (log) {
    record(ctx.db, ctx.now, {
      role: pack.id,
      actor: 'tizim',
      event: EVENTS.kpiMeasured,
      subject: `${from}…${to}`,
      detail: results.map((r) => ({ id: r.id, qiymat: r.value, maqsad: r.target, xulosa: r.verdict })),
    });
  }
  return results;
}

/** Umumiy baho: nechta ko'rsatkich maqsadga yetdi. */
export function scoreOf(results: KpiResult[]): { good: number; measured: number; percent: number | null } {
  const measured = results.filter((r) => r.verdict !== 'ma’lumot yo‘q');
  const good = measured.filter((r) => r.verdict === 'yaxshi').length;
  return {
    good,
    measured: measured.length,
    percent: measured.length ? Math.round((good / measured.length) * 100) : null,
  };
}

export const ICON: Record<KpiVerdict, string> = {
  'yaxshi': '🟢',
  'chegarada': '🟡',
  'yomon': '🔴',
  'ma’lumot yo‘q': '⚪',
};
