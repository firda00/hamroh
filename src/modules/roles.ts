import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { table, truncate, compact } from '../util/fmt.ts';
import { dateKey, addDays, stamp } from '../util/date.ts';
import { packs, byRoleId, checkPacks } from '../roles/index.ts';
import { resolvePermission } from '../roles/types.ts';
import { runWorkflow, runStep, pendingApprovals, approve, reject } from '../roles/runner.ts';
import { evaluateAll, scoreOf, ICON, formatKpi } from '../roles/kpi.ts';
import { verifyChain, recent, record, EVENTS } from '../roles/audit.ts';
import { setting } from '../core/db.ts';
import { enqueue } from './notify.ts';
import { writeReport } from '../report/html.ts';
import type { Block } from '../report/html.ts';
import { join } from 'node:path';

/**
 * Rol paketlari — modul.
 *
 * Rol «yoqilgan» bo'lishi kerak: paket borligi uning o'zi ishlashini
 * anglatmaydi. Yoqish — ongli qaror va u ham jurnalga tushadi.
 */

const ACTIVE_KEY = (id: string): string => `rol:${id}:faol`;

export const isActive = (ctx: Ctx, id: string): boolean => setting.get(ctx.db, ACTIVE_KEY(id)) === '1';

const STATUS_ICON: Record<string, string> = {
  bajarildi: '✅',
  tasdiq_kutmoqda: '⏸',
  bloklandi: '🚫',
  rad_etildi: '✖',
  xato: '❌',
  'o‘tkazildi': '·',
};

const MODE_LABEL: Record<string, string> = {
  auto: 'o‘zi bajaradi',
  approval: 'tasdiq so‘raydi',
  deny: 'taqiqlangan',
};

/** Davr: standart 7 kun. */
function period(ctx: Ctx, days: number): { from: string; to: string } {
  return {
    from: dateKey(addDays(ctx.now, -days + 1), ctx.cfg.tz),
    to: dateKey(ctx.now, ctx.cfg.tz),
  };
}

function requirePack(id: string) {
  const pack = byRoleId(id || 'marketing-employee');
  if (!pack) throw new Error(`Bunday rol yo‘q: ${id}. Mavjud: ${packs.map((p) => p.id).join(', ')}`);
  return pack;
}

