/**
 * Xarajat toifalari va ularni matndan aniqlash.
 *
 * Bitta joyda turadi, chunki ikki joydan chaqiriladi: ovozli/matnli buyruq
 * tanuvchisi (intent) va `moliya out` buyrug'i. Ikkalasi bir xil natija berishi kerak.
 */

export const EXPENSE_CATEGORIES = [
  'ovqat',
  'transport',
  'arenda',
  'reklama',
  'kommunal',
  'maosh',
  'soliq',
  'xizmat',
  'sogliq',
  'boshqa',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const PATTERNS: [RegExp, ExpenseCategory][] = [
  [/ovqat|tushlik|nonushta|kechki ovqat|restoran|kafe|choyxona|yeg|non\b|market|do‘kon/i, 'ovqat'],
  [/benzin|yoqilg‘i|yoqilgi|taksi|transport|mashina|avtobus|metro|yo‘l kira/i, 'transport'],
  [/arenda|ijara|ofis haqi/i, 'arenda'],
  [/reklama|targ‘ibot|targibot|instagram|facebook|google ads|smm|banner/i, 'reklama'],
  [/kommunal|svet|elektr|gaz\b|suv puli|internet|aloqa haqi/i, 'kommunal'],
  [/maosh|oylik berdim|ish haqi|xodim|avans/i, 'maosh'],
  [/soliq|buxgalter|hisobot haqi|jarima/i, 'soliq'],
  [/xizmat|obuna|dasturga|litsenziya|hosting|domen/i, 'xizmat'],
  [/dori|shifokor|klinika|tahlil|dorixona/i, 'sogliq'],
];

/** Kalit so'zlar bo'yicha toifa. Topilmasa 'boshqa'. */
export function detectCategory(text: string): ExpenseCategory {
  for (const [re, cat] of PATTERNS) if (re.test(text)) return cat;
  return 'boshqa';
}

/** Kalit so'z topildimi — LLM ga murojaat qilish kerakmi yoki yo'qmi. */
export function isConfident(text: string): boolean {
  return detectCategory(text) !== 'boshqa';
}
