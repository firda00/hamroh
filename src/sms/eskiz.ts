import type { Db } from '../core/db.ts';
import { setting } from '../core/db.ts';
import type { SmsProvider, SmsResult } from './provider.ts';
import { smsNumber } from './provider.ts';
import { logger } from '../core/logger.ts';

/**
 * Eskiz.uz — O'zbekistondagi eng keng tarqalgan SMS shlyuzi.
 *
 * Token 30 kunga beriladi, shuning uchun u `settings` jadvalida saqlanadi —
 * har bir SMS uchun qaytadan login qilinmaydi. 401 kelsa bir marta qayta kiriladi.
 *
 * MUHIM: Eskiz ixtiyoriy matn yubortirmaydi — matn oldindan moderatsiyadan
 * o'tgan shablonga mos bo'lishi kerak. Sinov rejimida faqat maxsus test matni
 * ketadi. Batafsil: docs/SMS.md
 */

const log = logger('eskiz');
const TOKEN_KEY = 'eskiz:token';
const TOKEN_AT = 'eskiz:token_at';
const TOKEN_TTL_MS = 25 * 24 * 3600_000; // 30 kundan xavfsiz kamroq

export type EskizOptions = {
  db: Db;
  email: string;
  password: string;
  /** Jo'natuvchi nomi. 4546 — Eskiz ning sinov raqami. */
  from: string;
  base: string;
};

type LoginResponse = { data?: { token?: string }; message?: string };
type SendResponse = { id?: string | number; status?: string; message?: string };

async function login(opts: EskizOptions): Promise<string> {
  const form = new FormData();
  form.append('email', opts.email);
  form.append('password', opts.password);

  const res = await fetch(`${opts.base}/auth/login`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as LoginResponse;
  const token = data.data?.token;
  if (!res.ok || !token) {
    throw new Error(`Eskiz: kirish amalga oshmadi (${res.status}) — ${data.message ?? 'email/parolni tekshiring'}`);
  }

  setting.set(opts.db, TOKEN_KEY, token);
  setting.set(opts.db, TOKEN_AT, String(Date.now()));
  log.info('token yangilandi');
  return token;
}

async function token(opts: EskizOptions, force = false): Promise<string> {
  if (!force) {
    const saved = setting.get(opts.db, TOKEN_KEY);
    const at = Number(setting.get(opts.db, TOKEN_AT, '0'));
    if (saved && Date.now() - at < TOKEN_TTL_MS) return saved;
  }
  return login(opts);
}

export function eskizSms(opts: EskizOptions): SmsProvider {
  /** So'rov yuboradi; 401 bo'lsa bir marta qayta kirib takrorlaydi. */
  const call = async (path: string, init: RequestInit, retry = true): Promise<Response> => {
    const auth = await token(opts, !retry);
    const res = await fetch(`${opts.base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${auth}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && retry) {
      log.warn('token eskirgan — qayta kirilmoqda');
      return call(path, init, false);
    }
    return res;
  };

  return {
    id: `sms:eskiz(${opts.from})`,
    enabled: true,

    send: async (to: string, text: string): Promise<SmsResult> => {
      const form = new FormData();
      form.append('mobile_phone', smsNumber(to));
      form.append('message', text);
      form.append('from', opts.from);

      const res = await call('/message/sms/send', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as SendResponse;

      if (!res.ok) {
        // Eng ko'p uchraydigan sabab — matn shablonga mos emas
        const hint =
          res.status === 400
            ? ' (ehtimol matn moderatsiyadan o‘tgan shablonga mos emas — docs/SMS.md)'
            : '';
        throw new Error(`Eskiz xatosi ${res.status}: ${data.message ?? 'noma’lum'}${hint}`);
      }
      return { ok: true, id: data.id ? String(data.id) : undefined, provider: 'eskiz', note: data.status };
    },

    balance: async (): Promise<string> => {
      const res = await call('/user/get-limit', { method: 'GET' });
      const data = (await res.json().catch(() => ({}))) as { data?: { balance?: number } };
      const value = data.data?.balance;
      return value === undefined ? 'noma’lum' : `${value}`;
    },
  };
}
