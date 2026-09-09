import { spawn } from 'node:child_process';
import type { SmsProvider, SmsResult } from './provider.ts';
import { splitCommand } from '../tts/cmd.ts';

/**
 * Ixtiyoriy dastur orqali SMS — boshqa shlyuzlar (Playmobile, o'z API'ingiz) uchun.
 *
 * O'rin egallovchilar: {to} — raqam, {text} — matn.
 * Matn {text} da ko'rsatilmasa stdin orqali beriladi.
 * Skript 0 kodi bilan tugasa — yuborildi hisoblanadi; stdout oxirgi qatori id bo'ladi.
 */

export type CmdSmsOptions = { command: string; timeoutMs?: number };

export function cmdSms(opts: CmdSmsOptions): SmsProvider {
  return {
    id: `sms:cmd(${splitCommand(opts.command)[0] ?? '?'})`,
    enabled: true,

    send: (to: string, text: string): Promise<SmsResult> => {
      const parts = splitCommand(opts.command).map((a) => a.replace('{to}', to).replace('{text}', text));
      const bin = parts[0];
      if (!bin) return Promise.reject(new Error('HAMROH_SMS_CMD bo‘sh.'));
      const usesStdin = !opts.command.includes('{text}');

      return new Promise<SmsResult>((resolve, reject) => {
        const child = spawn(bin, parts.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000);

        child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
        child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(new Error(`SMS dasturi ishga tushmadi (${bin}): ${e.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(`SMS yuborilmadi (kod ${code}): ${(stderr || stdout).slice(0, 200)}`));
            return;
          }
          resolve({ ok: true, id: stdout.trim().split('\n').pop() || undefined, provider: bin });
        });

        if (usesStdin) child.stdin.end(text);
        else child.stdin.end();
      });
    },
  };
}
