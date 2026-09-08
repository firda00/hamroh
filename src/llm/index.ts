import type { Config } from '../core/config.ts';
import type { LlmProvider, LlmTask } from './provider.ts';
import { rulesProvider } from './rules.ts';
import { anthropicProvider } from './anthropic.ts';
import { logger } from '../core/logger.ts';

const log = logger('llm');

/**
 * Provayder tanlash. Anthropic tanlangan-u, lekin kalit yo'q bo'lsa —
 * jim qolmasdan ogohlantiradi va qoidaviy rejimga tushadi.
 */
export function makeLlm(cfg: Config): LlmProvider {
  if (cfg.llm !== 'anthropic') return rulesProvider();
  if (!cfg.anthropicKey) {
    log.warn('HAMROH_LLM=anthropic, lekin ANTHROPIC_API_KEY yo‘q — qoidaviy rejimga o‘tildi.');
    return rulesProvider();
  }
  const smart = anthropicProvider(cfg.anthropicKey, cfg.llmModel);
  const fallback = rulesProvider();
  // Tarmoq uzilsa ham kunlik brifing to'xtab qolmasligi kerak.
  return {
    id: smart.id,
    smart: true,
    run: async (task: LlmTask) => {
      try {
        return await smart.run(task);
      } catch (e) {
        log.warn(`Claude javob bermadi (${(e as Error).message}) — qoidaviy rejim.`);
        return fallback.run(task);
      }
    },
  };
}

export type { LlmProvider, LlmTask } from './provider.ts';
