import type { Ctx } from '../core/types.ts';
import type { Intent } from './types.ts';
import { needsConfirmation } from './types.ts';
import { parseUzbekNumber, extractWhen, cleanTitle } from '../util/uz.ts';
import { stamp } from '../util/date.ts';

/**
 * Qoidaviy buyruq tanuvchi — LLM'siz ishlaydi.
 *
 * Har bir qoida: kalit so'zlar topilsa, matndan kerakli qiymatlarni ajratib,
 * modul buyrug'ini yig'adi. Tushunmasa null qaytaradi — u holda LLM (ulangan bo'lsa)
 * yoki foydalanuvchiga savol.
 */

type Rule = {
  id: string;
  /** Kamida bittasi uchrashi kerak. */
  any: RegExp;
  /** Uchramasligi kerak (chalkashlikni oldini oladi). */
  not?: RegExp;
  build: (ctx: Ctx, text: string) => Omit<Intent, 'source' | 'needsConfirm'> | null;
};

const has = (re: RegExp, t: string): boolean => re.test(t);

/** Telefon raqami summa deb o'qilib ketmasligi uchun avval olib tashlanadi. */
const money = (t: string): number | null =>
  parseUzbekNumber(t.replace(/\+?998\d{9}|\b\d{9,}\b/g, ' '));

