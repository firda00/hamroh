import { resolve } from 'node:path';

export type Lang = 'uz' | 'ru' | 'en';

/** rules — LLM'siz (bosqich 1) · local — o'z serveringizdagi model · anthropic — Claude API. */
export type LlmKind = 'rules' | 'local' | 'anthropic';

const LLM_KINDS: LlmKind[] = ['rules', 'local', 'anthropic'];

/** off — ovoz matnga o'girilmaydi · local — o'z Whisper serveringiz. */
export type SttKind = 'off' | 'local';

/** off — ovozli javob yo'q · http — OpenAI-mos server · cmd — ixtiyoriy dastur. */
export type TtsKind = 'off' | 'http' | 'cmd';

/** off — qo'ng'iroq yo'q · cmd — Asterisk/mahalliy shlyuz · twilio — Twilio API. */
export type TelKind = 'off' | 'cmd' | 'twilio';

/** off — SMS yuborilmaydi · eskiz — Eskiz.uz · cmd — ixtiyoriy dastur. */
export type SmsKind = 'off' | 'eskiz' | 'cmd';

/** off — ulanmagan · oauth — shaxsiy hisob · service — xizmat hisobi (brauzersiz). */
export type GcalKind = 'off' | 'oauth' | 'service';

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
  /** Ovozni matnga o'girish (Whisper). */
  stt: SttKind;
  sttUrl: string;
  sttModel: string;
  sttLang: string;
  sttKey: string;
  sttHint: string;
  /** Matnni ovozga aylantirish. */
  tts: TtsKind;
  ttsUrl: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
  ttsKey: string;
  ttsCmd: string;
  /** Ovozli xabarlarni buyruq sifatida bajarish. */
  voiceCommands: boolean;
  /** Telefon qo'ng'irog'i. */
  tel: TelKind;
  telCmd: string;
  telMyNumber: string;
  telAllowed: string[];
  telAudioBase: string;
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  /** SMS shlyuzi. */
  sms: SmsKind;
  smsCmd: string;
  /** Bir kunda yuborish mumkin bo'lgan SMS soni — nazoratsiz sarfga qarshi. */
  smsDailyLimit: number;
  eskizEmail: string;
  eskizPassword: string;
  eskizFrom: string;
  eskizBase: string;
  /** Google Calendar. */
  gcal: GcalKind;
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  googleCalendarId: string;
  googleServiceFile: string;
  googleImpersonate: string;
  /** Marketing manbalari — rasmiy API. */
  instagramToken: string;
  instagramUserId: string;
  instagramMetrics: string;
  adsDeveloperToken: string;
  adsCustomerId: string;
  adsLoginCustomerId: string;
  youtubeChannelId: string;
  gbpLocationId: string;
  /** Veb-panel. Token bo'sh bo'lsa panel umuman ochilmaydi. */
  webToken: string;
  webHost: string;
  webPort: number;
  /** Ommaviy manzil — OAuth qaytish URL i shundan yasaladi. */
  webBase: string;
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
    stt: env('HAMROH_STT', 'off') === 'local' ? 'local' : 'off',
    sttUrl: env('HAMROH_STT_URL', 'http://127.0.0.1:8000/v1').replace(/\/+$/, ''),
    sttModel: env('HAMROH_STT_MODEL', 'Systran/faster-whisper-large-v3'),
    sttLang: env('HAMROH_STT_LANG', 'uz'),
    sttKey: env('HAMROH_STT_KEY', 'local'),
    sttHint: env('HAMROH_STT_HINT'),
    tts: (['http', 'cmd'].includes(env('HAMROH_TTS', 'off')) ? env('HAMROH_TTS') : 'off') as TtsKind,
    ttsUrl: env('HAMROH_TTS_URL', 'http://127.0.0.1:8000/v1').replace(/[/]+$/, ''),
    ttsModel: env('HAMROH_TTS_MODEL', 'tts-1'),
    ttsVoice: env('HAMROH_TTS_VOICE', 'alloy'),
    ttsFormat: env('HAMROH_TTS_FORMAT', 'mp3'),
    ttsKey: env('HAMROH_TTS_KEY', 'local'),
    ttsCmd: env('HAMROH_TTS_CMD'),
    voiceCommands: env('HAMROH_VOICE_COMMANDS') === '1',
    tel: (['cmd', 'twilio'].includes(env('HAMROH_TEL', 'off')) ? env('HAMROH_TEL') : 'off') as TelKind,
    telCmd: env('HAMROH_TEL_CMD'),
    telMyNumber: env('HAMROH_TEL_MY_NUMBER'),
    telAllowed: env('HAMROH_TEL_ALLOWED').split(',').map((s) => s.trim()).filter(Boolean),
    telAudioBase: env('HAMROH_TEL_AUDIO_BASE'),
    twilioSid: env('TWILIO_ACCOUNT_SID'),
    twilioToken: env('TWILIO_AUTH_TOKEN'),
    twilioFrom: env('TWILIO_FROM'),
    sms: (['eskiz', 'cmd'].includes(env('HAMROH_SMS', 'off')) ? env('HAMROH_SMS') : 'off') as SmsKind,
    smsCmd: env('HAMROH_SMS_CMD'),
    smsDailyLimit: Number(env('HAMROH_SMS_DAILY_LIMIT', '50')) || 50,
    eskizEmail: env('ESKIZ_EMAIL'),
    eskizPassword: env('ESKIZ_PASSWORD'),
    eskizFrom: env('ESKIZ_FROM', '4546'),
    eskizBase: env('ESKIZ_BASE', 'https://notify.eskiz.uz/api').replace(/[/]+$/, ''),
    gcal: (['oauth', 'service'].includes(env('HAMROH_GCAL', 'off')) ? env('HAMROH_GCAL') : 'off') as GcalKind,
    googleClientId: env('GOOGLE_CLIENT_ID'),
    googleClientSecret: env('GOOGLE_CLIENT_SECRET'),
    googleRefreshToken: env('GOOGLE_REFRESH_TOKEN'),
    googleCalendarId: env('GOOGLE_CALENDAR_ID', 'primary'),
    googleServiceFile: env('GOOGLE_SERVICE_ACCOUNT_FILE'),
    googleImpersonate: env('GOOGLE_IMPERSONATE'),
    instagramToken: env('INSTAGRAM_ACCESS_TOKEN'),
    instagramUserId: env('INSTAGRAM_USER_ID'),
    instagramMetrics: env('INSTAGRAM_METRICS', 'reach'),
    adsDeveloperToken: env('GOOGLE_ADS_DEVELOPER_TOKEN'),
    adsCustomerId: env('GOOGLE_ADS_CUSTOMER_ID'),
    adsLoginCustomerId: env('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
    youtubeChannelId: env('YOUTUBE_CHANNEL_ID'),
    gbpLocationId: env('GBP_LOCATION_ID'),
    webToken: env('HAMROH_WEB_TOKEN'),
    webHost: env('HAMROH_WEB_HOST', '127.0.0.1'),
    webPort: Number(env('HAMROH_PORT', '7391')) || 7391,
    webBase: env('HAMROH_WEB_BASE'),
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
