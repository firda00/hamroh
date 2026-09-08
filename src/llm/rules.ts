import type { LlmProvider, LlmResult, LlmTask } from './provider.ts';

/**
 * Bosqich 1 provayderi: model yo'q, faqat qoidalar.
 * Sekin emas, bepul, internetsiz ishlaydi va natijasi har doim bir xil.
 */

const STOP = new Set([
  'va', 'bilan', 'uchun', 'ham', 'lekin', 'ammo', 'yoki', 'bu', 'shu', 'u', 'men', 'siz',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were',
  'и', 'в', 'на', 'с', 'по', 'что', 'это', 'для', 'не', 'как',
]);

const words = (s: string): string[] =>
  s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));

const sentences = (s: string): string[] =>
  s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 20);

/** Ekstraktiv qisqartma: eng "og'ir" gaplarni tanlaydi (mini TextRank). */
function summarize(text: string, maxSentences: number): string {
  const sents = sentences(text);
  if (sents.length <= maxSentences) return sents.join(' ') || text.trim().slice(0, 400);

  const freq = new Map<string, number>();
  for (const w of words(text)) freq.set(w, (freq.get(w) ?? 0) + 1);

  const scored = sents.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0) / Math.sqrt(ws.length || 1);
    return { s, i, score: score + (i === 0 ? 2 : 0) };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s)
    .join(' ');
}

/** Kalit so'zlar ustma-ustligi bo'yicha yorliq tanlash. */
function classify(text: string, labels: string[]): { label: string; confidence: number } {
  const t = ` ${text.toLowerCase()} `;
  const tw = new Set(words(text));
  let best = labels[0] ?? '';
  let bestScore = 0;

  for (const label of labels) {
    const parts = label.toLowerCase().split(/[|/,\s]+/).filter(Boolean);
    let score = 0;
    for (const p of parts) {
      if (p.length > 2 && t.includes(p)) score += 2;
      if (tw.has(p)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  const confidence = bestScore === 0 ? 0.2 : Math.min(0.95, 0.4 + bestScore * 0.15);
  return { label: best, confidence };
}

export function rulesProvider(): LlmProvider {
  return {
    id: 'rules',
    smart: false,
    run: async (task: LlmTask): Promise<LlmResult> => {
      switch (task.kind) {
        case 'summarize':
          return { text: summarize(task.text, task.maxSentences ?? 3), provider: 'rules' };

        case 'classify': {
          const { label, confidence } = classify(task.text, task.labels);
          return { text: label, label, confidence, provider: 'rules' };
        }

        case 'advise': {
          // Qoidaviy rejimda "maslahat" — bu faktlarning tartiblangan ro'yxati.
          const lines = task.facts.length
            ? task.facts.map((f) => `- ${f}`)
            : ['- Yetarli ma’lumot yo’q.'];
          return {
            text: [`${task.topic}:`, ...lines, '', '(LLM ulanmagan — bu faktlar ro’yxati, tahlil emas.)'].join('\n'),
            provider: 'rules',
          };
        }

        case 'route':
          // Qoidaviy tanish alohida modulda (src/intent/rules.ts) — bu yerda emas.
          return { text: '', provider: 'rules' };

        case 'chat':
          return {
            text:
              'LLM ulanmagan (HAMROH_LLM=rules). Erkin savollar bosqich 2 da ishlaydi:\n' +
              '  1) npm install @anthropic-ai/sdk\n' +
              '  2) .env ichida ANTHROPIC_API_KEY va HAMROH_LLM=anthropic',
            provider: 'rules',
          };
      }
    },
  };
}