const RULES: Rule[] = [
  // ---------- So'rovlar (o'qish) ----------
  {
    id: 'kurs',
    any: /\b(kurs|dollar|valyuta|so‘m kursi|som kursi)\b/i,
    not: /\b(sarfla|to‘la|tola|chiqim)\b/i,
    build: () => ({ module: 'bozor', command: 'kurs', args: [], confidence: 0.9, explain: 'valyuta kursi' }),
  },
  {
    id: 'obhavo',
    any: /\b(ob-havo|obhavo|havo qanday|havo qalay|isiy|sovuq bo)\b/i,
    build: () => ({ module: 'bozor', command: 'obhavo', args: [], confidence: 0.9, explain: 'ob-havo' }),
  },
  {
    id: 'yangilik',
    any: /\b(yangilik|xabarlar|nima gap)\b/i,
    build: () => ({ module: 'yangilik', command: 'top', args: [], confidence: 0.85, explain: 'yangiliklar xulosasi' }),
  },
  {
    id: 'reja',
    any: /\b(rejam|reja qanday|bugun nima|vazifalarim|ishlarim|nima qilishim)\b/i,
    build: () => ({ module: 'vazifa', command: 'plan', args: [], confidence: 0.9, explain: 'bugungi reja' }),
  },
  {
    id: 'hisobot',
    any: /\b(hisobot|kun yakuni|natija qanday|qanday ketyapti)\b/i,
    build: () => ({ module: 'hisobot', command: 'kun', args: [], confidence: 0.85, explain: 'kunlik hisobot' }),
  },
  {
    id: 'moliya-bugun',
    any: /\b(bugungi (kirim|chiqim|pul)|qancha (tushdi|sarfladim)|kassa)\b/i,
    build: () => ({ module: 'moliya', command: 'today', args: [], confidence: 0.85, explain: 'bugungi kirim-chiqim' }),
  },
  {
    id: 'tolovlar',
    any: /\b(to‘lovlar|tolovlar|arendani to‘la|qarzlar|oylik to‘lov)\b/i,
    not: /\b(to‘ladim|toladim|to‘lab qo)\b/i,
    build: () => ({ module: 'oylik', command: 'check', args: [], confidence: 0.85, explain: 'to‘lanmagan majburiyatlar' }),
  },
  {
    id: 'javobsiz',
    any: /\b(javobsiz|qo‘ng‘iroqlar|kim qo‘ng‘iroq)\b/i,
    build: () => ({ module: 'aloqa', command: 'calls', args: ['--missed'], confidence: 0.85, explain: 'javobsiz qo‘ng‘iroqlar' }),
  },
  {
    id: 'uchrashuvlar',
    any: /\b(uchrashuvlarim|kalendar|jadval|bugun kim bilan)\b/i,
    not: /\b(qo‘y|qoy|belgila|yoz)\b/i,
    build: () => ({ module: 'kalendar', command: 'list', args: [], confidence: 0.85, explain: 'uchrashuvlar jadvali' }),
  },

  // ---------- Yozuvlar (o'zgartirish) ----------
  {
    id: 'uchrashuv-qoshish',
    any: /\b(uchrashuv|yig‘ilish|yigilish|meeting|ko‘rishamiz|korishamiz)\b/i,
    build: (ctx, text) => {
      const when = extractWhen(text, ctx.cfg.tz, ctx.now);
      if (!when) return null;
      const title =
        cleanTitle(text, [
          'uchrashuv', 'uchrashuvni', 'yig‘ilish', 'yigilish', 'qo‘y', 'qoy', 'belgila', 'yoz',
          'ertaga', 'bugun', 'indinga', 'soat', 'da', 'kel',
        ]) || 'Uchrashuv';
      return {
        module: 'kalendar',
        command: 'add',
        args: [title, `--at=${stamp(when, ctx.cfg.tz)}`],
        confidence: 0.8,
        explain: `uchrashuv: "${title}" — ${stamp(when, ctx.cfg.tz)}`,
      };
    },
  },
  {
    id: 'eslatma',
    any: /\b(eslat|eslatib qo‘y|yodimga sol|unutmayin|vazifa qo‘sh|qilishim kerak)\b/i,
    build: (ctx, text) => {
      const when = extractWhen(text, ctx.cfg.tz, ctx.now);
      const title =
        cleanTitle(text, [
          'eslat', 'eslatib', 'qo‘y', 'qoy', 'yodimga', 'sol', 'unutmayin', 'vazifa',
          'qo‘sh', 'qosh', 'menga', 'kerak', 'qilishim', 'ertaga', 'bugun', 'indinga', 'soat',
        ]) || 'Vazifa';
      const args = [title];
      if (when) args.push(`--due=${stamp(when, ctx.cfg.tz)}`);
      return {
        module: 'vazifa',
        command: 'add',
        args,
        confidence: when ? 0.8 : 0.7,
        explain: `vazifa: "${title}"${when ? ` — ${stamp(when, ctx.cfg.tz)}` : ' (muddatsiz)'}`,
      };
    },
  },
  {
    id: 'lid',
    any: /\b(yangi (mijoz|lid)|lid qo‘sh|mijoz keldi|mijoz yozildi)\b/i,
    build: (_ctx, text) => {
      const phone = text.match(/(\+?998\d{9}|\d{9})/)?.[1];
      const name =
        cleanTitle(text.replace(/\+?\d{7,}/g, ' '), [
          'yangi', 'mijoz', 'lid', 'qo‘sh', 'qosh', 'keldi', 'yozildi', 'raqami', 'raqam',
          'instagramdan', 'instagram', 'googledan', 'google', 'telegramdan', 'telegram', '2gis',
        ]) || 'Yangi lid';
      const source = /instagram|instagramdan/i.test(text)
        ? 'instagram'
        : /google/i.test(text)
          ? 'google'
          : /2gis|2 gis/i.test(text)
            ? '2gis'
            : /telegram/i.test(text)
              ? 'telegram'
              : 'boshqa';
      const args = [name, `--source=${source}`];
      if (phone) args.push(`--phone=${phone}`);
      return { module: 'lid', command: 'add', args, confidence: 0.75, explain: `lid: "${name}" (${source})` };
    },
  },
  {
    id: 'chiqim',
    any: /\b(sarfladim|sarfla|to‘ladim|toladim|chiqim|xarajat|berdim|oldim.*pul)\b/i,
    not: /\b(tushdi|kirim|keldi.*pul)\b/i,
    build: (ctx, text) => {
      const amount = money(text);
      if (!amount) return null;
      const cat = detectCategory(text);
      const need = /\b(kerak emas|keraksiz|behuda)\b/i.test(text) ? 'kerakmas' : 'kerak';
      return {
        module: 'moliya',
        command: 'out',
        args: [String(amount), `--cat=${cat}`, `--need=${need}`],
        confidence: 0.8,
        explain: `chiqim: ${amount.toLocaleString('ru-RU')} ${ctx.cfg.currency} — ${cat}`,
      };
    },
  },
  {
    id: 'kirim',
    any: /\b(tushdi|kirim|keldi|to‘lov qildi|sotdim|pul oldim)\b/i,
    not: /\b(mijoz|lid|uchrashuv)\b/i,
    build: (ctx, text) => {
      const amount = money(text);
      if (!amount) return null;
      return {
        module: 'moliya',
        command: 'in',
        args: [String(amount), '--cat=savdo'],
        confidence: 0.8,
        explain: `kirim: ${amount.toLocaleString('ru-RU')} ${ctx.cfg.currency}`,
      };
    },
  },
  {
    id: 'sms',
    any: /\bsms\b/i,
    build: (ctx, text) => {
      // Raqam to'g'ridan-to'g'ri aytilgan bo'lishi mumkin
      let phone = text.match(/(\+?998\d{9}|\b\d{9}\b)/)?.[1] ?? '';

      // Bo'lmasa — ismni bazadan qidiramiz (lid yoki qo'ng'iroqlar tarixidan)
      if (!phone) {
        for (const word of text.split(/\s+/)) {
          const name = word.replace(/(ga|ka|qa|niki|ning)$/i, '');
          if (name.length < 3) continue;
          const row = ctx.db.get<{ phone: string | null }>(
            `SELECT phone FROM leads WHERE phone IS NOT NULL AND name LIKE ?
             UNION SELECT phone FROM calls WHERE name LIKE ? LIMIT 1`,
            `%${name}%`,
            `%${name}%`,
          );
          if (row?.phone) {
            phone = row.phone;
            break;
          }
        }
      }
      if (!phone) return null;

      // Xabar matni: qo'shtirnoq ichida yoki "sms" so'zidan keyin
      const quoted = text.match(/["«“']([^"»”']{3,})["»”']/)?.[1];
      const after = text.split(/\bsms\b/i)[1]?.replace(/^\s*(yubor|jo‘nat|jonat|yoz)\w*\s*:?\s*/i, '') ?? '';
      const body = (quoted ?? after).trim();
      if (!body) return null;

      return {
        module: 'aloqa',
        command: 'sms',
        args: [phone, body],
        confidence: 0.7,
        explain: `SMS ${phone}: "${body}"`,
      };
    },
  },
  {
    id: 'soglik',
    any: /\b(qadam|uxladim|uyqu|vazn|suv ichdim)\b/i,
    build: (_ctx, text) => {
      const amount = money(text);
      if (!amount) return null;
      const kind = /qadam/i.test(text)
        ? 'steps'
        : /uxladim|uyqu/i.test(text)
          ? 'sleep'
          : /vazn/i.test(text)
            ? 'weight'
            : 'water';
      return { module: 'soglik', command: 'log', args: [kind, String(amount)], confidence: 0.75, explain: `sog‘liq: ${kind} = ${amount}` };
    },
  },
];

