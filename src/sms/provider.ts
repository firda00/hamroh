/**
 * SMS shlyuzi chegarasi.
 *
 * STT/TTS/telefon bilan bir xil tamoyil: modullar aniq provayder bilan emas,
 * shu interfeys bilan ishlaydi.
 */

export type SmsResult = {
  ok: boolean;
  /** Provayderdagi xabar identifikatori — holatini keyin so'rash uchun. */
  id?: string;
  provider: string;
  note?: string;
};

export type SmsProvider = {
  id: string;
  enabled: boolean;
  send: (to: string, text: string) => Promise<SmsResult>;
  /** Qolgan balans (provayder qo'llab-quvvatlasa). */
  balance?: () => Promise<string>;
};

export function disabledSms(): SmsProvider {
  return {
    id: 'off',
    enabled: false,
    send: () =>
      Promise.reject(
        new Error(
          [
            'SMS shlyuzi ulanmagan (HAMROH_SMS=off).',
            '',
            'Eskiz (O‘zbekiston):',
            '  HAMROH_SMS=eskiz',
            '  ESKIZ_EMAIL=...',
            '  ESKIZ_PASSWORD=...',
            '',
            'Yoki istalgan boshqa shlyuz:',
            '  HAMROH_SMS=cmd',
            '  HAMROH_SMS_CMD=./yubor.sh {to} {text}',
            '',
            'Batafsil: docs/SMS.md',
          ].join('\n'),
        ),
      ),
  };
}

/** Eskiz raqamni "998901234567" ko'rinishida kutadi — plyussiz. */
export function smsNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return `998${digits}`;
  return digits;
}

/**
 * SMS uzunligi: lotin uchun 160, kirill/o'zbekcha maxsus harflar uchun 70 belgi.
 * Bir nechta qismga bo'linsa narx ham shuncha barobar oshadi — shuni oldindan ko'rsatamiz.
 */
export function smsParts(text: string): { parts: number; unicode: boolean; length: number } {
  const unicode = /[^\u0020-\u007E]/.test(text);
  const limit = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const length = text.length;
  const parts = length <= limit ? 1 : Math.ceil(length / multi);
  return { parts, unicode, length };
}
