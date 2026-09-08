/**
 * LLM chegarasi (bosqichlar orasidagi "shov").
 *
 * Bosqich 1 — `rules` provayderi: LLM'siz, deterministik. Hamma modul shu interfeys
 * orqali ishlaydi, shuning uchun bosqich 2'da HAMROH_LLM=anthropic qilib qo'yilsa,
 * modullar kodiga tegmasdan sifat oshadi.
 */

export type LlmTask =
  /** Uzun matnni qisqartirish (yangiliklar, hisobotlar). */
  | { kind: 'summarize'; text: string; maxSentences?: number; hint?: string }
  /** Matnni berilgan yorliqlardan biriga ajratish (xarajat kategoriyasi, lid manbasi). */
  | { kind: 'classify'; text: string; labels: string[] }
  /** Faktlar asosida maslahat berish (moliya, marketing, yuridik). */
  | { kind: 'advise'; topic: string; facts: string[]; question?: string }
  /** Erkin so'rov. */
  | { kind: 'chat'; system?: string; prompt: string }
  /** Odam gapini modul buyrug'iga aylantirish (ovozli buyruqlar uchun). */
  | { kind: 'route'; text: string; catalog: string };

export type LlmResult = {
  text: string;
  /** Qaysi provayder javob berdi. */
  provider: string;
  /** `classify` uchun tanlangan yorliq. */
  label?: string;
  /** Ishonch darajasi 0..1 (qoidaviy provayderda taxminiy). */
  confidence?: number;
};

export type LlmProvider = {
  id: string;
  /** Haqiqiy model ulanganmi? Modullar shunga qarab ogohlantirish yozadi. */
  smart: boolean;
  run: (task: LlmTask) => Promise<LlmResult>;
};
