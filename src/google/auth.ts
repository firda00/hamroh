import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Db } from '../core/db.ts';
import { setting } from '../core/db.ts';
import { logger } from '../core/logger.ts';

/**
 * Google uchun kirish tokeni olish — SDK'siz.
 *
 * Ikki yo'l:
 *   oauth   — shaxsiy Gmail hisobi. Bir marta brauzerda ruxsat beriladi,
 *             so'ng refresh token bilan cheksiz ishlaydi.
 *   service — xizmat hisobi. Brauzer umuman kerak emas (server uchun qulay),
 *             lekin kalendarni xizmat hisobi emailiga ulashish kerak.
 *
 * Kirish tokeni 1 soat yashaydi va `settings` jadvalida keshlanadi.
 */

const log = logger('google');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Kerak bo‘lgan ruxsatlar. Bittasi ham ortiqcha so‘ralmaydi. */
export const SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar',
  ads: 'https://www.googleapis.com/auth/adwords',
  youtube: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  gbp: 'https://www.googleapis.com/auth/business.manage',
} as const;

export const CALENDAR_SCOPE = SCOPES.calendar;

/** Marketing uchun kerak bo‘ladigan ruxsatlar to‘plami. */
export const MARKETING_SCOPES = [SCOPES.ads, SCOPES.youtube, SCOPES.gbp];

const short = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

export type GoogleAuth = {
  mode: 'oauth' | 'service';
  /** Kim nomidan ishlayapmiz — diagnostika uchun. */
  who: string;
  accessToken: () => Promise<string>;
};

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };

async function requestToken(body: URLSearchParams): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token olinmadi (${res.status}): ${data.error_description ?? data.error ?? 'noma’lum'}`,
    );
  }
  return { token: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

/** Keshlangan token yoki yangisini oladi. */
function cached(
  db: Db,
  slot: string,
  fetchNew: () => Promise<{ token: string; expiresIn: number }>,
): () => Promise<string> {
  const CACHE_KEY = `google:tok:${slot}`;
  const CACHE_EXP = `google:exp:${slot}`;
  return async () => {
    const token = setting.get(db, CACHE_KEY);
    const exp = Number(setting.get(db, CACHE_EXP, '0'));
    // 60 soniya zaxira bilan
    if (token && Date.now() < exp - 60_000) return token;

    const fresh = await fetchNew();
    setting.set(db, CACHE_KEY, fresh.token);
    setting.set(db, CACHE_EXP, String(Date.now() + fresh.expiresIn * 1000));
    log.debug(`kirish tokeni yangilandi (${slot})`);
    return fresh.token;
  };
}

/** Shaxsiy hisob: refresh token orqali. */
export function oauthAuth(db: Db, clientId: string, clientSecret: string, refreshToken: string): GoogleAuth {
  // Refresh token yangilanganda kesh o'z-o'zidan boshqa uyaga tushadi.
  // Ruxsatlar rozilik paytida belgilangan, shuning uchun scope bu yerda uzatilmaydi.
  return {
    mode: 'oauth',
    who: 'shaxsiy hisob',
    accessToken: cached(db, short(refreshToken), () =>
      requestToken(
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      ),
    ),
  };
}

export type ServiceKey = { client_email: string; private_key: string };

/** Xizmat hisobi JSON kalitini o'qiydi. */
export function readServiceKey(path: string): ServiceKey {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Xizmat hisobi kaliti o‘qilmadi: ${path}`);
  }
  const key = JSON.parse(raw) as Partial<ServiceKey>;
  if (!key.client_email || !key.private_key) {
    throw new Error(`${path}: client_email yoki private_key yo‘q — bu Google xizmat hisobi kaliti emas`);
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

/** Xizmat hisobi: o'zi imzolagan JWT ni tokenga almashtiradi. */
export function serviceAuth(db: Db, key: ServiceKey, subject = '', scope: string = SCOPES.calendar): GoogleAuth {
  return {
    mode: 'service',
    who: key.client_email,
    accessToken: cached(db, short(`${key.client_email}|${scope}|${subject}`), () => {
      const now = Math.floor(Date.now() / 1000);
      const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claim = b64url(
        JSON.stringify({
          iss: key.client_email,
          scope,
          aud: TOKEN_URL,
          iat: now,
          exp: now + 3600,
          ...(subject ? { sub: subject } : {}),
        }),
      );
      const signature = b64url(
        createSign('RSA-SHA256').update(`${header}.${claim}`).sign(key.private_key),
      );

      return requestToken(
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${header}.${claim}.${signature}`,
        }),
      );
    }),
  };
}

/** Brauzerda ochiladigan ruxsat havolasi. */
export function consentUrl(
  clientId: string,
  redirectUri: string,
  scopes: readonly string[] = [SCOPES.calendar],
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent', // refresh_token har doim qaytishi uchun
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Ruxsat kodini refresh tokenga almashtiradi. */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse & { refresh_token?: string };
  if (!res.ok || !data.refresh_token) {
    throw new Error(
      `Kod almashtirilmadi (${res.status}): ${data.error_description ?? data.error ?? 'refresh_token qaytmadi'}`,
    );
  }
  return { refreshToken: data.refresh_token, accessToken: data.access_token ?? '' };
}
