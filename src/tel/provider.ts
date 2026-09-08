/**
 * Telefon qo'ng'irog'i chegarasi.
 *
 * STT/TTS bilan bir xil tamoyil: modullar aniq operator bilan emas, shu interfeys
 * bilan ishlaydi. Shuning uchun Asterisk, Twilio yoki mahalliy shlyuz — farqi yo'q.
 */

export type CallRequest = {
  /** Kimga — xalqaro formatda: +998901234567 */
  to: string;
  /** Aytiladigan matn (TTS provayderi orqali ovozga aylantiriladi). */
  text: string;
  /** Javobni yozib olishga urinish (operator qo'llab-quvvatlasa). */
  record?: boolean;
};

export type CallResult = {
  ok: boolean;
  /** Operatordagi qo'ng'iroq identifikatori. */
  id?: string;
  /** Yozib olingan javob fayli (bo'lsa) — keyin matnga o'giriladi. */
  recordingPath?: string;
  provider: string;
  note?: string;
};

export type CallProvider = {
  id: string;
  enabled: boolean;
  /** Audio TTS orqali oldindan tayyorlanib beriladi. */
  call: (req: CallRequest, audio: { bytes: Uint8Array; ext: string }) => Promise<CallResult>;
};

export function disabledTel(): CallProvider {
  return {
    id: 'off',
    enabled: false,
    call: () =>
      Promise.reject(
        new Error(
          [
            'Telefon qo‘ng‘irog‘i yoqilmagan (HAMROH_TEL=off).',
            '',
            'Ikki yo‘l bor:',
            '  1) O‘z serveringizdagi Asterisk yoki mahalliy shlyuz:',
            '       HAMROH_TEL=cmd',
            '       HAMROH_TEL_CMD=/opt/hamroh/scripts/tel/asterisk-call.sh {to} {audio}',
            '  2) Twilio (xalqaro, ommaviy audio havolasi kerak):',
            '       HAMROH_TEL=twilio',
            '',
            'Batafsil: docs/CALLS.md',
          ].join('\n'),
        ),
      ),
  };
}

/** Raqamni bir ko'rinishga keltiradi: 901234567 -> +998901234567 */
export function normalizeNumber(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('998')) return `+${digits}`;
  if (digits.length === 9) return `+998${digits}`;
  return `+${digits}`;
}
