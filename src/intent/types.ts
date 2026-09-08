/** Ovozli yoki matnli buyruqni modul buyrug'iga aylantirish natijasi. */

export type Intent = {
  module: string;
  command: string;
  args: string[];
  /** 0..1 — past bo'lsa tasdiq so'raladi. */
  confidence: number;
  /** Qanday tushunilgani — foydalanuvchiga ko'rsatiladi. */
  explain: string;
  /** Tashqariga ta'sir qiladigan amal (SMS, xabar yuborish) — avtomatik bajarilmaydi. */
  needsConfirm: boolean;
  /** Kim aniqladi: qoidalar yoki model. */
  source: 'rules' | 'llm';
};

/**
 * Tashqi dunyoga chiqadigan yoki qaytarib bo'lmaydigan buyruqlar.
 * Bular ovozdan avtomatik bajarilmaydi — avval tasdiq so'raladi.
 */
export const CONFIRM_REQUIRED = new Set([
  'telegram:send',
  'telegram:file',
  'telegram:reply',
  'aloqa:sms',
  'qongiroq:qil',
  'vazifa:rm',
  'kalendar:rm',
]);

export const needsConfirmation = (module: string, command: string): boolean =>
  CONFIRM_REQUIRED.has(`${module}:${command}`);
