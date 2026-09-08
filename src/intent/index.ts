import type { Ctx, CommandResult, Module } from '../core/types.ts';
import type { Intent } from './types.ts';
import { needsConfirmation } from './types.ts';
import { routeByRules } from './rules.ts';
import { stripThinking } from '../llm/prompts.ts';
import { logger } from '../core/logger.ts';

const log = logger('intent');

/** LLM ga beriladigan buyruqlar ro'yxati. */
export function catalog(modules: Module[]): string {
  return modules
    .flatMap((m) => m.commands.map((c) => `${m.id} ${c.name} — ${c.about} (${c.usage})`))
    .join('\n');
}

type LlmRoute = { module?: string; command?: string; args?: unknown[]; explain?: string };

/** Model javobidan JSON ni ajratib olish (atrofidagi matnga chidamli). */
export function parseLlmRoute(raw: string): LlmRoute | null {
  const text = stripThinking(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as LlmRoute;
  } catch {
    return null;
  }
}

/**
 * Odam gapini buyruqqa aylantiradi.
 * Avval qoidalar (tez, bepul, aniq), keyin LLM (ulangan bo'lsa).
 */
export async function route(ctx: Ctx, text: string, modules: Module[]): Promise<Intent | null> {
  const byRules = routeByRules(ctx, text);
  if (byRules) return byRules;
  if (!ctx.llm.smart) return null;

  try {
    const res = await ctx.llm.run({ kind: 'route', text, catalog: catalog(modules) });
    const parsed = parseLlmRoute(res.text);
    if (!parsed?.module || !parsed.command) return null;

    const mod = modules.find((m) => m.id === parsed.module);
    if (!mod?.commands.some((c) => c.name === parsed.command)) {
      log.warn(`Model mavjud bo‘lmagan buyruq berdi: ${parsed.module} ${parsed.command}`);
      return null;
    }
    return {
      module: parsed.module,
      command: parsed.command,
      args: (parsed.args ?? []).map(String),
      confidence: 0.7,
      explain: parsed.explain ?? `${parsed.module} ${parsed.command}`,
      needsConfirm: needsConfirmation(parsed.module, parsed.command),
      source: 'llm',
    };
  } catch (e) {
    log.warn(`LLM buyruq tanish xatosi: ${(e as Error).message}`);
    return null;
  }
}

/** Aniqlangan buyruqni bajaradi. */
export async function execute(ctx: Ctx, intent: Intent, modules: Module[]): Promise<CommandResult> {
  const mod = modules.find((m) => m.id === intent.module);
  const cmd = mod?.commands.find((c) => c.name === intent.command);
  if (!mod || !cmd) throw new Error(`Buyruq topilmadi: ${intent.module} ${intent.command}`);
  return cmd.run(ctx, intent.args);
}

/** Bajarilmagan buyruq uchun tushuntirish. */
export function describe(intent: Intent): string {
  return `${intent.explain}\n   → hamroh ${intent.module} ${intent.command} ${intent.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
}
