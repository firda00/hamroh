import type { Config } from '../core/config.ts';
import type { CallProvider } from './provider.ts';
import { disabledTel, normalizeNumber } from './provider.ts';
import { cmdTel } from './cmd.ts';
import { twilioTel } from './twilio.ts';

/** HAMROH_TEL bo'yicha provayder tanlash. */
export function makeTel(cfg: Config): CallProvider {
  if (cfg.tel === 'cmd' && cfg.telCmd) {
    return cmdTel({ command: cfg.telCmd, outDir: cfg.outDir });
  }
  if (cfg.tel === 'twilio' && cfg.twilioSid && cfg.twilioToken && cfg.twilioFrom) {
    return twilioTel({
      accountSid: cfg.twilioSid,
      authToken: cfg.twilioToken,
      from: cfg.twilioFrom,
      audioBase: cfg.telAudioBase,
      outDir: cfg.outDir,
    });
  }
  return disabledTel();
}

/**
 * Qaysi raqamlarga qo'ng'iroq qilish mumkin.
 *
 * Ro'yxat ataylab qattiq: agent noto'g'ri tushunilgan gap tufayli begona odamga
 * qo'ng'iroq qilib yubormasligi kerak. Ro'yxat bo'sh bo'lsa — hech kimga.
 */
export function allowedNumbers(cfg: Config): string[] {
  return [...new Set([cfg.telMyNumber, ...cfg.telAllowed].filter(Boolean).map(normalizeNumber))];
}

export function isAllowedNumber(cfg: Config, raw: string): boolean {
  return allowedNumbers(cfg).includes(normalizeNumber(raw));
}

export type { CallProvider, CallRequest, CallResult } from './provider.ts';
export { normalizeNumber } from './provider.ts';
