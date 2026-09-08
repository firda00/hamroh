import type { Config } from '../core/config.ts';
import type { TtsProvider } from './provider.ts';
import { disabledTts } from './provider.ts';
import { httpTts } from './http.ts';
import { cmdTts } from './cmd.ts';

/** HAMROH_TTS bo'yicha provayder tanlash. */
export function makeTts(cfg: Config): TtsProvider {
  if (cfg.tts === 'http') {
    return httpTts({
      url: cfg.ttsUrl,
      model: cfg.ttsModel,
      voice: cfg.ttsVoice,
      format: cfg.ttsFormat,
      apiKey: cfg.ttsKey,
    });
  }
  if (cfg.tts === 'cmd' && cfg.ttsCmd) {
    return cmdTts({ command: cfg.ttsCmd, ext: cfg.ttsFormat });
  }
  return disabledTts();
}

export type { TtsProvider, Speech } from './provider.ts';
