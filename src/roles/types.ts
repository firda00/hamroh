import type { Ctx } from '../core/types.ts';

/**
 * Rol paketi — agentni aniq bir lavozimga aylantiradigan to'plam.
 *
 * Navyk «nima qila oladi» degan savolga javob beradi. Rol paketi esa
 * «kim bo'lib ishlaydi» degan savolga: nimaga ruxsati bor, qanday tartibda
 * ishlaydi, qayerda to'xtab so'raydi, qaysi raqamlar bo'yicha baholanadi va
 * qilgan ishi qayerda yozib boriladi.
 *
 * Asosiy qoida: **ruxsat berilmagan hamma narsa taqiqlangan.** Ro'yxatda
 * yo'q buyruq bajarilmaydi — xato bo'lib emas, ataylab.
 */

export type PermissionMode =
  /** O'zi bajaradi. */
  | 'auto'
  /** To'xtaydi va odamdan so'raydi. */
  | 'approval'
  /** Umuman bajarilmaydi. */
  | 'deny';

export type Permission = {
  /** `modul:buyruq` yoki `modul:*`. */
  action: string;
  mode: PermissionMode;
  /** Nega aynan shunday — mijozga tushuntirish uchun. */
  why: string;
};

export type WorkflowStep = {
  id: string;
  title: string;
  /** `modul:buyruq`. */
  action: string;
  args?: string[];
  /** Natijada nima paydo bo'ladi. */
  produces: string;
  /** cron: qachon ishga tushadi. Yo'q bo'lsa — faqat qo'lda. */
  cron?: string;
  /** Kunlik uya o'rniga haftalik uya (dushanba). */
  weekly?: boolean;
  /** Xato bo'lsa keyingi qadamlar to'xtamaydi. */
  optional?: boolean;
  /**
   * Natija haqiqatan kutilgandek chiqqanini tekshiradi.
   *
   * Kerak, chunki buyruq xato bermasdan ham ish qilmasligi mumkin —
   * masalan argument yetishmasa, foydalanish ko'rsatmasini qaytaradi.
   * Bunday holat «bajarildi» deb yozilib qolmasin.
   *
   * `null` — hammasi joyida. Matn — nima noto'g'ri ketgani.
   */
  verify?: (result: StepResult) => string | null;
};

/** `verify` ko'radigan qism — CommandResult ning o'qish uchun keragi. */
export type StepResult = { text: string; data?: unknown; files?: string[] };

export type KpiVerdict = 'yaxshi' | 'chegarada' | 'yomon' | 'ma’lumot yo‘q';

export type Kpi = {
  id: string;
  title: string;
  unit: string;
  /** Maqsad qiymati. */
  target: number;
  /** `up` — ko'p bo'lgani yaxshi, `down` — kam bo'lgani yaxshi. */
  direction: 'up' | 'down';
  /** Nima uchun bu ko'rsatkich muhim. */
  why: string;
  /** Davr uchun qiymat. `null` — ma'lumot yetarli emas. */
  measure: (ctx: Ctx, from: string, to: string) => number | null;
};

export type RolePack = {
  id: string;
  /** Mijozga ko'rinadigan nom. */
  name: string;
  version: string;
  /** Bir gapda: bu rol nima uchun bor. */
  mission: string;
  /** Aniq nima qiladi. */
  does: string[];
  /** Aniq nima qilmaydi — chegara shu yerda ko'rinadi. */
  doesNot: string[];
  permissions: Permission[];
  workflow: WorkflowStep[];
  kpis: Kpi[];
};

// ---------------------------------------------------------------- tekshiruv

const ACTION_RE = /^[a-z][a-z0-9_]*:(\*|[a-z][a-z0-9_-]*)$/;

/**
 * Paketni yuklashdan oldin tekshiradi. Noto'g'ri paket ishlamasin — mijozda
 * emas, shu yerda yiqilsin.
 */
export function validatePack(pack: RolePack, known: (action: string) => boolean): string[] {
  const problems: string[] = [];

  if (!/^[a-z][a-z0-9-]{2,39}$/.test(pack.id)) problems.push(`id noto‘g‘ri: ${pack.id}`);
  if (!pack.name.trim()) problems.push('name bo‘sh');
  if (!/^v?\d+(\.\d+)*$/.test(pack.version)) problems.push(`version noto‘g‘ri: ${pack.version}`);
  if (pack.mission.trim().length < 10) problems.push('mission juda qisqa');
  if (!pack.permissions.length) problems.push('permissions bo‘sh — hech narsa qila olmaydi');
  if (!pack.workflow.length) problems.push('workflow bo‘sh');

  const seen = new Set<string>();
  for (const p of pack.permissions) {
    if (!ACTION_RE.test(p.action)) problems.push(`ruxsat noto‘g‘ri yozilgan: ${p.action}`);
    if (seen.has(p.action)) problems.push(`ruxsat takrorlangan: ${p.action}`);
    seen.add(p.action);
    if (p.why.trim().length < 5) problems.push(`${p.action}: sabab yozilmagan`);
    // Aniq buyruq mavjudligini tekshiramiz. `*` — modul darajasi, tekshirilmaydi.
    if (!p.action.endsWith(':*') && !known(p.action)) problems.push(`bunday buyruq yo‘q: ${p.action}`);
  }

  const steps = new Set<string>();
  for (const s of pack.workflow) {
    if (steps.has(s.id)) problems.push(`qadam takrorlangan: ${s.id}`);
    steps.add(s.id);
    if (!ACTION_RE.test(s.action) || s.action.endsWith(':*')) {
      problems.push(`${s.id}: action aniq buyruq bo‘lishi kerak (${s.action})`);
    } else if (!known(s.action)) {
      problems.push(`${s.id}: bunday buyruq yo‘q — ${s.action}`);
    }
    // Ish oqimidagi qadam ruxsatsiz qolmasin: bu eng oson yo'qotiladigan xato.
    if (resolvePermission(pack, s.action).mode === 'deny') {
      problems.push(`${s.id}: ${s.action} ruxsat ro‘yxatida yo‘q yoki taqiqlangan`);
    }
  }

  const kpiIds = new Set<string>();
  for (const k of pack.kpis) {
    if (kpiIds.has(k.id)) problems.push(`KPI takrorlangan: ${k.id}`);
    kpiIds.add(k.id);
    if (!Number.isFinite(k.target)) problems.push(`${k.id}: target raqam emas`);
  }

  return problems;
}

export type Resolved = { mode: PermissionMode; why: string; rule: string };

/**
 * Buyruq uchun ruxsatni topadi.
 *
 * Tartib: aniq mos (`marketing:sync`) modul darajasidan (`marketing:*`) ustun.
 * Hech narsa mos kelmasa — **taqiq**. Ro'yxatga kirmagan buyruq bajarilmaydi.
 */
export function resolvePermission(pack: RolePack, action: string): Resolved {
  const exact = pack.permissions.find((p) => p.action === action);
  if (exact) return { mode: exact.mode, why: exact.why, rule: exact.action };

  const moduleId = action.split(':')[0] ?? '';
  const wild = pack.permissions.find((p) => p.action === `${moduleId}:*`);
  if (wild) return { mode: wild.mode, why: wild.why, rule: wild.action };

  return { mode: 'deny', why: 'ruxsat ro‘yxatida yo‘q', rule: '(standart taqiq)' };
}
