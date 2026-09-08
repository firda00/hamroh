import type { LlmProvider, LlmResult, LlmTask } from './provider.ts';
import { buildPrompt, systemFor, matchLabel } from './prompts.ts';

/**
 * Claude provayderi — rasmiy Anthropic SDK orqali.
 *
 * SDK ixtiyoriy bog'liqlik: o'rnatilmagan bo'lsa loyiha baribir ishlaydi.
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

/** SDK o'rnatilmagan bo'lsa tushunarli xato beradi. */
async function loadClient(apiKey: string): Promise<Client> {
  // Literal bo'lmagan spetsifikator — SDK yo'q paytda ham typecheck o'tadi.
  const specifier = '@anthropic-ai/sdk';
  let mod: { default: new (opts: { apiKey: string }) => Client };
  try {
    mod = (await import(specifier)) as { default: new (opts: { apiKey: string }) => Client };
  } catch {
    throw new Error('Anthropic SDK topilmadi. Avval o‘rnating:  npm install @anthropic-ai/sdk');
  }
  return new mod.default({ apiKey });
}

export function anthropicProvider(apiKey: string, model: string): LlmProvider {
  let client: Client | null = null;

  return {
    id: `anthropic:${model}`,
    smart: true,

    run: async (task: LlmTask): Promise<LlmResult> => {
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY o‘rnatilmagan.');
      client ??= await loadClient(apiKey);

      const p = buildPrompt(task);
      const message = await client.messages
        .stream({
          model,
          max_tokens: p.maxTokens,
          system: systemFor(task),
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
        const { label, confidence } = matchLabel(text, task.labels);
        return { text, label, confidence, provider: model };
      }
      return { text, provider: model };
    },
  };
}
