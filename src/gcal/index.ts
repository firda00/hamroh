import type { Config } from '../core/config.ts';
import type { Db } from '../core/db.ts';
import type { GcalClient } from './client.ts';
import { gcalClient, disabledGcal } from './client.ts';
import { oauthAuth, serviceAuth, readServiceKey } from '../google/auth.ts';
import { logger } from '../core/logger.ts';

const log = logger('gcal');

/** HAMROH_GCAL bo'yicha mijoz tanlash. Sozlama chala bo'lsa — o'chirilgan holat. */
export function makeGcal(cfg: Config, db: Db): GcalClient {
  if (cfg.gcal === 'oauth') {
    if (!cfg.googleClientId || !cfg.googleClientSecret || !cfg.googleRefreshToken) {
      log.warn('HAMROH_GCAL=oauth, lekin client_id/secret/refresh_token to‘liq emas — ulanmadi.');
      return disabledGcal();
    }
    const auth = oauthAuth(db, cfg.googleClientId, cfg.googleClientSecret, cfg.googleRefreshToken);
    return gcalClient(auth, cfg.googleCalendarId);
  }

  if (cfg.gcal === 'service') {
    if (!cfg.googleServiceFile) {
      log.warn('HAMROH_GCAL=service, lekin GOOGLE_SERVICE_ACCOUNT_FILE yo‘q — ulanmadi.');
      return disabledGcal();
    }
    try {
      const key = readServiceKey(cfg.googleServiceFile);
      return gcalClient(serviceAuth(db, key, cfg.googleImpersonate), cfg.googleCalendarId);
    } catch (e) {
      log.warn((e as Error).message);
      return disabledGcal();
    }
  }

  return disabledGcal();
}

export type { GcalClient, GEvent, NewEvent } from './client.ts';
