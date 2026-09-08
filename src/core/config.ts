import { resolve } from 'node:path';

export type Lang = 'uz' | 'ru' | 'en';

/** rules — LLM'siz (bosqich 1) · local — o'z serveringizdagi model · anthropic — Claude API. */
export type LlmKind = 'rules' | 'local' | 'anthropic';

const LLM_KINDS: LlmKind[] = ['rules', 'local', 'anthropic'];

export type Config = {
  dbPath: string;
  tz: string;
  city: string;
  currency: string;
  lang: Lang;
  offline: boolean;
  llm: LlmKind;
  llmModel: string;
  /** local provayder uchun OpenAI-mos endpoint. */
  llmUrl: string;
  llmKey: string;
  anthropicKey: string;
  extraFeeds: string[];
  telegram: { token: string; chatId: string };
  outDir: string;
};

const env = (k: string, d = ''): string => process.env[k]?.trim() || d;

export function loadConfig(): Config {
  const raw = env('HAMROH_LLM', 'rules') as LlmKind;
  const kind: LlmKind = LLM_KINDS.includes(raw) ? raw : 'rules';

  return {
    dbPath: resolve(env('HAMROH_DB', './data/hamroh.db')),
    tz: env('HAMROH_TZ', 'Asia/Tashkent'),
    city: env('HAMROH_CITY', 'Tashkent'),
    currency: env('HAMROH_CURRENCY', 'UZS'),
    lang: env('HAMROH_LANG', 'uz') as Lang,
    offline: env('HAMROH_OFFLINE') === '1',
    llm: kind,
    llmModel: env('HAMROH_LLM_MODEL', kind === 'local' ? 'qwen3:14b' : 'claude-opus-5'),
    llmUrl: env('HAMROH_LLM_URL', 'http://127.0.0.1:11434/v1').replace(/\/+$/, ''),
    llmKey: env('HAMROH_LLM_KEY', 'local'),
    anthropicKey: env('ANTHROPIC_API_KEY'),
    extraFeeds: env('HAMROH_NEWS_FEEDS').split(',').map((s) => s.trim()).filter(Boolean),
    telegram: { token: env('TELEGRAM_BOT_TOKEN'), chatId: env('TELEGRAM_CHAT_ID') },
    outDir: resolve(env('HAMROH_OUT', './out')),
  };
}

/** .env faylini oddiy o'qish (bog'liqliksiz). */
export async function loadDotEnv(file = '.env'): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    const quoted = (val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"));
    if (quoted) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
