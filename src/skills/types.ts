import type { Ctx } from '../core/types.ts';

/**
 * Navyk (skill) formati.
 *
 * Metama'lumot OpenAI "tools" sxemasi ko'rinishida — shu holda u Ollama, vLLM,
 * LM Studio va Claude'ga o'zgartirishsiz uzatiladi.
 */

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export type JsonProperty = {
  type: JsonType;
  description?: string;
  enum?: (string | number)[];
  items?: JsonProperty;
};

export type SkillMetadata = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, JsonProperty>;
      required?: string[];
    };
  };
};

/** Navyk qaytaradigan natija — JSON ga aylanadigan bo'lishi shart. */
export type SkillResult = Record<string, unknown> | { error: string };

/** Har bir navyk fayli shu ikkitasini eksport qiladi. */
export type SkillModule = {
  SKILL: SkillMetadata;
  execute: (args: Record<string, unknown>, ctx: Ctx) => Promise<SkillResult> | SkillResult;
};

export type LoadedSkill = {
  name: string;
  file: string;
  metadata: SkillMetadata;
  execute: SkillModule['execute'];
  /** builtin — loyiha bilan keladi · user — foydalanuvchi qo'shgan. */
  origin: 'builtin' | 'user';
};

export type LoadError = { file: string; reason: string };

/** Navyk faylini tekshirish natijasi. */
export type Validation = { ok: boolean; name?: string; problems: string[] };

const NAME_RE = /^[a-z][a-z0-9_]{2,47}$/;

/** Metama'lumot to'g'ri tuzilganmi. LLM yozgan fayl uchun ayniqsa muhim. */
export function validateMetadata(meta: unknown): Validation {
  const problems: string[] = [];
  const m = meta as Partial<SkillMetadata> | undefined;

  if (!m || typeof m !== 'object') return { ok: false, problems: ['SKILL eksport qilinmagan yoki obyekt emas'] };
  if (m.type !== 'function') problems.push('SKILL.type "function" bo‘lishi kerak');

  const fn = m.function;
  if (!fn || typeof fn !== 'object') {
    problems.push('SKILL.function yo‘q');
    return { ok: false, problems };
  }

  if (typeof fn.name !== 'string' || !NAME_RE.test(fn.name)) {
    problems.push('name: kichik lotin harflari, raqam va _ , 3-48 belgi (masalan: send_sms)');
  }
  if (typeof fn.description !== 'string' || fn.description.trim().length < 10) {
    problems.push('description: kamida 10 belgi — model shu matnga qarab tanlaydi');
  }

  const p = fn.parameters;
  if (!p || p.type !== 'object' || typeof p.properties !== 'object') {
    problems.push('parameters: { type: "object", properties: {...} } bo‘lishi kerak');
  } else {
    for (const [key, prop] of Object.entries(p.properties)) {
      if (!prop || typeof prop !== 'object' || !('type' in prop)) {
        problems.push(`parameters.${key}: type ko‘rsatilmagan`);
      }
    }
    for (const req of p.required ?? []) {
      if (!(req in p.properties)) problems.push(`required "${req}" properties ichida yo‘q`);
    }
  }

  return { ok: problems.length === 0, name: fn.name, problems };
}

/**
 * Argumentlarni sxemaga solishtiradi.
 * Model noto'g'ri tur yoki yetishmayotgan maydon bersa — bajarmasdan qaytaramiz.
 */
export function validateArgs(meta: SkillMetadata, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const { properties, required = [] } = meta.function.parameters;

  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      problems.push(`"${key}" majburiy, lekin berilmadi`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) {
      problems.push(`"${key}" sxemada yo‘q`);
      continue;
    }
    if (value === undefined || value === null) continue;

    const actual = Array.isArray(value) ? 'array' : typeof value;
    const expected = prop.type;
    const numeric = expected === 'number' || expected === 'integer';

    if (numeric && actual !== 'number') problems.push(`"${key}" son bo‘lishi kerak`);
    else if (expected === 'integer' && !Number.isInteger(value)) problems.push(`"${key}" butun son bo‘lishi kerak`);
    else if (!numeric && expected !== actual) problems.push(`"${key}" ${expected} bo‘lishi kerak, keldi: ${actual}`);

    if (prop.enum && !prop.enum.includes(value as string | number)) {
      problems.push(`"${key}" faqat shulardan biri: ${prop.enum.join(', ')}`);
    }
  }

  return problems;
}
