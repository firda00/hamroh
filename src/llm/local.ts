import type { LlmProvider, LlmResult, LlmTask } from './provider.ts';
import { buildPrompt, systemFor, stripThinking, matchLabel } from './prompts.ts';

/**
 * Lokal model provayderi — OpenAI-mos `/chat/completions` endpointi orqali.
 *
 * Ishlaydigan serverlar (hech biri uchun kod o'zgartirilmaydi):
 *   Ollama       http://127.0.0.1:11434/v1      model: qwen3:14b
 *   llama.cpp    http://127.0.0.1:8080/v1       model: (ixtiyoriy)
 *   vLLM         http://127.0.0.1:8000/v1       model: Qwen/Qwen3-14B
 *   LM Studio    http://127.0.0.1:1234/v1
 *
 * .env:
 *   HAMROH_LLM=local
 *   HAMROH_LLM_URL=http://127.0.0.1:11434/v1
 *   HAMROH_LLM_MODEL=qwen3:14b
 */

type ChatResponse = {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  error?: { message?: string } | string;
};

export type LocalOptions = {
  url: string;
  model: string;
  apiKey?: string;
  /** Sekin GPU va uzun javoblar uchun. */
  timeoutMs?: number;
};

export function localProvider(opts: LocalOptions): LlmProvider {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return {
    id: `local:${opts.model}`,
    smart: true,

    run: async (task: LlmTask): Promise<LlmResult> => {
      const p = buildPrompt(task);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(`${opts.url}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey || 'local'}`,
          },
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: systemFor(task) },
              { role: 'user', content: p.text },
            ],
            max_tokens: p.maxTokens,
            temperature: p.temperature,
            stream: false,
          }),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).name === 'AbortError' ? `${timeoutMs / 1000}s ichida javob bermadi` : (e as Error).message;
        throw new Error(`Lokal model bilan aloqa yo‘q (${opts.url}): ${msg}`);
      }
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Lokal model xatosi ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as ChatResponse;
      if (data.error) {
        const msg = typeof data.error === 'string' ? data.error : (data.error.message ?? 'noma’lum xato');
        throw new Error(`Lokal model xatosi: ${msg}`);
      }

      const text = stripThinking(data.choices?.[0]?.message?.content ?? '');
      if (!text) throw new Error('Lokal model bo‘sh javob qaytardi.');

      if (task.kind === 'classify') {
        const { label, confidence } = matchLabel(text, task.labels);
        return { text, label, confidence, provider: opts.model };
      }
      return { text, provider: opts.model };
    },
  };
}

/** Server tirikmi va qaysi modellar bor — `hamroh doctor` uchun. */
export async function localStatus(url: string, apiKey = 'local'): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${url}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (data.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}
