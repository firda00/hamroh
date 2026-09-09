import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Ctx } from '../core/types.ts';
import type { LoadedSkill, LoadError, SkillMetadata, SkillModule, SkillResult } from './types.ts';
import { validateMetadata, validateArgs } from './types.ts';
import { logger } from '../core/logger.ts';

/**
 * Navyklar registri: skanerlash, ro'yxatga olish, chaqirish.
 *
 * Ikki manba:
 *   src/skills/builtin/  — loyiha bilan keladigan navyklar
 *   skills/active/       — foydalanuvchi qo'shgan yoki tasdiqlagan navyklar
 *
 * skills/drafts/ hech qachon yuklanmaydi va modelga ko'rsatilmaydi.
 */

const log = logger('skills');

export const DRAFTS_DIR = 'skills/drafts';
export const ACTIVE_DIR = 'skills/active';
const BUILTIN_DIR = fileURLToPath(new URL('./builtin/', import.meta.url));

export type Registry = {
  skills: LoadedSkill[];
  errors: LoadError[];
  /** LLM ga uzatiladigan tools massivi. */
  toolsSchema: () => SkillMetadata[];
  byName: (name: string) => LoadedSkill | undefined;
  /** Nomi va argumentlari bo'yicha navykni bajaradi. */
  execute: (name: string, args: Record<string, unknown>, ctx: Ctx) => Promise<SkillResult>;
};

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(ts|mjs|js)$/.test(f) && !f.startsWith('_') && !f.endsWith('.d.ts'))
    .map((f) => join(dir, f))
    .sort();
}

async function loadOne(
  file: string,
  origin: LoadedSkill['origin'],
  seen: Set<string>,
  out: LoadedSkill[],
  errors: LoadError[],
): Promise<void> {
  let mod: Partial<SkillModule>;
  try {
    // Har safar yangi import — faylni almashtirgach qayta yuklash uchun
    mod = (await import(`${pathToFileURL(resolve(file)).href}?v=${Date.now()}`)) as Partial<SkillModule>;
  } catch (e) {
    errors.push({ file, reason: `import xatosi: ${(e as Error).message.split('\n')[0]}` });
    return;
  }

  const check = validateMetadata(mod.SKILL);
  if (!check.ok) {
    errors.push({ file, reason: check.problems.join('; ') });
    return;
  }
  if (typeof mod.execute !== 'function') {
    errors.push({ file, reason: 'execute() eksport qilinmagan' });
    return;
  }

  const name = check.name as string;
  if (seen.has(name)) {
    errors.push({ file, reason: `"${name}" nomi allaqachon band` });
    return;
  }
  seen.add(name);
  out.push({ name, file, metadata: mod.SKILL as SkillMetadata, execute: mod.execute, origin });
}

/** Navyklarni yuklaydi. Bitta fayl buzuq bo'lsa qolganlari baribir ishlaydi. */
export async function loadSkills(activeDir = ACTIVE_DIR): Promise<Registry> {
  const skills: LoadedSkill[] = [];
  const errors: LoadError[] = [];
  const seen = new Set<string>();

  for (const file of listFiles(BUILTIN_DIR)) {
    await loadOne(file, 'builtin', seen, skills, errors);
  }
  for (const file of listFiles(activeDir)) {
    await loadOne(file, 'user', seen, skills, errors);
  }

  for (const e of errors) log.warn(`${basename(e.file)}: ${e.reason}`);
  log.debug(`${skills.length} navyk yuklandi`);

  return {
    skills,
    errors,
    toolsSchema: () => skills.map((s) => s.metadata),
    byName: (name) => skills.find((s) => s.name === name),
    execute: async (name, args, ctx) => {
      const skill = skills.find((s) => s.name === name);
      if (!skill) return { error: `"${name}" nomli navyk yo‘q` };

      const problems = validateArgs(skill.metadata, args);
      if (problems.length) return { error: `Argumentlar noto‘g‘ri: ${problems.join('; ')}` };

      try {
        const result = await skill.execute(args, ctx);
        // Natija JSON ga aylanishini kafolatlaymiz — model uni o'qiy olishi kerak
        return JSON.parse(JSON.stringify(result ?? {})) as SkillResult;
      } catch (e) {
        log.warn(`${name}: ${(e as Error).message}`);
        return { error: (e as Error).message };
      }
    },
  };
}

/** skills/ papkalarini yaratadi (birinchi ishga tushirishda). */
export function ensureDirs(): void {
  for (const dir of [ACTIVE_DIR, DRAFTS_DIR]) mkdirSync(dir, { recursive: true });
}

export const draftPath = (name: string): string => join(DRAFTS_DIR, `${name}.ts`);
export const activePath = (name: string): string => join(ACTIVE_DIR, `${name}.ts`);
