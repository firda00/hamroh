import type { Ctx } from '../../core/types.ts';
import type { SkillMetadata, SkillResult } from '../types.ts';
import { detectCategory, EXPENSE_CATEGORIES } from '../../util/categories.ts';
import { monthKey } from '../../util/date.ts';
import { totals } from '../../modules/finance.ts';
import { money } from '../../util/fmt.ts';

/** Kirim-chiqim yozish va oylik holatni so'rash. */

export const SKILL: SkillMetadata = {
  type: 'function',
  function: {
    name: 'record_money',
    description:
      'Kirim yoki chiqimni daftarga yozadi. Toifa ko‘rsatilmasa izohdan avtomatik aniqlanadi. ' +
      'Foydalanuvchi "sarfladim", "to‘ladim", "tushdi" degan holatlarda chaqiriladi.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'income — kirim, expense — chiqim', enum: ['income', 'expense'] },
        amount: { type: 'number', description: 'Summa, faqat raqam (masalan 250000)' },
        note: { type: 'string', description: 'Nima uchun — toifa shundan aniqlanadi' },
        category: { type: 'string', description: `Toifa (ixtiyoriy): ${EXPENSE_CATEGORIES.join(', ')}` },
        unnecessary: { type: 'boolean', description: 'true — bu keraksiz xarajat edi' },
      },
      required: ['kind', 'amount'],
    },
  },
};

export function execute(args: Record<string, unknown>, ctx: Ctx): SkillResult {
  const kind = args['kind'] === 'income' ? 'income' : 'expense';
  const amount = Number(args['amount']);
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Summa noto‘g‘ri' };

  const note = args['note'] ? String(args['note']) : '';
  const category = args['category']
    ? String(args['category'])
    : kind === 'income'
      ? 'savdo'
      : detectCategory(note);

  const r = ctx.db.run(
    `INSERT INTO ledger(ts, kind, amount, currency, category, note, source, necessity) VALUES(?,?,?,?,?,?,?,?)`,
    ctx.now.toISOString(),
    kind,
    amount,
    ctx.cfg.currency,
    category,
    note || null,
    'skill',
    args['unnecessary'] === true ? 'kerakmas' : 'kerak',
  );

  const period = monthKey(ctx.now, ctx.cfg.tz);
  const month = totals(ctx, `${period}-01T00:00:00.000Z`, `${period}-31T23:59:59.999Z`);

  return {
    status: 'ok',
    id: r.lastInsertRowid,
    kind,
    amount: money(amount, ctx.cfg.currency),
    category,
    month_net: money(month.net, ctx.cfg.currency),
  };
}
