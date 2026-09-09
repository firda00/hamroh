import type { Ctx, Module } from '../core/types.ts';
import { parseArgs, parseAmount } from '../core/args.ts';
import { applyEnv, readEnvValue } from '../util/env.ts';
import { normalizeNumber } from '../tel/provider.ts';
import { money } from '../util/fmt.ts';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Sozlash ustasi — birinchi ishga tushirish uchun.
 *
 * .env ni qo'lda tahrirlash o'rniga savol-javob: har bir qadamda joriy qiymat
 * ko'rsatiladi, Enter bosilsa o'zgarmaydi. Kiritilgan tokenlar darhol tekshiriladi.
 */

const ENV_FILE = '.env';

export type Ask = (question: string, current?: string) => Promise<string>;

/** Faylni o'qish (bo'lmasa .env.example dan boshlaymiz). */
function readEnvFile(path: string): string {
  if (existsSync(path)) return readFileSync(path, 'utf8');
  if (existsSync('.env.example')) return readFileSync('.env.example', 'utf8');
  return '';
}

function saveEnv(path: string, text: string): void {
  writeFileSync(path, text, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows da chmod ishlamasligi mumkin — muammo emas
  }
}

/** Telegram tokenini tekshiradi. */
async function checkTelegram(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as { ok: boolean; result?: { username: string }; description?: string };
    return data.ok ? { ok: true, username: data.result?.username } : { ok: false, error: data.description };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Sinov xabari yuboradi — chat ID to'g'riligini tasdiqlaydi. */
async function sendTest(token: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ Hamroh ulandi. Endi shu yerga yozishingiz mumkin.' }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { ok: boolean; description?: string };
    return data.ok ? { ok: true } : { ok: false, error: data.description };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** HTTP endpoint tirikmi. */
async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Savollar ketma-ketligi. Terminaldan ajratilgan — shuning uchun sinash mumkin. */
export async function runWizard(
  ctx: Ctx,
  ask: Ask,
  log: (s: string) => void,
  envPath: string = ENV_FILE,
): Promise<string[]> {
  let env = readEnvFile(envPath);
  const updates: Record<string, string> = {};
  const notes: string[] = [];
  const cur = (key: string, fallback = ''): string => readEnvValue(env, key) || fallback;

  const set = (key: string, value: string): void => {
    if (value !== cur(key)) updates[key] = value;
  };

  // ---------- 1. Asosiy ----------
  log('\n1/6 — Asosiy sozlamalar');
  set('HAMROH_CITY', await ask('Shahar (ob-havo uchun)', cur('HAMROH_CITY', 'Tashkent')));
  set('HAMROH_TZ', await ask('Vaqt zonasi', cur('HAMROH_TZ', 'Asia/Tashkent')));
  set('HAMROH_CURRENCY', await ask('Asosiy valyuta', cur('HAMROH_CURRENCY', 'UZS')));

  // ---------- 2. Telegram ----------
  log('\n2/6 — Telegram (bo‘sh qoldirsangiz o‘tkazib yuboriladi)');
  log('   Token: Telegramda @BotFather ga /newbot yozing');
  const token = await ask('TELEGRAM_BOT_TOKEN', cur('TELEGRAM_BOT_TOKEN'));

  if (token) {
    set('TELEGRAM_BOT_TOKEN', token);
    const me = await checkTelegram(token);
    if (me.ok) {
      log(`   ✓ bot topildi: @${me.username}`);
      log('   Endi botga Telegramda bir marta «salom» deb yozing.');
      const chat = await ask('TELEGRAM_CHAT_ID (bilmasangiz bo‘sh qoldiring)', cur('TELEGRAM_CHAT_ID'));
      if (chat) {
        set('TELEGRAM_CHAT_ID', chat);
        const test = await sendTest(token, chat);
        if (test.ok) log('   ✓ sinov xabari yuborildi — Telegramni tekshiring');
        else {
          log(`   ✗ xabar ketmadi: ${test.error}`);
          notes.push('TELEGRAM_CHAT_ID ni tekshiring: hamroh telegram poll');
        }
      } else {
        notes.push('Chat ID ni bilish uchun: hamroh telegram poll');
      }
    } else {
      log(`   ✗ token ishlamadi: ${me.error}`);
      notes.push('TELEGRAM_BOT_TOKEN noto‘g‘ri — @BotFather dan qaytadan oling');
    }
  } else {
    log('   o‘tkazib yuborildi');
  }

  // ---------- 3. LLM ----------
  log('\n3/6 — Aqlli rejim (LLM)');
  log('   rules — LLM‘siz, bepul (standart) · local — o‘z serveringiz · anthropic — Claude API');
  const llm = (await ask('Rejim [rules/local/anthropic]', cur('HAMROH_LLM', 'rules'))).toLowerCase();

  if (llm === 'local') {
    set('HAMROH_LLM', 'local');
    const url = await ask('Model serveri URL', cur('HAMROH_LLM_URL', 'http://127.0.0.1:11434/v1'));
    set('HAMROH_LLM_URL', url);
    set('HAMROH_LLM_MODEL', await ask('Model nomi', cur('HAMROH_LLM_MODEL', 'qwen3:14b')));
    log((await ping(url)) ? '   ✓ server javob berdi' : '   ! server javob bermadi — keyinroq ko‘taring');
  } else if (llm === 'anthropic') {
    set('HAMROH_LLM', 'anthropic');
    const key = await ask('ANTHROPIC_API_KEY', cur('ANTHROPIC_API_KEY'));
    if (key) set('ANTHROPIC_API_KEY', key);
    set('HAMROH_LLM_MODEL', await ask('Model', cur('HAMROH_LLM_MODEL', 'claude-opus-5')));
    notes.push('SDK ni o‘rnating:  npm install @anthropic-ai/sdk');
  } else {
    set('HAMROH_LLM', 'rules');
    log('   qoidaviy rejim — hamma hisobot va eslatmalar baribir ishlaydi');
  }

  // ---------- 4. Ovoz ----------
  log('\n4/6 — Ovoz (ixtiyoriy)');
  const wantStt = (await ask('Ovozli xabarlarni matnga o‘girish kerakmi? [ha/yo‘q]', cur('HAMROH_STT') === 'local' ? 'ha' : 'yo‘q'))
    .toLowerCase()
    .startsWith('h');
  if (wantStt) {
    set('HAMROH_STT', 'local');
    const url = await ask('Whisper serveri URL', cur('HAMROH_STT_URL', 'http://127.0.0.1:8000/v1'));
    set('HAMROH_STT_URL', url);
    set('HAMROH_STT_LANG', await ask('Til kodi (bo‘sh = avtomatik)', cur('HAMROH_STT_LANG', 'uz')));
    if (!(await ping(url))) {
      log('   ! server javob bermadi');
      notes.push('Whisper: docker run -d --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda');
    } else log('   ✓ server javob berdi');

    const wantCmd = (await ask('Ovozli xabarlar buyruq sifatida bajarilsinmi? [ha/yo‘q]', ctx.cfg.voiceCommands ? 'ha' : 'yo‘q'))
      .toLowerCase()
      .startsWith('h');
    set('HAMROH_VOICE_COMMANDS', wantCmd ? '1' : '0');
  } else {
    set('HAMROH_STT', 'off');
  }

  // ---------- 5. SMS ----------
  log('\n5/6 — SMS shlyuzi (ixtiyoriy)');
  const wantSms = (await ask('SMS yuborish kerakmi? [eskiz/yo‘q]', cur('HAMROH_SMS', 'yo‘q')))
    .toLowerCase();
  if (wantSms === 'eskiz') {
    set('HAMROH_SMS', 'eskiz');
    set('ESKIZ_EMAIL', await ask('Eskiz email', cur('ESKIZ_EMAIL')));
    set('ESKIZ_PASSWORD', await ask('Eskiz parol (ekranda ko‘rinadi)', cur('ESKIZ_PASSWORD')));
    set('ESKIZ_FROM', await ask('Jo‘natuvchi nomi (4546 — sinov)', cur('ESKIZ_FROM', '4546')));
    notes.push('Eskiz ixtiyoriy matn yubortirmaydi — shablon moderatsiyadan o‘tishi kerak (docs/SMS.md)');
  } else {
    set('HAMROH_SMS', 'off');
  }

  // ---------- 6. Telefon ----------
  log('\n6/6 — Telefon qo‘ng‘irog‘i (ixtiyoriy)');
  const myNumber = await ask('O‘z raqamingiz (+998...), bo‘sh = qo‘ng‘iroq yo‘q', cur('HAMROH_TEL_MY_NUMBER'));
  if (myNumber) {
    set('HAMROH_TEL_MY_NUMBER', normalizeNumber(myNumber));
    notes.push('Qo‘ng‘iroq uchun operator ham kerak (Asterisk yoki Twilio) — docs/CALLS.md');
  }

  // ---------- Saqlash ----------
  if (Object.keys(updates).length) {
    env = applyEnv(env, updates);
    saveEnv(envPath, env);
    log(`\n✅ ${envPath} saqlandi (${Object.keys(updates).length} ta o‘zgarish).`);
  } else {
    log('\nO‘zgarish bo‘lmadi.');
  }
  return notes;
}

export const setupModule: Module = {
  id: 'sozlash',
  title: 'Sozlash ustasi',
  about: 'Birinchi ishga tushirish: .env ni savol-javob bilan to‘ldirish va ulanishlarni tekshirish.',

  commands: [
    {
      name: 'start',
      usage: 'sozlash start',
      about: 'Bosqichma-bosqich sozlash (Enter — joriy qiymat qoladi).',
      run: async (ctx) => {
        if (!stdin.isTTY) {
          return {
            text: [
              'Sozlash ustasi interaktiv rejimda ishlaydi (terminal kerak).',
              'Serverda:  sudo -u hamroh node /opt/hamroh/src/cli.ts sozlash start',
              'Yoki .env ni qo‘lda tahrirlang — namuna: .env.example',
            ].join('\n'),
          };
        }

        const rl = createInterface({ input: stdin, output: stdout });
        const ask: Ask = async (question, current = '') => {
          const hint = current ? ` [${current}]` : '';
          const answer = (await rl.question(`  ${question}${hint}: `)).trim();
          return answer || current;
        };

        console.log('Hamroh — sozlash ustasi');
        console.log('Har bir savolda Enter bossangiz joriy qiymat qoladi.');

        try {
          const notes = await runWizard(ctx, ask, (s) => console.log(s));
          return {
            text: [
              '',
              'Keyingi qadamlar:',
              ...notes.map((n) => `  • ${n}`),
              '  • Tekshirish:  hamroh doctor',
              '  • Botni yoqish: npm run bot',
              '  • Namuna ma’lumot: npm run seed',
            ].join('\n'),
          };
        } finally {
          rl.close();
        }
      },
    },
    {
      name: 'oylik',
      usage: 'sozlash oylik "<nom>" <summa> --day=5',
      about: 'Doimiy to‘lovni tez qo‘shish (arenda, kommunal, obuna).',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const title = a.at(0);
        const amount = parseAmount(a.at(1));
        if (!title || !amount) return { text: 'Masalan: sozlash oylik "Ofis arendasi" 5mln --day=5' };
        ctx.db.run(
          `INSERT INTO recurring(title, amount, currency, day_of_month, category) VALUES(?,?,?,?,?)`,
          title,
          amount,
          ctx.cfg.currency,
          Math.min(31, Math.max(1, a.num('day', 1))),
          a.str('cat', 'majburiy'),
        );
        return { text: `📌 ${title} — har oy ${a.num('day', 1)}-kuni, ${money(amount, ctx.cfg.currency)}` };
      },
    },
  ],
};
