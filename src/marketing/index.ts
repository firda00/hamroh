import type { Config } from '../core/config.ts';
import type { Db } from '../core/db.ts';
import type { MarketingSource } from './provider.ts';
import { disabledSource } from './provider.ts';
import { oauthAuth } from '../google/auth.ts';
import type { GoogleAuth } from '../google/auth.ts';
import { instagramSource } from './instagram.ts';
import { googleAdsSource } from './googleads.ts';
import { youtubeSource } from './youtube.ts';
import { gbpSource } from './gbp.ts';

/**
 * Barcha marketing manbalari bir joyda.
 *
 * Google Ads, YouTube va Business Profile bitta Google hisobiga tayanadi —
 * shuning uchun bitta refresh token yetadi, lekin rozilik paytida uchala
 * ruxsat ham so'ralgan bo'lishi kerak (`hamroh marketing ulash`).
 */

export function makeSources(cfg: Config, db: Db): MarketingSource[] {
  const google: GoogleAuth | null =
    cfg.googleClientId && cfg.googleClientSecret && cfg.googleRefreshToken
      ? oauthAuth(db, cfg.googleClientId, cfg.googleClientSecret, cfg.googleRefreshToken)
      : null;

  return [
    instagramSource(cfg.instagramToken, cfg.instagramUserId, cfg.instagramMetrics),
    googleAdsSource(google, cfg.adsDeveloperToken, cfg.adsCustomerId, cfg.adsLoginCustomerId),
    youtubeSource(google, cfg.youtubeChannelId),
    gbpSource(google, cfg.gbpLocationId),
    // 2GIS ochiq API bermaydi. Sahifani «qirqib olish» ularning shartlarini
    // buzadi va hisobni bloklashga olib keladi — shuning uchun qilinmaydi.
    disabledSource(
      '2gis',
      '2GIS ochiq API bermaydi. Kabinetdan statistikani CSV qilib yuklang: hamroh marketing import fayl.csv',
    ),
  ];
}

export type { MarketingSource } from './provider.ts';
