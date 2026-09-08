import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CallProvider, CallRequest, CallResult } from './provider.ts';

/**
 * Twilio orqali qo'ng'iroq.
 *
 * Muhim cheklov: Twilio ovozni URL dan oladi (`<Play>`), ya'ni audio fayl
 * internetdan ochiladigan bo'lishi kerak. Shuning uchun:
 *   - `npm run serve` ishlab turishi va domen orqali ochiq bo'lishi,
 *   - HAMROH_TEL_AUDIO_BASE=https://sizning-domen.uz  qo'yilishi kerak.
 *
 * Domen bo'lmasa — `cmd` provayderi (Asterisk) ishlating, unga URL kerak emas.
 *
 * Twilio ning o'z `<Say>` i o'zbek tilini qo'llab-quvvatlamaydi, shuning uchun
 * biz o'z TTS imizdan foydalanamiz.
 */

export type TwilioOptions = {
  accountSid: string;
  authToken: string;
  from: string;
  /** Ommaviy manzil, masalan https://hamroh.example.uz */
  audioBase: string;
  outDir: string;
};

export function twilioTel(opts: TwilioOptions): CallProvider {
  return {
    id: 'tel:twilio',
    enabled: true,

    call: async (req: CallRequest, audio: { bytes: Uint8Array; ext: string }): Promise<CallResult> => {
      if (!opts.audioBase) {
        throw new Error(
          'HAMROH_TEL_AUDIO_BASE yo‘q. Twilio audio faylni internetdan oladi — ' +
            'ommaviy domen kerak. Domen bo‘lmasa HAMROH_TEL=cmd (Asterisk) ishlating.',
        );
      }

      // Faylni ommaviy papkaga yozamiz. Nom taxmin qilib bo'lmaydigan (UUID) —
      // qo'ng'iroq matni begonaga ochilib qolmasligi uchun.
      const name = `call-${randomUUID()}.${audio.ext}`;
      mkdirSync(join(opts.outDir, 'public'), { recursive: true });
      writeFileSync(join(opts.outDir, 'public', name), audio.bytes);
      const url = `${opts.audioBase.replace(/\/+$/, '')}/audio/${name}`;

      const twiml = `<Response><Play>${url}</Play>${
        req.record ? '<Record maxLength="30" playBeep="true"/>' : ''
      }</Response>`;

      const body = new URLSearchParams({ To: req.to, From: opts.from, Twiml: twiml });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Calls.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });

      const data = (await res.json()) as { sid?: string; message?: string; code?: number };
      if (!res.ok) {
        throw new Error(`Twilio xatosi ${res.status}: ${data.message ?? 'noma’lum'}${data.code ? ` (${data.code})` : ''}`);
      }
      return { ok: true, id: data.sid, provider: 'twilio', note: `audio: ${url}` };
    },
  };
}
