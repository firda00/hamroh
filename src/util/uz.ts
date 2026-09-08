import { parseWhen, parts, zonedToUtc, addDays, WEEKDAYS_UZ } from './date.ts';

/**
 * O'zbekcha nutqdan son va vaqt ajratish.
 *
 * Ovozli buyruq matni odam gapiradigan ko'rinishda keladi:
 * "ertaga soat uchda uchrashuv", "ikki yuz ming so'm ovqatga sarfladim".
 * Shu matndan aniq qiymat chiqarish kerak.
 */

const ONES: Record<string, number> = {
  'bir': 1, 'ikki': 2, 'uch': 3, 'to‘rt': 4, "to'rt": 4, 'tort': 4, 'besh': 5,
  'olti': 6, 'yetti': 7, 'sakkiz': 8, 'to‘qqiz': 9, "to'qqiz": 9, 'toqqiz': 9,
};

const TENS: Record<string, number> = {
  'o‘n': 10, "o'n": 10, 'on': 10, 'yigirma': 20, 'o‘ttiz': 30, "o'ttiz": 30, 'ottiz': 30,
  'qirq': 40, 'ellik': 50, 'oltmish': 60, 'yetmish': 70, 'sakson': 80, 'to‘qson': 90, "to'qson": 90,
};

const SCALES: Record<string, number> = {
  'yuz': 100, 'ming': 1_000, 'million': 1_000_000, 'mln': 1_000_000,
  'milion': 1_000_000, 'milliard': 1_000_000_000, 'mlrd': 1_000_000_000,
};

const norm = (s: string): string => s.toLowerCase().replace(/[‘'`’]/g, '‘');

/**
 * "ikki yuz ming" -> 200000 · "besh million" -> 5000000 · "250 ming" -> 250000
 * Raqam va so'zlar aralash bo'lishi mumkin.
 */
export function parseUzbekNumber(input: string): number | null {
  const words = norm(input).split(/[^\p{L}\p{N}‘]+/u).filter(Boolean);

  let total = 0; // yakunlangan qismlar
  let current = 0; // hozirgi guruh (yuz/ming oldidagi)
  let seen = false;

  for (const w of words) {
    const digits = /^\d[\d.,]*$/.test(w) ? Number(w.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) : null;

    if (digits !== null && Number.isFinite(digits)) {
      current += digits;
      seen = true;
      continue;
    }

    const one = ONES[w];
    if (one !== undefined) {
      current += one;
      seen = true;
      continue;
    }

    const ten = TENS[w];
    if (ten !== undefined) {
      current += ten;
      seen = true;
      continue;
    }

    const scale = SCALES[w];
    if (scale !== undefined) {
      if (!seen) current = 1; // "ming so'm" = 1000
      if (scale === 100) {
        current *= 100;
      } else {
        total += (current || 1) * scale;
        current = 0;
      }
      seen = true;
      continue;
    }

    // Son bilan bog'liq bo'lmagan so'z guruhni yopadi
    if (seen && current === 0 && total > 0) break;
  }

  const value = total + current;
  return seen && value > 0 ? value : null;
}

const HOUR_WORDS: Record<string, number> = {
  'birda': 1, 'ikkida': 2, 'uchda': 3, 'to‘rtda': 4, 'tortda': 4, 'beshda': 5,
  'oltida': 6, 'yettida': 7, 'sakkizda': 8, 'to‘qqizda': 9, 'toqqizda': 9,
  'o‘nda': 10, 'onda': 10, 'yarimda': 12,
};

/**
 * Nutqdagi vaqtni "HH:MM" ga aylantiradi.
 * "soat uchda" -> 15:00 (kechki soatlar ehtimoli yuqori — 8 dan kichik soat kunduzgi deb olinadi)
 */
export function extractTime(input: string): string | null {
  const t = norm(input);

  const exact = t.match(/(\d{1,2})[:.](\d{2})/);
  if (exact) return `${String(Math.min(23, Number(exact[1]))).padStart(2, '0')}:${exact[2]}`;

  let hour: number | null = null;
  let half = false;

  const digitHour = t.match(/soat\s+(\d{1,2})/) ?? t.match(/(\d{1,2})\s*(?:da|da\b|larda)\b/);
  if (digitHour?.[1]) hour = Number(digitHour[1]);

  if (hour === null) {
    // "o'n birda", "o'n ikkida" — ikki so'zli soatlar
    const two = t.match(/(o‘n|on)\s+(bir|ikki)da/);
    if (two) hour = 10 + (two[2] === 'bir' ? 1 : 2);
  }

  if (hour === null) {
    for (const [word, h] of Object.entries(HOUR_WORDS)) {
      if (t.includes(word)) {
        hour = h;
        break;
      }
    }
  }

  if (hour === null) return null;
  if (/\byarim\b/.test(t)) half = true;

  // Kunduzgi/kechki: 1-7 odatda tushdan keyin aytiladi
  if (hour >= 1 && hour < 8 && !/\bertalab\b|\btongda\b/.test(t)) hour += 12;
  if (/\bkechqurun\b|\bkechasi\b/.test(t) && hour < 12) hour += 12;

  return `${String(hour % 24).padStart(2, '0')}:${half ? '30' : '00'}`;
}

/**
 * Gap ichidan sana+vaqtni topadi.
 * "Aziz aka bilan ertaga soat uchda uchrashuv" -> ertangi kun 15:00
 */
export function extractWhen(input: string, tz: string, now = new Date()): Date | null {
  const t = norm(input);
  const time = extractTime(t);

  let dayShift: number | null = null;
  if (/\bertaga\b/.test(t)) dayShift = 1;
  else if (/\bindinga\b/.test(t)) dayShift = 2;
  else if (/\bbugun\b/.test(t)) dayShift = 0;

  if (dayShift === null) {
    const wd = WEEKDAYS_UZ.findIndex((w) => t.includes(w));
    if (wd >= 0) {
      const p = parts(now, tz);
      const today = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
      dayShift = (wd - today + 7) % 7 || 7;
    }
  }

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return parseWhen(`${iso[0]} ${time ?? '09:00'}`, tz, now);

  if (dayShift === null && !time) return null;

  const base = addDays(now, dayShift ?? 0);
  const p = parts(base, tz);
  const [h = 9, m = 0] = (time ?? '09:00').split(':').map(Number);
  const at = zonedToUtc({ y: p.y, m: p.m, d: p.d, H: h, M: m, S: 0 }, tz);

  // Vaqt aytilgan-u kun aytilmagan bo'lsa va u o'tib ketgan bo'lsa — ertaga
  if (dayShift === null && at.getTime() < now.getTime()) return addDays(at, 1);
  return at;
}

/** Vaqtni bildiruvchi so'zlar — sarlavhada hech qachon kerak emas. */
const TIME_WORDS = new RegExp(
  `\\b(soat|kuni|birda|ikkida|uchda|to‘rtda|tortda|beshda|oltida|yettida|sakkizda|to‘qqizda|toqqizda|o‘nda|onda|yarimda|ertalab|kechqurun|kechasi|tongda|${WEEKDAYS_UZ.join('|')})\\b`,
  'gi',
);

/** Buyruq matnidan ortiqcha xizmat so'zlarini olib tashlaydi. */
export function cleanTitle(input: string, drop: string[]): string {
  let out = input;
  for (const d of drop) out = out.replace(new RegExp(`\\b${d}\\b`, 'gi'), ' ');
  return out
    .replace(TIME_WORDS, ' ')
    .replace(/\bsoat\s*\d{1,2}\s*(da)?\b/gi, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();
}
