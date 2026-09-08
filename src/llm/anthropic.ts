import type { LlmProvider, LlmResult, LlmTask } from './provider.ts';

/**
 * Bosqich 2 provayderi — rasmiy Anthropic SDK orqali Claude.
 *
 * SDK ixtiyoriy bog'liqlik: bosqich 1 da o'rnatilmagan bo'ladi va loyiha baribir ishlaydi.
 * Yoqish:
 *   npm install @anthropic-ai/sdk
 *   .env:  HAMROH_LLM=anthropic  va  ANTHROPIC_API_KEY=sk-ant-...
 */

type TextBlock = { type: string; text?: string };
type Message = { content: TextBlock[] };
type Client = {
  messages: {
    stream: (params: Record<string, unknown>) => { finalMessage: () => Promise<Message> };
  };
};

const SYSTEM = [
  'Sen — Hamroh, foydalanuvchining shaxsiy yordamchisisan (O‘zbekiston, Toshkent).',
  'Javoblar o‘zbek tilida, qisqa va aniq bo‘lsin. Raqamlarni o‘ylab topma —',
  'faqat berilgan faktlarga tayan. Bilmasang, "ma’lumot yetarli emas" deb ayt.',
].join(' ');

/** SDK o'rnatilmagan bo'lsa tushunarli xato beradi. */
async function loadClient(apiKey: string): Promise<Client> {
  // Literal bo'lmagan spetsifikator — SDK yo'q paytda ham typecheck o'tadi.
  const specifier = '@anthropic-ai/sdk';
  let mod: { default: new (opts: { apiKey: string }) => Client };
  try {
    mod = (await import(specifier)) as { default: new (opts: { apiKey: string }) => Client };
  } catch {
    throw new Error(
      'Anthropic SDK topilmadi. Avval o‘rnating:  npm install @anthropic-ai/sdk',
    );
  }
  return new mod.default({ apiKey });
}

function prompt(task: LlmTask): { text: string; effort: 'low' | 'medium' | 'high'; maxTokens: number } {
  switch (task.kind) {
    case 'summarize':
      return {
        text: [
          `Quyidagi matnni ${task.maxSentences ?? 3} ta gapda o‘zbekcha qisqartir.`,
          task.hint ? `E'tibor ber: ${task.hint}` : '',
          '---',
          task.text,
        ].filter(Boolean).join('\n'),
        effort: 'low',
        maxTokens: 2000,
      };
    case 'classify':
      return {
        text: [
          'Quyidagi matn qaysi toifaga kiradi? Faqat bitta toifa nomini yoz, boshqa hech narsa yozma.',
          `Toifalar: ${task.labels.join(', ')}`,
          '---',
          task.text,
        ].join('\n'),
        effort: 'low',
        maxTokens: 100,
      };
    case 'advise':
      return {
        text: [
          `Mavzu: ${task.topic}`,
          'Faktlar:',
          ...task.facts.map((f) => `- ${f}`),
          '',
          task.question ?? 'Shu faktlar asosida 3-5 ta amaliy maslahat ber. Har biri bitta gap.',
        ].join('\n'),
        effort: 'medium',
        maxTokens: 4000,
      };
    case 'chat':
      return { text: task.prompt, effort: 'medium', maxTokens: 8000 };
  }
}

export function anthropicProvider(apiKey: string, model: string): LlmProvider {
  let client: Client | null = null;

  return {
    id: `anthropic:${model}`,
    smart: true,
    run: async (task: LlmTask): Promise<LlmResult> => {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY o‘rnatilmagan.');
      client ??= await loadClient(apiKey);

      const p = prompt(task);
      const system = task.kind === 'chat' && task.system ? `${SYSTEM}\n\n${task.system}` : SYSTEM;

      const message = await client.messages
        .stream({
          model,
          max_tokens: p.maxTokens,
          system,
          thinking: { type: 'adaptive' },
          output_config: { effort: p.effort },
          messages: [{ role: 'user', content: p.text }],
        })
        .finalMessage();

      const text = message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
        .trim();

      if (task.kind === 'classify') {
        const hit = task.labels.find((l) => text.toLowerCase().includes(l.toLowerCase()));
        return { text, label: hit ?? task.labels[0] ?? '', confidence: hit ? 0.9 : 0.3, provider: model };
      }
      return { text, provider: model };
    },
  };
}
