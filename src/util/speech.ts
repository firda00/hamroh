/**
 * Matnni gapirishga tayyorlash.
 *
 * TTS "robot kabi" eshitilishining asosiy sababi — modelga texnik matn berilishi.
 * "USD 11 789,33 UZS ↑ +0.4%" ni har qanday model g'aliz o'qiydi.
 * "Dollar kursi o'n bir ming yetti yuz sakson to'qqiz so'm, nol butun to'rt foizga oshdi"
 * esa tabiiy eshitiladi. Shu o'girish shu yerda bajariladi — TTS provayderidan qat'i nazar.
 */

const ONES = ['nol', 'bir', 'ikki', 'uch', 'to‘rt', 'besh', 'olti', 'yetti', 'sakkiz', 'to‘qqiz'];
const TENS = ['', 'o‘n', 'yigirma', 'o‘ttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'to‘qson'];
const SCALES: [number, string][] = [
  [1_000_000_000, 'milliard'],
  [1_000_000, 'million'],
  [1_000, 'ming'],
];

const MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr',
];

/** 0..999 oralig'i. */
function under1000(n: number): string {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(h === 1 ? 'yuz' : `${ONES[h]} yuz`);
  const t = Math.floor(rest / 10);
  const o = rest % 10;
  if (t) out.push(TENS[t] as string);
  if (o) out.push(ONES[o] as string);
  return out.join(' ');
}

/** Butun sonni o'zbekcha so'zga aylantiradi: 1250000 -> "bir million ikki yuz ellik ming". */
export function numberToUzbekWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < 0) return `minus ${numberToUzbekWords(-value)}`;

  let n = Math.round(value);
  if (n === 0) return 'nol';

  const parts: string[] = [];
  for (const [scale, name] of SCALES) {
    const count = Math.floor(n / scale);
    if (count > 0) {
      // "ming" oldida "bir" aytilmaydi: 1500 -> "ming besh yuz"
      parts.push(count === 1 && scale === 1000 ? name : `${under1000(count)} ${name}`);
      n %= scale;
    }
  }
  if (n > 0) parts.push(under1000(n));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Tartib son: 9 -> "to'qqizinchi", 21 -> "yigirma birinchi". */
export function ordinalUz(n: number): string {
  const words = numberToUzbekWords(n);
  const last = words.split(' ').pop() ?? '';
  const suffix = /[aeiou‘]$/.test(last) ? 'nchi' : 'inchi';
  return `${words}${suffix}`;
}

/** Kasrli son: 12.5 -> "o'n ikki butun besh". */
function decimalToWords(whole: number, frac: string): string {
  const trimmed = frac.replace(/0+$/, '');
  if (!trimmed) return numberToUzbekWords(whole);
  return `${numberToUzbekWords(whole)} butun ${numberToUzbekWords(Number(trimmed))}`;
}

