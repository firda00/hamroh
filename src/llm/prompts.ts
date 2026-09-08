import type { LlmTask } from './provider.ts';

/**
 * Promptlar bitta joyda — Claude ham, lokal model ham aynan bir xil vazifani oladi.
 * Shu sabab modellarni solishtirish adolatli bo'ladi (scripts/eval-llm.ts).
 */

export const SYSTEM = [
  'Sen — Hamroh, foydalanuvchining shaxsiy yordamchisisan (O‘zbekiston, Toshkent).',
  'Javoblarni FAQAT o‘zbek tilida (lotin alifbosida) yoz.',
  'Qisqa va aniq gapir. Raqamlarni o‘ylab topma — faqat berilgan faktlarga tayan.',
  'Ma’lumot yetarli bo‘lmasa, "ma’lumot yetarli emas" deb ayt.',
].join(' ');

export type PromptSpec = {
  text: string;
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  /** Lokal modellar uchun: past temperatura = barqaror natija. */
  temperature: number;
};

export function buildPrompt(task: LlmTask): PromptSpec {
  switch (task.kind) {
    case 'summarize':
      return {
        text: [
          `Quyidagi matnni ${task.maxSentences ?? 3} ta gapda o‘zbekcha qisqartir.`,
          task.hint ? `E'tibor ber: ${task.hint}` : '',
          'Faqat qisqartmani yoz, kirish so‘zsiz.',
          '---',
          task.text,
        ]
          .filter(Boolean)
          .join('\n'),
        effort: 'low',
        maxTokens: 2000,
        temperature: 0.3,
      };

    case 'classify':
      return {
        text: [
          'Quyidagi matn qaysi toifaga kiradi?',
          `Toifalar: ${task.labels.join(', ')}`,
          'Javobda FAQAT bitta toifa nomini yoz. Boshqa hech narsa yozma.',
          '---',
          task.text,
        ].join('\n'),
        effort: 'low',
        maxTokens: 100,
        temperature: 0,
      };

    case 'advise':
      return {
        text: [
          `Mavzu: ${task.topic}`,
          'Faktlar:',
          ...task.facts.map((f) => `- ${f}`),
          '',
          task.question ?? 'Shu faktlar asosida 3-5 ta amaliy maslahat ber. Har biri bitta gap.',
          '',
          'Faqat yuqoridagi faktlarga tayan. Yangi raqam o‘ylab topma.',
        ].join('\n'),
        effort: 'medium',
        maxTokens: 4000,
        temperature: 0.4,
      };

    case 'route':
      return {
        text: [
          'Foydalanuvchi gapini buyruqqa aylantir.',
          '',
          'Mavjud buyruqlar:',
          task.catalog,
          '',
          'Javobni FAQAT JSON ko‘rinishida ber, boshqa hech narsa yozma:',
          '{"module":"...","command":"...","args":["..."],"explain":"o‘zbekcha bir gap"}',
          'Mos buyruq bo‘lmasa: {"module":"","command":"","args":[],"explain":"sabab"}',
          'Sana/vaqtni "YYYY-MM-DD HH:MM" ko‘rinishida yoz. Summani faqat raqam bilan yoz.',
          '',
          'Gap:',
          task.text,
        ].join('\n'),
        effort: 'low',
        maxTokens: 700,
        temperature: 0,
      };

    case 'chat':
      return { text: task.prompt, effort: 'medium', maxTokens: 8000, temperature: 0.6 };
  }
}

export function systemFor(task: LlmTask): string {
  return task.kind === 'chat' && task.system ? `${SYSTEM}\n\n${task.system}` : SYSTEM;
}

/**
 * Reasoning modellari (Qwen3, DeepSeek-R1 va h.k.) javob oldidan <think> blok yozadi.
 * Foydalanuvchiga u kerak emas.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

/** classify natijasidan yorliqni ajratib olish. */
export function matchLabel(text: string, labels: string[]): { label: string; confidence: number } {
  const clean = stripThinking(text).toLowerCase();
  const exact = labels.find((l) => clean.trim() === l.toLowerCase());
  if (exact) return { label: exact, confidence: 0.95 };
  const contained = labels.find((l) => clean.includes(l.toLowerCase()));
  if (contained) return { label: contained, confidence: 0.8 };
  return { label: labels[0] ?? '', confidence: 0.2 };
}
