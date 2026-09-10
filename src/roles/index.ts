import type { RolePack } from './types.ts';
import { validatePack } from './types.ts';
import { commandExists } from './runner.ts';
import { marketingEmployee } from './packs/marketing-employee.ts';

/**
 * Rol paketlari ro'yxati. Yangi paket shu yerga qo'shiladi.
 *
 * Paketlar yuklanganda tekshiriladi: noto'g'ri yozilgan ruxsat yoki mavjud
 * bo'lmagan buyruq mijozda emas, shu yerda ko'rinadi.
 */

export const packs: RolePack[] = [marketingEmployee];

export const byRoleId = (id: string): RolePack | undefined => packs.find((p) => p.id === id);

export type PackProblem = { pack: string; problems: string[] };

/** Barcha paketlarni tekshiradi. Bo'sh massiv — hammasi joyida. */
export function checkPacks(): PackProblem[] {
  return packs
    .map((p) => ({ pack: p.id, problems: validatePack(p, commandExists) }))
    .filter((r) => r.problems.length > 0);
}

export type { RolePack, Permission, WorkflowStep, Kpi } from './types.ts';
