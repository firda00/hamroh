import type { Speech, TtsProvider } from './provider.ts';

/**
 * OpenAI-mos `/audio/speech` endpointi.
 * Ishlaydi: LocalAI, Speaches, openedai-speech, OpenAI API.
 */

export type HttpTtsOptions = {
  url: string;
  model: string;
  voice: string;
  format: string;
  apiKey?: string;
  timeoutMs?: number;
};

export function httpTts(opts: HttpTtsOptions): TtsProvider {
  return {
    id: `tts:${opts.model}/${opts.voice}`,
    enabled: true,

    speak: async (text: string): Promise<Speech> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);

      let res: Response;
      try {
        res = await fetch(`${opts.url}/audio/speech`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey || 'local'}`,
          },
          body: JSON.stringify({
            model: opts.model,
            voice: opts.voice,
            input: text,
            response_format: opts.format,
          }),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).name === 'AbortError' ? 'javob bermadi' : (e as Error).message;
        throw new Error(`TTS serveri bilan aloqa yo‘q (${opts.url}): ${msg}`);
      }
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`TTS xatosi ${res.status}: ${body.slice(0, 200)}`);
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) throw new Error('TTS bo‘sh audio qaytardi.');
      return { bytes, ext: opts.format, provider: opts.model };
    },
  };
}
