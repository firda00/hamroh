import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallProvider, CallRequest, CallResult } from './provider.ts';
import { splitCommand } from '../tts/cmd.ts';

/**
 * Ixtiyoriy dastur orqali qo'ng'iroq — Asterisk yoki mahalliy shlyuz uchun.
 *
 * Buyruqdagi o'rin egallovchilar:
 *   {to}     — raqam (+998901234567)
 *   {audio}  — aytiladigan gapning audio fayli (wav/ogg)
 *   {text}   — o'sha gapning matni
 *   {record} — javobni yozib olish uchun fayl yo'li (skript shu yerga yozsa, o'qiladi)
 *
 * Skript 0 kodi bilan tugasa — qo'ng'iroq muvaffaqiyatli hisoblanadi.
 * {record} fayli paydo bo'lsa — u matnga o'giriladi va buyruq sifatida qaraladi.
 */

export type CmdTelOptions = {
  command: string;
  timeoutMs?: number;
  outDir: string;
};

export function cmdTel(opts: CmdTelOptions): CallProvider {
  return {
    id: `tel:cmd(${splitCommand(opts.command)[0] ?? '?'})`,
    enabled: true,

    call: (req: CallRequest, audio: { bytes: Uint8Array; ext: string }): Promise<CallResult> => {
      const dir = mkdtempSync(join(tmpdir(), 'hamroh-call-'));
      const audioPath = join(dir, `gap.${audio.ext}`);
      const recordPath = join(dir, 'javob.wav');
      writeFileSync(audioPath, audio.bytes);

      const parts = splitCommand(opts.command).map((a) =>
        a.replace('{to}', req.to).replace('{audio}', audioPath).replace('{text}', req.text).replace('{record}', recordPath),
      );
      const bin = parts[0];
      if (!bin) {
        rmSync(dir, { recursive: true, force: true });
        return Promise.reject(new Error('HAMROH_TEL_CMD bo‘sh.'));
      }

      return new Promise<CallResult>((resolve, reject) => {
        const child = spawn(bin, parts.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 180_000);

        child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
        child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));

        child.on('error', (e) => {
          clearTimeout(timer);
          rmSync(dir, { recursive: true, force: true });
          reject(new Error(`Qo‘ng‘iroq dasturi ishga tushmadi (${bin}): ${e.message}`));
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          // Yozib olingan javobni saqlab qolamiz — vaqtinchalik papka o'chiriladi
          let saved: string | undefined;
          if (req.record && existsSync(recordPath)) {
            saved = join(opts.outDir, `javob-${Date.now()}.wav`);
            try {
              copyFileSync(recordPath, saved);
            } catch {
              saved = undefined;
            }
          }
          rmSync(dir, { recursive: true, force: true });

          if (code !== 0) {
            reject(new Error(`Qo‘ng‘iroq amalga oshmadi (kod ${code}): ${(stderr || stdout).slice(0, 300)}`));
            return;
          }
          resolve({
            ok: true,
            id: stdout.trim().split('\n').pop() || undefined,
            recordingPath: saved,
            provider: bin,
          });
        });
      });
    },
  };
}
