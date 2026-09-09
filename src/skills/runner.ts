/**
 * Sandbox ichidagi tomon: navyk faylini import qiladi, tekshiradi va
 * (so'ralsa) bajaradi. Natija stdout ga bitta JSON qatori bo'lib chiqadi.
 *
 * Bu fayl to'g'ridan-to'g'ri chaqirilmaydi — uni sandbox.ts ishga tushiradi.
 */

import { pathToFileURL } from 'node:url';
import { validateMetadata, validateArgs } from './types.ts';
import type { SkillMetadata, SkillModule } from './types.ts';

const say = (payload: Record<string, unknown>): void => {
  process.stdout.write(JSON.stringify(payload));
};

async function readStdin(): Promise<{ args: Record<string, unknown> | null }> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return { args: null };
  try {
    return JSON.parse(raw) as { args: Record<string, unknown> | null };
  } catch {
    return { args: null };
  }
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    say({ ok: false, error: 'fayl ko‘rsatilmadi' });
    return;
  }

  const { args } = await readStdin();

  let mod: Partial<SkillModule>;
  try {
    mod = (await import(pathToFileURL(file).href)) as Partial<SkillModule>;
  } catch (e) {
    say({ ok: false, error: `import xatosi: ${(e as Error).message.split('\n')[0]}` });
    return;
  }

  const check = validateMetadata(mod.SKILL);
  if (!check.ok) {
    say({ ok: false, error: check.problems.join('; ') });
    return;
  }
  if (typeof mod.execute !== 'function') {
    say({ ok: false, error: 'execute() eksport qilinmagan' });
    return;
  }

  const metadata = mod.SKILL as SkillMetadata;

  // Argumentsiz chaqiruv — faqat tekshiruv
  if (!args) {
    say({ ok: true, metadata });
    return;
  }

  const problems = validateArgs(metadata, args);
  if (problems.length) {
    say({ ok: false, metadata, error: `Argumentlar: ${problems.join('; ')}` });
    return;
  }

  try {
    // Sandboxda ctx yo'q — navyk faqat argumentlar bilan ishlashi tekshiriladi.
    // Ctx ga murojaat qilsa, shu yerda xato bo'ladi va biz buni ko'ramiz.
    const value = await mod.execute(args, undefined as never);
    say({ ok: true, metadata, value: JSON.parse(JSON.stringify(value ?? null)) as unknown });
  } catch (e) {
    say({ ok: false, metadata, error: (e as Error).message });
  }
}

void main();
