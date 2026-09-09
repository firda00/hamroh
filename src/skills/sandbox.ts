import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Navyk faylini izolyatsiyada tekshirish.
 *
 * Bu — qoralamani (draft) faollashtirishdan oldingi tekshiruv. Node ning
 * ruxsatlar tizimi (--permission) ishlatiladi:
 *
 *   ✅ fayl tizimi — faqat navykning o'z fayli o'qiladi
 *   ✅ dochyor jarayon va worker — bloklangan
 *   ✅ maxfiy kalitlar — env dan olib tashlanadi
 *   ✅ vaqt chegarasi
 *   ❌ TARMOQ BLOKLANMAYDI — Node da --allow-net yo'q
 *
 * Ya'ni sinov "kod ishlaydimi va nima qaytaradi" degan savolga javob beradi,
 * lekin yovuz koddan to'liq himoya emas. Yakuniy himoya — sizning ko'rigingiz.
 */

const RUNNER = fileURLToPath(new URL('./runner.ts', import.meta.url));

export type SandboxResult = {
  ok: boolean;
  /** Navyk qaytargan qiymat (muvaffaqiyatli bo'lsa). */
  value?: unknown;
  /** Metama'lumot to'g'ri o'qildimi. */
  metadata?: unknown;
  error?: string;
  stderr?: string;
  ms: number;
};

/** Maxfiy ma'lumot bo'lishi mumkin bo'lgan kalitlarni olib tashlaydi. */
export function safeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const secret = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|SID|ESKIZ|TWILIO|ANTHROPIC|GOOGLE/i;
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (!secret.test(k)) out[k] = v;
  }
  out['HAMROH_SANDBOX'] = '1';
  return out;
}

/**
 * Navykni alohida jarayonda ishga tushiradi.
 * `args` berilmasa faqat metama'lumot o'qiladi (execute chaqirilmaydi).
 */
export function runInSandbox(
  file: string,
  args?: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<SandboxResult> {
  const started = Date.now();
  const target = resolve(file);

  return new Promise<SandboxResult>((done) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        `--allow-fs-read=${target}`,
        `--allow-fs-read=${dirname(RUNNER)}${process.platform === 'win32' ? '\\*' : '/*'}`,
        `--allow-fs-read=${RUNNER}`,
        RUNNER,
        target,
      ],
      { env: safeEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));

    child.on('error', (e) => {
      clearTimeout(timer);
      done({ ok: false, error: `jarayon ishga tushmadi: ${e.message}`, ms: Date.now() - started });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (signal === 'SIGKILL') {
        done({ ok: false, error: `${timeoutMs / 1000}s dan oshdi — to‘xtatildi`, stderr, ms });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim() || '{}') as SandboxResult;
        done({ ...parsed, stderr: stderr.trim() || undefined, ms });
      } catch {
        done({
          ok: false,
          error: code === 0 ? 'natija JSON emas' : `xato bilan tugadi (kod ${code})`,
          stderr: (stderr || stdout).trim().slice(0, 500),
          ms,
        });
      }
    });

    child.stdin.end(JSON.stringify({ args: args ?? null }));
  });
}
