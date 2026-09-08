import type { Config } from '../core/config.ts';
import type { LlmProvider, LlmTask } from './provider.ts';
import { rulesProvider } from './rules.ts';
import { anthropicProvider } from './anthropic.ts';
import { localProvider } from './local.ts';
import { logger } from '../core/logger.ts';

const log = logger('llm');

/** Tanlangan provayderni qoidaviy rejim bilan o'raydi — brifing hech qachon to'xtamaydi. */
function withFallback(smart: LlmProvider): LlmProvider {
  const fallback = rulesProvider();
  return {
    id: smart.id,
    smart: true,
    run: async (task: LlmTask) => {
      try {
        return await smart.run(task);
      } catch (e) {
        log.warn(`${smart.id} javob bermadi (${(e as Error).message}) — qoidaviy rejim.`);
        return fallback.run(task);
      }
    },
  };
}

/**
 * Provayder tanlash:
 *   rules     — LLM'siz, deterministik (standart)
 *   local     — o'z serveringizdagi model (Ollama / llama.cpp / vLLM)
 *   anthropic — Claude API
 */
export function makeLlm(cfg: Config): LlmProvider {
  if (cfg.llm === 'local') {
    return withFallback(localProvider({ url: cfg.llmUrl, model: cfg.llmModel, apiKey: cfg.llmKey }));
  }

  if (cfg.llm === 'anthropic') {
    if (!cfg.anthropicKey) {
      log.warn('HAMROH_LLM=anthropic, lekin ANTHROPIC_API_KEY yo‘q — qoidaviy rejimga o‘tildi.');
      return rulesProvider();
    }
    return withFallback(anthropicProvider(cfg.anthropicKey, cfg.llmModel));
  }

  return rulesProvider();
}

export type { LlmProvider, LlmTask } from './provider.ts';
