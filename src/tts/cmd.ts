import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Speech, TtsProvider } from './provider.ts';

/**
 * Ixtiyoriy dastur orqali TTS — o'zbekcha ovoz uchun eng moslashuvchan yo'l.
 *
 * Buyruqda ikkita o'rin egallovchi ishlatiladi:
 *   {out}  — yaratiladigan audio fayl yo'li (majburiy)
 *   {text} — matn (bo'lmasa matn stdin orqali beriladi)
 *
 * Misollar:
 *   HAMROH_TTS_CMD=piper -m uz.onnx -f {out}
 *   HAMROH_TTS_CMD=python3 mms_tts.py --lang uzb --out {out}
 *   HAMROH_TTS_CMD=espeak-ng -v uz -w {out} "{text}"
 */

export type CmdTtsOptions = {
  command: string;
  ext: string;
  timeoutMs?: number;
};

/** Buyruqni bo'laklarga ajratadi, tirnoq ichidagi bo'shliqni saqlaydi. */
export function splitCommand(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = '';
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function cmdTts(opts: CmdTtsOptions): TtsProvider {
  return {
    id: `tts:cmd(${splitCommand(opts.command)[0] ?? '?'})`,
    enabled: true,

    speak: (text: string): Promise<Speech> => {
      const dir = mkdtempSync(join(tmpdir(), 'hamroh-tts-'));
      const outFile = join(dir, `speech.${opts.ext}`);
      const parts = splitCommand(opts.command).map((a) =>
        a.replace('{out}', outFile).replace('{text}', text),
      );
      const bin = parts[0];
      if (!bin) return Promise.reject(new Error('HAMROH_TTS_CMD bo‘sh.'));
      const usesStdin = !opts.command.includes('{text}');

      return new Promise<Speech>((resolve, reject) => {
        const child = spawn(bin, parts.slice(1), { stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 120_000);

        child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
        child.on('error', (e) => {
          clearTimeout(timer);
          rmSync(dir, { recursive: true, force: true });
          reject(new Error(`TTS dasturi ishga tushmadi (${bin}): ${e.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          try {
            if (code !== 0) throw new Error(`TTS dasturi ${code} kodi bilan tugadi: ${stderr.slice(0, 200)}`);
            const bytes = new Uint8Array(readFileSync(outFile));
            if (!bytes.length) throw new Error('TTS bo‘sh fayl yaratdi.');
            resolve({ bytes, ext: opts.ext, provider: bin });
          } catch (e) {
            reject(e as Error);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        });

        if (usesStdin) child.stdin.end(text);
        else child.stdin.end();
      });
    },
  };
}
