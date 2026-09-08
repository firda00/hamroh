import type { SttProvider, Transcript } from './provider.ts';

/**
 * Whisper serveri — OpenAI-mos `/audio/transcriptions` endpointi orqali.
 *
 * Ishlaydigan serverlar (kod hammasi uchun bir xil):
 *   faster-whisper-server (Speaches)  http://127.0.0.1:8000/v1
 *   whisper.cpp server --convert      http://127.0.0.1:8080/v1
 *   LocalAI                           http://127.0.0.1:8080/v1
 *   OpenAI API (agar xohlasangiz)     https://api.openai.com/v1
 */

type ApiResponse = {
  text?: string;
  language?: string;
  duration?: number;
  error?: { message?: string } | string;
};

export type LocalSttOptions = {
  url: string;
  model: string;
  /** '' bo'lsa model tilni o'zi aniqlaydi. */
  language: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Modelga kutilayotgan atamalarni aytadi — o'zbekcha nomlarda aniqlikni oshiradi. */
  hint?: string;
};

const MIME: Record<string, string> = {
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

export function localStt(opts: LocalSttOptions): SttProvider {
  const timeoutMs = opts.timeoutMs ?? 300_000; // uzun yozuvlar sekin bo'ladi

  return {
    id: `whisper:${opts.model}`,
    enabled: true,

    transcribe: async (audio: Uint8Array, filename: string): Promise<Transcript> => {
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const form = new FormData();
      form.append('file', new Blob([audio], { type: MIME[ext] ?? 'application/octet-stream' }), filename);
      form.append('model', opts.model);
      form.append('response_format', 'json');
      form.append('temperature', '0');
      if (opts.language) form.append('language', opts.language);
      if (opts.hint) form.append('prompt', opts.hint);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(`${opts.url}/audio/transcriptions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.apiKey || 'local'}` },
          body: form,
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const msg =
          (e as Error).name === 'AbortError'
            ? `${Math.round(timeoutMs / 1000)}s ichida javob bermadi`
            : (e as Error).message;
        throw new Error(`Whisper serveri bilan aloqa yo‘q (${opts.url}): ${msg}`);
      }
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Whisper xatosi ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as ApiResponse;
      if (data.error) {
        const msg = typeof data.error === 'string' ? data.error : (data.error.message ?? 'noma’lum xato');
        throw new Error(`Whisper xatosi: ${msg}`);
      }

      const text = (data.text ?? '').trim();
      if (!text) throw new Error('Whisper bo‘sh matn qaytardi (audio jim yoki format tanilmadi).');

      return {
        text,
        language: data.language,
        durationSec: data.duration,
        provider: opts.model,
      };
    },
  };
}

/** Server tirikmi va qaysi modellar bor — `hamroh doctor` uchun. */
export async function sttStatus(url: string, apiKey = 'local'): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const res = await fetch(`${url}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { data?: { id: string }[] };
    return { ok: true, models: (data.data ?? []).map((m) => m.id).slice(0, 8) };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}
