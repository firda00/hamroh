import type { SkillMetadata } from '../skills/types.ts';
import { stripThinking } from './prompts.ts';
import { logger } from '../core/logger.ts';

/**
 * Nativ tool calling (function calling) — OpenAI-mos endpoint orqali.
 *
 * Ollama, vLLM, LM Studio va OpenAI ning o'zi shu formatni tushunadi, shuning
 * uchun bitta kod hammasi bilan ishlaydi.
 *
 * Oqim:
 *   1. Model tools ro'yxati bilan chaqiriladi
 *   2. Model tool_calls qaytarsa — har birini bajaramiz
 *   3. Natijalar {role:'tool'} xabar bo'lib tarixga qo'shiladi
 *   4. Model yakuniy javobni yozguncha takrorlanadi (chegara bilan)
 */

const log = logger('tools');

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type ToolOutcome = { name: string; args: Record<string, unknown>; result: unknown };

type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

type ChatResponse = {
  choices?: {
    message?: {
      content?: string;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  error?: { message?: string } | string;
};

export type ToolLoopOptions = {
  url: string;
  model: string;
  apiKey?: string;
  system: string;
  prompt: string;
  tools: SkillMetadata[];
  /** Navykni bajaradigan funksiya — registr shuni beradi. */
  onCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Cheksiz halqadan himoya. */
  maxRounds?: number;
  timeoutMs?: number;
};

/** Model bergan argumentlarni xavfsiz o'qish — u ba'zan buzuq JSON yozadi. */
function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function runToolLoop(opts: ToolLoopOptions): Promise<{ text: string; calls: ToolOutcome[] }> {
  const maxRounds = opts.maxRounds ?? 4;
  const messages: Message[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.prompt },
  ];
  const outcomes: ToolOutcome[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const res = await fetch(`${opts.url}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey || 'local'}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        tools: opts.tools,
        tool_choice: 'auto',
        temperature: 0.2,
        stream: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Model xatosi ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as ChatResponse;
    if (data.error) {
      const msg = typeof data.error === 'string' ? data.error : (data.error.message ?? 'noma’lum');
      throw new Error(`Model xatosi: ${msg}`);
    }

    const choice = data.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];

    if (!calls.length) {
      return { text: stripThinking(choice?.message?.content ?? ''), calls: outcomes };
    }

    // Model chaqirgan navyklarni bajaramiz
    messages.push({
      role: 'assistant',
      content: choice?.message?.content ?? '',
      tool_calls: calls.map((c, i) => ({
        id: c.id ?? `call_${round}_${i}`,
        type: 'function',
        function: { name: c.function?.name ?? '', arguments: c.function?.arguments ?? '{}' },
      })),
    });

    for (const [i, call] of calls.entries()) {
      const name = call.function?.name ?? '';
      const args = parseArgs(call.function?.arguments);
      log.info(`chaqiruv: ${name}(${Object.keys(args).join(', ')})`);

      let result: unknown;
      try {
        result = await opts.onCall(name, args);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      outcomes.push({ name, args, result });

      messages.push({
        role: 'tool',
        tool_call_id: call.id ?? `call_${round}_${i}`,
        content: JSON.stringify(result ?? {}),
      });
    }
  }

  // Chegaraga yetdik — oxirgi holatni tushuntiramiz
  log.warn(`${maxRounds} qadamdan oshdi — to‘xtatildi`);
  return {
    text: outcomes.length
      ? `Bajarildi, lekin model yakuniy javobni bermadi (${maxRounds} qadam chegarasi).`
      : 'Model javob bera olmadi.',
    calls: outcomes,
  };
}
