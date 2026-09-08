import type { Config } from '../core/config.ts';
import type { SttProvider } from './provider.ts';
import { disabledStt } from './provider.ts';
import { localStt } from './local.ts';

/** HAMROH_STT bo'yicha provayder tanlash. */
export function makeStt(cfg: Config): SttProvider {
  if (cfg.stt !== 'local') return disabledStt();
  return localStt({
    url: cfg.sttUrl,
    model: cfg.sttModel,
    language: cfg.sttLang,
    apiKey: cfg.sttKey,
    hint: cfg.sttHint,
  });
}

export type { SttProvider, Transcript } from './provider.ts';
