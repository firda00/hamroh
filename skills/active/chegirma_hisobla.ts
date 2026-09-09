import type { Ctx } from '../../src/core/types.ts';
import type { SkillMetadata, SkillResult } from '../../src/skills/types.ts';

export const SKILL: SkillMetadata = {
  type: 'function',
  function: {
    name: 'chegirma_hisobla',
    description: 'Summadan chegirma foizini ayirib, yakuniy narxni hisoblaydi',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Boshlangich summa' },
        percent: { type: 'number', description: 'Chegirma foizi' },
      },
      required: ['amount', 'percent'],
    },
  },
};

export function execute(args: Record<string, unknown>, _ctx: Ctx): SkillResult {
  const amount = Number(args['amount']);
  const percent = Number(args['percent']);
  const discount = Math.round((amount * percent) / 100);
  return { status: 'ok', discount, final: amount - discount };
}