/** 24 soatlik vaqtni gapiriladigan ko'rinishga: "15:30" -> "soat uch yarimda". */
function timeToWords(h: number, m: number): string {
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const partOfDay = h < 6 ? 'tunda ' : h < 12 ? 'ertalab ' : h < 18 ? '' : 'kechqurun ';
  if (m === 0) return `${partOfDay}soat ${numberToUzbekWords(hour12)}da`;
  if (m === 30) return `${partOfDay}soat ${numberToUzbekWords(hour12)} yarimda`;
  return `${partOfDay}soat ${numberToUzbekWords(hour12)} ${numberToUzbekWords(m)}da`;
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu;

/**
 * Matnni ovozga tayyorlaydi: raqamlarni so'zga, belgilarni gapga aylantiradi.
 * Natija — odam o'qiydigan ko'rinishdagi matn.
 */
export function naturalizeForSpeech(input: string): string {
  let t = input;

  // 1. "↑ +12,5%" -> "o'n ikki butun besh foizga oshdi" (birga o'girilsa tabiiyroq)
  t = t.replace(/([↑↓])\s*([+-]?\d+(?:[.,]\d+)?)\s*%/g, (_m, arrow: string, num: string) => {
    const [whole = '0', frac] = num.replace(/^[+-]/, '').split(/[.,]/);
    const words = frac ? decimalToWords(Number(whole), frac) : numberToUzbekWords(Number(whole));
    return ` ${words} foizga ${arrow === '↑' ? 'oshdi' : 'kamaydi'} `;
  });

  // 2. Valyuta kodlari — TTS ularni harflab o'qimasligi uchun
  t = t
    .replace(/\bUSD\b/g, 'dollar')
    .replace(/\bEUR\b/g, 'yevro')
    .replace(/\bRUB\b/g, 'rubl')
    .replace(/\bCPL\b/gi, 'bitta lid narxi')
    .replace(/\bCTR\b/gi, 'bosish ulushi');

  // 3. Qolgan belgilar -> so'z (emoji o'chirilishidan oldin)
  t = t.replace(/↑/g, ' oshdi ').replace(/↓/g, ' kamaydi ').replace(/[✓✅]/g, ' bajarildi ').replace(/[⚠❗]/g, ' diqqat ');
  t = t.replace(/[·•]/g, ', ');
  t = t.replace(EMOJI, ' ');

  // 4. Sana: 2026-09-09 -> "to'qqizinchi sentyabr"
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, _y, mo: string, d: string) => {
    const month = MONTHS[Number(mo) - 1] ?? '';
    return `${ordinalUz(Number(d))} ${month}`;
  });

  // 5. Vaqt: 15:30
  t = t.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, mi: string) => timeToWords(Number(h), Number(mi)));

  // 6. Foiz: +12,5% / -3%
  t = t.replace(/([+-]?)(\d+)(?:[.,](\d+))?\s*%/g, (_m, sign: string, whole: string, frac: string | undefined) => {
    const words = frac ? decimalToWords(Number(whole), frac) : numberToUzbekWords(Number(whole));
    const prefix = sign === '-' ? 'minus ' : '';
    return `${prefix}${words} foiz`;
  });

  // 7. Valyuta: "1 234 567 UZS" / "250000 so'm" -> so'z + "so'm"
  t = t.replace(
    /\b(\d[\d\s ]*)(?:[.,](\d{1,2}))?\s*(UZS|so‘m|som|sum)\b/gi,
    (_m, whole: string, _frac: string | undefined) => {
      const n = Number(whole.replace(/[\s ]/g, ''));
      // Tiyin amalda ishlatilmaydi — aytilmaydi
      return `${numberToUzbekWords(n)} so‘m`;
    },
  );
  t = t.replace(/\b(\d[\d\s ]*)\s*(USD|dollar)\b/gi, (_m, whole: string) => {
    const n = Number(whole.replace(/[\s ]/g, ''));
    return `${numberToUzbekWords(n)} dollar`;
  });

  // 8. "#12" -> "raqam o'n ikki"
  t = t.replace(/#(\d+)/g, (_m, n: string) => `raqam ${numberToUzbekWords(Number(n))}`);

  // 9. Qolgan sonlar (probel bilan ajratilganlari ham)
  t = t.replace(/\b(\d[\d\s ]{0,15}\d|\d)(?:[.,](\d+))?\b/g, (_m, whole: string, frac: string | undefined) => {
    const n = Number(whole.replace(/[\s ]/g, ''));
    if (!Number.isFinite(n)) return _m;
    // Katta sonlarda kasr qismi ovozda ortiqcha shovqin
    return frac && n < 1000 ? decimalToWords(n, frac) : numberToUzbekWords(n);
  });

  // 10. Ortiqcha belgilar va bo'shliqlar
  return t
    .replace(/[*_`|>«»"]/g, ' ')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*[-–]\s*/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

/**
 * Gaplarga ajratadi — TTS har bir gapni alohida sintez qilib,
 * orasiga tabiiy pauza qo'yishi uchun.
 */
export function toSentences(text: string, maxLen = 220): string[] {
  const rough = text
    .split(/(?<=[.!?])\s+/)
    .flatMap((s) => (s.length > maxLen ? s.split(/,\s+/) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);
  return rough.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
}
