import type { Config } from '../core/config.ts';
import type { Db } from '../core/db.ts';
import type { SmsProvider } from './provider.ts';
import { disabledSms } from './provider.ts';
import { eskizSms } from './eskiz.ts';
import { cmdSms } from './cmd.ts';

/** HAMROH_SMS bo'yicha provayder tanlash. */
export function makeSms(cfg: Config, db: Db): SmsProvider {
  if (cfg.sms === 'eskiz' && cfg.eskizEmail && cfg.eskizPassword) {
    return eskizSms({
      db,
      email: cfg.eskizEmail,
      password: cfg.eskizPassword,
      from: cfg.eskizFrom,
      base: cfg.eskizBase,
    });
  }
  if (cfg.sms === 'cmd' && cfg.smsCmd) {
    return cmdSms({ command: cfg.smsCmd });
  }
  return disabledSms();
}

export type { SmsProvider, SmsResult } from './provider.ts';
export { smsNumber, smsParts } from './provider.ts';