export const rolesModule: Module = {
  id: 'rol',
  title: 'Rol paketlari',
  about: 'Agentni aniq lavozimga aylantiruvchi to‘plam: ruxsat, ish oqimi, tasdiq, KPI, jurnal.',

  commands: [
    {
      name: 'list',
      usage: 'rol list',
      about: 'Mavjud rol paketlari.',
      run: (ctx) => {
        const problems = checkPacks();
        const rows = packs.map((p) => [
          p.id,
          `${p.name} ${p.version}`,
          isActive(ctx, p.id) ? '✅ yoqilgan' : '— o‘chiq',
          `${p.workflow.length} qadam · ${p.kpis.length} KPI`,
        ]);
        const lines = [table(['ID', 'Nom', 'Holat', 'Hajm'], rows)];
        if (problems.length) {
          lines.push('', '⚠️ Paketda muammo:');
          for (const p of problems) lines.push(`   ${p.pack}: ${p.problems.join('; ')}`);
        }
        lines.push('', 'Batafsil:  rol korish marketing-employee');
        return { text: lines.join('\n'), data: { packs: packs.map((p) => p.id), problems } };
      },
    },
    {
      name: 'korish',
      usage: 'rol korish [<id>]',
      about: 'Rol tavsifi: nima qiladi, nimaga ruxsati bor, qanday ishlaydi.',
      run: (ctx, argv) => {
        const pack = requirePack(parseArgs(argv).at(0));
        const auto = pack.permissions.filter((p) => p.mode === 'auto');
        const appr = pack.permissions.filter((p) => p.mode === 'approval');
        const deny = pack.permissions.filter((p) => p.mode === 'deny');

        return {
          text: [
            `${pack.name} ${pack.version}   [${isActive(ctx, pack.id) ? 'yoqilgan' : 'o‘chiq'}]`,
            pack.mission,
            '',
            'QILADI:',
            ...pack.does.map((d) => `  ✅ ${d}`),
            '',
            'QILMAYDI:',
            ...pack.doesNot.map((d) => `  🚫 ${d}`),
            '',
            `RUXSATLAR (${auto.length} o‘zi · ${appr.length} tasdiq · ${deny.length} taqiq):`,
            table(
              ['Amal', 'Rejim', 'Sabab'],
              [
                ...auto.map((p) => [p.action, 'o‘zi', truncate(p.why, 52)]),
                ...appr.map((p) => [p.action, '⏸ tasdiq', truncate(p.why, 52)]),
                ...deny.map((p) => [p.action, '🚫 taqiq', truncate(p.why, 52)]),
              ],
            ),
            '',
            'ISH OQIMI:',
            table(
              ['Qadam', 'Nima qiladi', 'Amal', 'Jadval', 'Natija'],
              pack.workflow.map((s) => [
                s.id,
                s.title,
                s.action,
                s.cron ?? 'qo‘lda',
                truncate(s.produces, 36),
              ]),
            ),
            '',
            'KPI:',
            table(
              ['Ko‘rsatkich', 'Maqsad', 'Yo‘nalish'],
              pack.kpis.map((k) => [
                k.title,
                formatKpi(k.target, k.unit),
                k.direction === 'up' ? 'ko‘p — yaxshi' : 'kam — yaxshi',
              ]),
            ),
          ].join('\n'),
          data: pack,
        };
      },
    },
    {
      name: 'yoq',
      usage: 'rol yoq <id>',
      about: 'Rolni yoqish — shundan keyin jadval bo‘yicha ishlaydi.',
      run: (ctx, argv) => {
        const pack = requirePack(parseArgs(argv).at(0));
        if (isActive(ctx, pack.id)) return { text: `${pack.name} allaqachon yoqilgan.` };
        setting.set(ctx.db, ACTIVE_KEY(pack.id), '1');
        record(ctx.db, ctx.now, { role: pack.id, actor: 'odam', event: EVENTS.roleActivated, subject: pack.version });
        return {
          text: [
            `✅ ${pack.name} ${pack.version} yoqildi.`,
            '',
            `Jadval bo‘yicha ${pack.workflow.filter((s) => s.cron).length} qadam avtomatik ishlaydi.`,
            `Tasdiq talab qiladigan ${pack.permissions.filter((p) => p.mode === 'approval').length} amal navbatga tushadi.`,
            '',
            'Hozir sinash:  rol ishla --force',
          ].join('\n'),
        };
      },
    },
    {
      name: 'ochir',
      usage: 'rol ochir <id>',
      about: 'Rolni to‘xtatish.',
      run: (ctx, argv) => {
        const pack = requirePack(parseArgs(argv).at(0));
        setting.set(ctx.db, ACTIVE_KEY(pack.id), '0');
        record(ctx.db, ctx.now, { role: pack.id, actor: 'odam', event: EVENTS.roleStopped });
        return { text: `⏹ ${pack.name} to‘xtatildi. Navbatdagi tasdiqlar saqlanib qoladi.` };
      },
    },
    {
      name: 'ishla',
      usage: 'rol ishla [<id>] [--force] [--qadam=hisobot]',
      about: 'Ish oqimini bajarish (jadvalni kutmasdan).',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const pack = requirePack(a.at(0));
        const outcomes = await runWorkflow(ctx, pack, { force: a.has('force'), only: a.str('qadam', '') || undefined });

        const rows = outcomes.map((o) => [
          `${STATUS_ICON[o.status] ?? '·'} ${o.step}`,
          o.title,
          truncate(o.summary, 58),
        ]);
        const waiting = outcomes.filter((o) => o.status === 'tasdiq_kutmoqda');
        const files = outcomes.flatMap((o) => o.files ?? []);

        const lines = [table(['Qadam', 'Nima', 'Natija'], rows)];
        if (waiting.length) {
          lines.push('', `⏸ ${waiting.length} ta amal tasdiq kutmoqda:`);
          for (const w of waiting) lines.push(`   #${w.approvalId} ${w.action} — ${w.title}`);
          lines.push('', 'Ko‘rish:  rol navbat        Tasdiqlash:  rol tasdiq <#>');
        }
        if (files.length) lines.push('', `📄 Fayllar: ${files.join(', ')}`);

        return { text: lines.join('\n'), data: outcomes, files };
      },
    },
    {
      name: 'navbat',
      usage: 'rol navbat [<id>]',
      about: 'Tasdiq kutayotgan amallar.',
      run: (ctx, argv) => {
        const id = parseArgs(argv).at(0);
        const list = pendingApprovals(ctx, id || undefined);
        if (!list.length) return { text: 'Tasdiq kutayotgan amal yo‘q.' };

        return {
          text: [
            table(
              ['#', 'Amal', 'Nima uchun to‘xtadi', 'Qachon'],
              list.map((r) => [
                String(r.id),
                r.action,
                truncate(r.reason, 46),
                stamp(new Date(r.created_at), ctx.cfg.tz),
              ]),
            ),
            '',
            'Argumentlar bilan ko‘rish:  rol tasdiq <#> --korish',
            'Tasdiqlash:  rol tasdiq <#>       Rad etish:  rol rad <#> "sabab"',
          ].join('\n'),
          data: list,
        };
      },
    },
    {
      name: 'tasdiq',
      usage: 'rol tasdiq <#> [--korish] [--kim=Firdavs]',
      about: 'Amalni tasdiqlash va bajarish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        if (!Number.isInteger(id) || id <= 0) return { text: 'Raqam kerak: rol tasdiq 1' };

        const row = ctx.db.get<{ role: string; action: string; args: string; reason: string; preview: string; status: string }>(
          'SELECT role, action, args, reason, preview, status FROM role_approvals WHERE id=?',
          id,
        );
        if (!row) return { text: `#${id} topilmadi.` };

        // Tasdiqlashdan oldin ko'rish — nima bajarilishini aynan ko'rsatadi.
        if (a.has('korish')) {
          const pack = requirePack(row.role);
          const perm = resolvePermission(pack, row.action);
          return {
            text: [
              `#${id}  ${row.action}   [${row.status}]`,
              `Rol:        ${pack.name}`,
              `Nima bo‘ladi: ${row.preview ?? '—'}`,
              `Argumentlar: ${row.args}`,
              `To‘xtash sababi: ${row.reason}`,
              `Ruxsat rejimi: ${MODE_LABEL[perm.mode] ?? perm.mode}`,
              '',
              `Tasdiqlash:  rol tasdiq ${id}`,
            ].join('\n'),
            data: row,
          };
        }

        const pack = requirePack(row.role);
        const out = await approve(ctx, pack, id, a.str('kim', 'operator'));
        return {
          text: `${STATUS_ICON[out.status] ?? ''} #${id} ${out.action}\n${out.summary}`,
          data: out,
          files: out.files,
        };
      },
    },
    {
      name: 'rad',
      usage: 'rol rad <#> "<sabab>" [--kim=Firdavs]',
      about: 'Amalni rad etish.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const id = Number(a.at(0));
        if (!Number.isInteger(id) || id <= 0) return { text: 'Raqam kerak: rol rad 1 "hozir kerak emas"' };
        const row = ctx.db.get<{ role: string }>('SELECT role FROM role_approvals WHERE id=?', id);
        if (!row) return { text: `#${id} topilmadi.` };
        const pack = requirePack(row.role);
        const out = reject(ctx, pack, id, a.str('kim', 'operator'), a.rest(1) || 'sabab yozilmagan');
        return { text: `✖ #${id} rad etildi: ${out.note}`, data: out };
      },
    },
    {
      name: 'kpi',
      usage: 'rol kpi [<id>] [--days=7] [--html]',
      about: 'Ko‘rsatkichlar: maqsad va haqiqiy holat.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const pack = requirePack(a.at(0));
        const days = a.num('days', 7);
        const { from, to } = period(ctx, days);
        const results = evaluateAll(ctx, pack, from, to, true);
        const score = scoreOf(results);

        const rows = results.map((r) => [
          `${ICON[r.verdict]} ${r.title}`,
          formatKpi(r.value, r.unit),
          formatKpi(r.target, r.unit),
          r.attainment === null ? '—' : `${r.attainment}%`,
        ]);

        const files: string[] = [];
        if (a.has('html')) {
          const blocks: Block[] = [
            {
              type: 'kpis',
              items: results.map((r) => ({
                label: r.title,
                value: formatKpi(r.value, r.unit),
                delta: r.attainment === null ? undefined : `maqsadning ${r.attainment}%`,
                up: r.verdict === 'yaxshi',
              })),
            },
            {
              type: 'table',
              title: 'Ko‘rsatkichlar',
              headers: ['Ko‘rsatkich', 'Haqiqiy', 'Maqsad', 'Bajarildi', 'Nega muhim'],
              rows: results.map((r) => [
                `${ICON[r.verdict]} ${r.title}`,
                formatKpi(r.value, r.unit),
                formatKpi(r.target, r.unit),
                r.attainment === null ? '—' : `${r.attainment}%`,
                r.why,
              ]),
            },
          ];
          files.push(
            writeReport(join(ctx.cfg.outDir, `rol-kpi-${to}.html`), {
              title: `${pack.name} — ko‘rsatkichlar`,
              subtitle: `${from} … ${to}`,
              blocks,
            }),
          );
        }

        return {
          text: [
            `${pack.name} · ${from} … ${to}`,
            '',
            table(['Ko‘rsatkich', 'Haqiqiy', 'Maqsad', 'Bajarildi'], rows),
            '',
            score.percent === null
              ? 'Baho berish uchun ma’lumot yetarli emas.'
              : `Umumiy: ${score.good}/${score.measured} ko‘rsatkich maqsadda (${score.percent}%).`,
            ...(files.length ? ['', `📄 ${files[0]}`] : []),
          ].join('\n'),
          data: { results, score },
          files,
        };
      },
    },
    {
      name: 'jurnal',
      usage: 'rol jurnal [<id>] [--n=30]',
      about: 'Rol nima qilgani — o‘zgarmas jurnal.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const id = a.at(0);
        const rows = recent(ctx.db, a.num('n', 30), id || undefined);
        if (!rows.length) return { text: 'Jurnal bo‘sh.' };

        return {
          text: [
            table(
              ['Vaqt', 'Kim', 'Hodisa', 'Nima ustida'],
              rows.map((r) => [
                stamp(new Date(r.ts), ctx.cfg.tz),
                r.actor,
                r.event,
                truncate(r.subject ?? '—', 34),
              ]),
            ),
            '',
            'Zanjirni tekshirish:  rol audit',
          ].join('\n'),
          data: rows,
        };
      },
    },
    {
      name: 'audit',
      usage: 'rol audit [<id>]',
      about: 'Jurnal zanjirini tekshirish — o‘zgartirilganmi.',
      run: (ctx, argv) => {
        const id = parseArgs(argv).at(0);
        const check = verifyChain(ctx.db, id || undefined);
        if (check.ok) {
          return {
            text: [
              `✅ Zanjir butun: ${check.checked} ta yozuv tekshirildi.`,
              '',
              'Har bir yozuv oldingisining barmoq iziga bog‘langan. Bitta qatorni',
              'o‘zgartirsangiz yoki o‘chirsangiz — shu tekshiruv buni ko‘rsatadi.',
            ].join('\n'),
            data: check,
          };
        }
        return {
          text: [
            `❌ ZANJIR UZILGAN`,
            `   Yozuv #${check.brokenAt?.id} (${check.brokenAt?.ts})`,
            `   Hodisa: ${check.brokenAt?.event}`,
            `   Sabab: ${check.brokenAt?.reason}`,
            '',
            'Ya’ni jurnal tashqaridan o‘zgartirilgan. Bazaning zaxira nusxasini tekshiring.',
          ].join('\n'),
          data: check,
        };
      },
    },
  ],

  // Har bir qadam o‘z jadvali bo‘yicha alohida job bo‘ladi. Shunda
  // rejalashtiruvchi takrorlanishdan o‘zi himoya qiladi (job_runs jadvali),
  // va soat 9 dagi qadam soat 10 da ishlab ketmaydi.
  jobs: [
    ...packs.flatMap((pack) =>
      pack.workflow
        .filter((step) => step.cron)
        .map((step) => ({
          name: `rol.${pack.id}.${step.id}`,
          cron: step.cron as string,
          run: async (ctx: Ctx): Promise<string> => {
            if (!isActive(ctx, pack.id)) return 'rol o‘chiq';
            const out = await runStep(ctx, pack, step);

            if (out.status === "tasdiq_kutmoqda" && out.approvalId) {
              enqueue(ctx, {
                module: 'rol',
                title: `${pack.name}: tasdiq kerak`,
                body: `#${out.approvalId} ${out.action} — ${step.title}
${out.summary}`,
                dedupeKey: `rol:tasdiq:${out.approvalId}`,
              });
            }
            if (out.status === "bloklandi") {
              // Bu jiddiy: ish oqimi paket ruxsatiga to‘g‘ri kelmayapti.
              enqueue(ctx, {
                module: 'rol',
                title: `${pack.name}: qadam bloklandi`,
                body: `${step.id} (${out.action}) — ${out.summary}`,
                dedupeKey: `rol:blok:${pack.id}:${step.id}`,
              });
            }
            return `${out.status}: ${out.summary}`;
          },
        })),
    ),
  ],
};