function detectCategory(text: string): string {
  const t = text.toLowerCase();
  const map: [RegExp, string][] = [
    [/ovqat|tushlik|nonushta|restoran|kafe|yeg/, 'ovqat'],
    [/benzin|yoqilg‘i|yoqilgi|taksi|transport|mashina/, 'transport'],
    [/arenda|ijara|ofis/, 'arenda'],
    [/reklama|targ‘ibot|targibot|instagram|ads/, 'reklama'],
    [/kommunal|svet|gaz|suv puli|internet/, 'kommunal'],
    [/maosh|oylik|xodim/, 'maosh'],
    [/soliq|buxgalter/, 'soliq'],
  ];
  for (const [re, cat] of map) if (re.test(t)) return cat;
  return 'boshqa';
}

/** Matndan buyruq aniqlash. Tushunmasa null. */
export function routeByRules(ctx: Ctx, text: string): Intent | null {
  const clean = text.trim();
  if (!clean) return null;

  for (const rule of RULES) {
    if (!has(rule.any, clean)) continue;
    if (rule.not && has(rule.not, clean)) continue;
    const built = rule.build(ctx, clean);
    if (!built) continue;
    return { ...built, source: 'rules', needsConfirm: needsConfirmation(built.module, built.command) };
  }
  return null;
}
