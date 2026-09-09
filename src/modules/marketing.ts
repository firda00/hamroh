import type { Ctx, Module } from '../core/types.ts';
import { parseArgs } from '../core/args.ts';
import { dateKey, addDays, monthKey } from '../util/date.ts';
import { table, growth, compact } from '../util/fmt.ts';
import { readCsv } from '../util/office.ts';
import { writeReport } from '../report/html.ts';
import type { Block } from '../report/html.ts';
import { readFileSync } from 'node:fs';
import { makeSources } from '../marketing/index.ts';
import { consentUrl, CALENDAR_SCOPE, MARKETING_SCOPES } from '../google/auth.ts';
import { join } from 'node:path';

/**
 * (13) Marketing analitikasi: Instagram, Google Ads, 2GIS, Google Business Profile, YouTube.
 *
 * Ma'lumot uch yo'l bilan keladi:
 *   `sync`   — rasmiy API dan (Instagram Graph, Google Ads, YouTube, Business Profile)
 *   `import` — CSV eksportdan (2GIS kabi API bermaydigan platformalar uchun)
 *   `set`    — qo'lda
 *
 * Skrejping ataylab yo'q: u platformalarning shartlarini buzadi va hisobni
 * bloklashga olib keladi. Faqat rasmiy API, faqat o'qish uchun.
 */

export const PLATFORMS = ['instagram', 'google_ads', '2gis', 'gbp', 'youtube'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const METRICS: Record<string, string> = {
  reach: 'qamrov',
  views: 'ko‘rishlar',
  clicks: 'bosishlar',
  cost: 'xarajat',
  leads: 'lidlar',
  calls: 'qo‘ng‘iroqlar',
  routes: 'yo‘nalish so‘rovlari',
  followers: 'obunachilar',
  watch_time: 'ko‘rish vaqti',
};

export type Metric = { date: string; platform: string; metric: string; value: number; account: string };

export function sumBy(
  ctx: Ctx,
  fromDate: string,
  toDate: string,
  group: 'platform' | 'metric',
): { key: string; total: number }[] {
  return ctx.db.all<{ key: string; total: number }>(
    `SELECT ${group} key, SUM(value) total FROM marketing_metrics WHERE date BETWEEN ? AND ?
     GROUP BY ${group} ORDER BY total DESC`,
    fromDate,
    toDate,
  );
}

export type PlatformRow = { platform: string; leads: number; cost: number; audience: number; clicks: number; calls: number };

/** Platforma kesimi. Turli metrikalarni qo'shmaydi — har biri alohida ustun. */
export function platformRows(ctx: Ctx, fromDate: string, toDate: string): PlatformRow[] {
  const raw = ctx.db.all<{ platform: string; metric: string; total: number }>(
    `SELECT platform, metric, SUM(value) total FROM marketing_metrics WHERE date BETWEEN ? AND ?
     GROUP BY platform, metric`,
    fromDate,
    toDate,
  );
  const map = new Map<string, PlatformRow>();
  for (const r of raw) {
    const row = map.get(r.platform) ?? { platform: r.platform, leads: 0, cost: 0, audience: 0, clicks: 0, calls: 0 };
    if (r.metric === 'leads') row.leads += r.total;
    else if (r.metric === 'cost') row.cost += r.total;
    else if (r.metric === 'reach' || r.metric === 'views') row.audience += r.total;
    else if (r.metric === 'clicks') row.clicks += r.total;
    else if (r.metric === 'calls') row.calls += r.total;
    map.set(r.platform, row);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads || b.audience - a.audience);
}

export function seriesFor(ctx: Ctx, metric: string, fromDate: string, toDate: string): { label: string; value: number }[] {
  return ctx.db
    .all<{ date: string; total: number }>(
      `SELECT date, SUM(value) total FROM marketing_metrics WHERE metric=? AND date BETWEEN ? AND ?
       GROUP BY date ORDER BY date`,
      metric,
      fromDate,
      toDate,
    )
    .map((r) => ({ label: r.date.slice(5), value: r.total }));
}

/** Qoidaviy tavsiyalar: raqamlarga qarab nima qilish kerakligi. */
export function marketingFindings(ctx: Ctx, fromDate: string, toDate: string, prevFrom: string, prevTo: string): string[] {
  const cur = new Map(sumBy(ctx, fromDate, toDate, 'metric').map((r) => [r.key, r.total]));
  const prev = new Map(sumBy(ctx, prevFrom, prevTo, 'metric').map((r) => [r.key, r.total]));
  const out: string[] = [];

  const cost = cur.get('cost') ?? 0;
  const leads = cur.get('leads') ?? 0;
  const clicks = cur.get('clicks') ?? 0;
  const reach = cur.get('reach') ?? 0;

  if (cost && leads) out.push(`Bitta lid narxi: ${compact(cost / leads)} ${ctx.cfg.currency} (CPL).`);
  else if (cost && !leads) out.push(`Xarajat ${compact(cost)} bor, lekin lid qayd etilmagan — o‘lchov uzilgan.`);
  if (clicks && reach) out.push(`CTR: ${((clicks / reach) * 100).toFixed(2)}% (qamrovga nisbatan).`);
  if (clicks && leads) out.push(`Saytdan lidga konversiya: ${((leads / clicks) * 100).toFixed(1)}%.`);

  for (const [metric, value] of cur) {
    const before = prev.get(metric) ?? 0;
    const g = growth(before, value);
    if (g.pct !== null && Math.abs(g.pct) >= 20) {
      out.push(`${METRICS[metric] ?? metric}: ${g.text} (${compact(before)} → ${compact(value)}) — sababini aniqlash kerak.`);
    }
  }

  const platforms = platformRows(ctx, fromDate, toDate);
  const silent = PLATFORMS.filter((p) => !platforms.some((x) => x.platform === p));
  if (silent.length) out.push(`Ma’lumot kiritilmagan platformalar: ${silent.join(', ')}.`);

  if (!out.length) out.push('Sezilarli o‘zgarish yo‘q — kanallar barqaror.');
  return out;
}

export const marketingModule: Module = {
  id: 'marketing',
  title: 'Marketing analitikasi',
  about: 'Instagram, Google Ads, 2GIS, Google Business, YouTube ko‘rsatkichlari va diagramma hisobot.',

  commands: [
    {
      name: 'set',
      usage: `marketing set <${PLATFORMS.join('|')}> <metrika> <qiymat> [--date=2026-09-08] [--account=main]`,
      about: `Ko‘rsatkich kiritish. Metrikalar: ${Object.keys(METRICS).join(', ')}`,
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const platform = a.at(0);
        const metric = a.at(1);
        const value = Number(a.at(2).replace(/\s/g, ''));
        if (!platform || !metric || !Number.isFinite(value)) {
          return { text: 'Masalan: marketing set instagram reach 15400' };
        }
        const date = a.str('date', dateKey(ctx.now, ctx.cfg.tz));
        ctx.db.run(
          `INSERT INTO marketing_metrics(date, platform, metric, value, account) VALUES(?,?,?,?,?)
           ON CONFLICT(date, platform, metric, account) DO UPDATE SET value = excluded.value`,
          date,
          platform,
          metric,
          value,
          a.str('account', 'main'),
        );
        return { text: `📈 ${date} · ${platform} · ${METRICS[metric] ?? metric} = ${value.toLocaleString('ru-RU')}` };
      },
    },
    {
      name: 'import',
      usage: 'marketing import <fayl.csv>',
      about: 'CSV yuklash (ustunlar: date;platform;metric;value).',
      run: (ctx, argv) => {
        const file = parseArgs(argv).at(0);
        if (!file) return { text: 'Fayl kerak: marketing import ./instagram.csv' };
        const { headers, rows } = readCsv(readFileSync(file, 'utf8'));
        const col = (name: string): number => headers.findIndex((h) => h.toLowerCase().includes(name));
        const iDate = col('date') >= 0 ? col('date') : col('sana');
        const iPlat = col('platform');
        const iMetric = col('metric');
        const iValue = col('value') >= 0 ? col('value') : col('qiymat');
        if ([iDate, iPlat, iMetric, iValue].some((i) => i < 0)) {
          return { text: `Ustunlar kerak: date, platform, metric, value. Topilgani: ${headers.join(', ')}` };
        }
        let n = 0;
        ctx.db.tx(() => {
          for (const r of rows) {
            const v = Number((r[iValue] ?? '').replace(/\s/g, '').replace(',', '.'));
            if (!Number.isFinite(v)) continue;
            ctx.db.run(
              `INSERT INTO marketing_metrics(date, platform, metric, value) VALUES(?,?,?,?)
               ON CONFLICT(date, platform, metric, account) DO UPDATE SET value = excluded.value`,
              r[iDate],
              r[iPlat],
              r[iMetric],
              v,
            );
            n++;
          }
        });
        return { text: `📥 ${n} ta ko‘rsatkich yuklandi.` };
      },
    },
    {
      name: 'report',
      usage: 'marketing report [--days=30] [--html]',
      about: 'Platformalar bo‘yicha tahlil, o‘sish/tushish va tavsiyalar.',
      run: (ctx, argv) => {
        const a = parseArgs(argv);
        const days = a.num('days', 30);
        const to = dateKey(ctx.now, ctx.cfg.tz);
        const from = dateKey(addDays(ctx.now, -days + 1), ctx.cfg.tz);
        const prevTo = dateKey(addDays(ctx.now, -days), ctx.cfg.tz);
        const prevFrom = dateKey(addDays(ctx.now, -days * 2 + 1), ctx.cfg.tz);

        const platforms = platformRows(ctx, from, to);
        const prevPlatforms = new Map(platformRows(ctx, prevFrom, prevTo).map((r) => [r.platform, r]));
        const metrics = sumBy(ctx, from, to, 'metric');
        const prevMetrics = new Map(sumBy(ctx, prevFrom, prevTo, 'metric').map((r) => [r.key, r.total]));
        const findings = marketingFindings(ctx, from, to, prevFrom, prevTo);

        if (!platforms.length) {
          return { text: `Ma’lumot yo‘q (${from}…${to}). Kiritish: marketing set instagram reach 15400` };
        }

        const text = [
          `Davr: ${from} … ${to} (${days} kun)`,
          '',
          table(
            ['Metrika', 'Joriy', 'Oldingi davr', 'O‘zgarish'],
            metrics.map((m) => [
              METRICS[m.key] ?? m.key,
              compact(m.total),
              compact(prevMetrics.get(m.key) ?? 0),
              growth(prevMetrics.get(m.key) ?? 0, m.total).text,
            ]),
          ),
          '',
          table(
            ['Platforma', 'Auditoriya', 'Bosish', 'Lid', 'Qo‘ng‘iroq', 'Xarajat', 'Lid o‘zgarishi'],
            platforms.map((p) => [
              p.platform,
              compact(p.audience),
              compact(p.clicks),
              p.leads,
              p.calls,
              p.cost ? compact(p.cost) : '—',
              growth(prevPlatforms.get(p.platform)?.leads ?? 0, p.leads).text,
            ]),
          ),
          '',
          'Xulosa va tavsiyalar:',
          ...findings.map((f) => `  • ${f}`),
        ].join('\n');

        const files: string[] = [];
        if (a.has('html')) {
          const blocks: Block[] = [
            {
              type: 'kpis',
              items: metrics.slice(0, 5).map((m) => {
                const g = growth(prevMetrics.get(m.key) ?? 0, m.total);
                return { label: METRICS[m.key] ?? m.key, value: compact(m.total), delta: g.text, up: g.up };
              }),
            },
            { type: 'bars', title: 'Lidlar — platformalar bo‘yicha', items: platforms.map((p) => ({ label: p.platform, value: p.leads })) },
            { type: 'bars', title: 'Auditoriya — platformalar bo‘yicha', items: platforms.map((p) => ({ label: p.platform, value: p.audience })) },
            { type: 'line', title: 'Lidlar dinamikasi', points: seriesFor(ctx, 'leads', from, to) },
            { type: 'line', title: 'Xarajat dinamikasi', points: seriesFor(ctx, 'cost', from, to) },
            {
              type: 'table',
              title: 'Metrikalar',
              headers: ['Metrika', 'Joriy', 'Oldingi', 'O‘zgarish'],
              rows: metrics.map((m) => [
                METRICS[m.key] ?? m.key,
                compact(m.total),
                compact(prevMetrics.get(m.key) ?? 0),
                growth(prevMetrics.get(m.key) ?? 0, m.total).text,
              ]),
            },
            { type: 'text', title: 'Xulosa va tavsiyalar', body: findings },
          ];
          files.push(
            writeReport(join(ctx.cfg.outDir, `marketing-${to}.html`), {
              title: 'Marketing hisoboti',
              subtitle: `${from} … ${to}`,
              blocks,
            }),
          );
        }

        return {
          text: files.length ? `${text}\n\n📄 HTML hisobot: ${files[0]}` : text,
          data: { platforms, metrics, findings },
          files,
        };
      },
    },
    {
      name: 'advise',
      usage: 'marketing advise [--days=30]',
      about: 'O‘sish uchun tavsiyalar.',
      run: async (ctx, argv) => {
        const days = parseArgs(argv).num('days', 30);
        const to = dateKey(ctx.now, ctx.cfg.tz);
        const from = dateKey(addDays(ctx.now, -days + 1), ctx.cfg.tz);
        const prevTo = dateKey(addDays(ctx.now, -days), ctx.cfg.tz);
        const prevFrom = dateKey(addDays(ctx.now, -days * 2 + 1), ctx.cfg.tz);
        const facts = marketingFindings(ctx, from, to, prevFrom, prevTo);
        const res = await ctx.llm.run({
          kind: 'advise',
          topic: `Marketing (${from}…${to})`,
          facts,
          question: 'Qaysi kanalni kuchaytirish kerak va nima qilish kerak? 5 ta aniq qadam.',
        });
        return { text: res.text, data: facts };
      },
    },
    {
      name: 'manbalar',
      usage: 'marketing manbalar',
      about: 'Qaysi platforma ulangan, qaysisi yo‘q.',
      run: (ctx) => {
        const sources = makeSources(ctx.cfg, ctx.db);
        const rows = sources.map((s) => [s.id, s.ready ? '✅ ulangan' : '— ulanmagan', s.status]);
        return {
          text: [
            table(['Platforma', 'Holat', 'Izoh'], rows),
            '',
            'Ulash: hamroh marketing ulash   (Google uchun bitta rozilik yetadi)',
            'Yig‘ish: hamroh marketing sync --days=7',
          ].join('\n'),
          data: sources.map((s) => ({ id: s.id, ready: s.ready, status: s.status })),
        };
      },
    },
    {
      name: 'ulash',
      usage: 'marketing ulash',
      about: 'Google Ads, YouTube va Business Profile uchun ruxsat havolasi.',
      run: (ctx) => {
        if (!ctx.cfg.googleClientId || !ctx.cfg.googleClientSecret) {
          return {
            text: [
              'Avval Google Cloud da OAuth mijozi yarating va .env ga yozing:',
              '  GOOGLE_CLIENT_ID=...',
              '  GOOGLE_CLIENT_SECRET=...',
              '',
              'Batafsil: docs/MARKETING.md',
            ].join('\n'),
          };
        }
        const base = ctx.cfg.webBase || `http://127.0.0.1:${ctx.cfg.webPort}`;
        const redirect = `${base.replace(/\/+$/, '')}/oauth/google/callback`;
        const url = consentUrl(ctx.cfg.googleClientId, redirect, [CALENDAR_SCOPE, ...MARKETING_SCOPES]);
        return {
          text: [
            'Quyidagi havolani brauzerda oching va ruxsat bering:',
            '',
            url,
            '',
            `Qaytish manzili: ${redirect}`,
            'Shu manzil Google Cloud dagi «Authorized redirect URIs» ro‘yxatida ham bo‘lishi shart.',
            '',
            'Eslatma: bu havola kalendar + Ads + YouTube + Business Profile ruxsatlarini',
            'birdan so‘raydi. Avval faqat kalendarga ruxsat bergan bo‘lsangiz, qayta',
            'rozilik kerak — eski token marketing API larini ochmaydi.',
          ].join('\n'),
          data: { url, redirect },
        };
      },
    },
    {
      name: 'sync',
      usage: 'marketing sync [--days=7] [--platform=instagram] [--from=2026-09-01] [--to=2026-09-08]',
      about: 'Rasmiy API lardan ko‘rsatkichlarni yig‘ish.',
      run: async (ctx, argv) => {
        const a = parseArgs(argv);
        const days = a.num('days', 7);
        const to = a.str('to', dateKey(ctx.now, ctx.cfg.tz));
        const from = a.str('from', dateKey(addDays(ctx.now, -days + 1), ctx.cfg.tz));
        const only = a.str('platform', '');

        let sources = makeSources(ctx.cfg, ctx.db);
        if (only) sources = sources.filter((s) => s.id === only);
        if (!sources.length) {
          return { text: `Bunday platforma yo‘q: ${only}. Mavjud: ${PLATFORMS.join(', ')}` };
        }

        const lines: string[] = [`Davr: ${from} … ${to}`, ''];
        const summary: { platform: string; saved: number; error?: string }[] = [];

        for (const source of sources) {
          if (!source.ready) {
            lines.push(`—  ${source.id}: ${source.status}`);
            summary.push({ platform: source.id, saved: 0, error: 'ulanmagan' });
            continue;
          }
          try {
            const { points, note } = await source.pull(from, to);
            ctx.db.tx(() => {
              for (const p of points) {
                ctx.db.run(
                  `INSERT INTO marketing_metrics(date, platform, metric, value, account) VALUES(?,?,?,?,?)
                   ON CONFLICT(date, platform, metric, account) DO UPDATE SET value = excluded.value`,
                  p.date,
                  source.id,
                  p.metric,
                  p.value,
                  p.account ?? 'main',
                );
              }
            });
            lines.push(`✅ ${source.id}: ${points.length} ta qiymat saqlandi  (${note})`);
            summary.push({ platform: source.id, saved: points.length });
          } catch (e) {
            // Bitta platforma yiqilsa qolganlari davom etadi.
            const msg = (e as Error).message;
            const head = msg.split('\n')[0] ?? msg;
            lines.push(head.startsWith(`${source.id}:`) ? `✗  ${head}` : `✗  ${source.id}: ${head}`);
            summary.push({ platform: source.id, saved: 0, error: msg });
          }
        }

        const total = summary.reduce((n, s) => n + s.saved, 0);
        lines.push('', total ? `Jami ${total} ta qiymat. Hisobot: marketing report --html` : 'Yangi ma’lumot yo‘q.');
        return { text: lines.join('\n'), data: summary };
      },
    },
  ],

  jobs: [
    {
      name: 'marketing.sync',
      cron: '30 6 * * *',
      run: async (ctx) => {
        // Oxirgi 3 kun: platformalar kechagi raqamlarni keyin ham tuzatadi.
        const to = dateKey(ctx.now, ctx.cfg.tz);
        const from = dateKey(addDays(ctx.now, -2), ctx.cfg.tz);
        const sources = makeSources(ctx.cfg, ctx.db).filter((s) => s.ready);
        if (!sources.length) return 'ulangan manba yo‘q';

        let saved = 0;
        const failed: string[] = [];
        for (const source of sources) {
          try {
            const { points } = await source.pull(from, to);
            ctx.db.tx(() => {
              for (const pt of points) {
                ctx.db.run(
                  `INSERT INTO marketing_metrics(date, platform, metric, value, account) VALUES(?,?,?,?,?)
                   ON CONFLICT(date, platform, metric, account) DO UPDATE SET value = excluded.value`,
                  pt.date,
                  source.id,
                  pt.metric,
                  pt.value,
                  pt.account ?? 'main',
                );
              }
            });
            saved += points.length;
          } catch (e) {
            const head = (e as Error).message.split(String.fromCharCode(10))[0] ?? '';
            failed.push(head.startsWith(`${source.id}:`) ? head : `${source.id}: ${head}`);
          }
        }
        return failed.length ? `${saved} ta qiymat; xato — ${failed.join('; ')}` : `${saved} ta qiymat`;
      },
    },
    {
      name: 'marketing.oylik-hisobot',
      cron: '0 10 1 * *',
      run: (ctx) => {
        const period = monthKey(addDays(ctx.now, -1), ctx.cfg.tz);
        const from = `${period}-01`;
        const to = `${period}-31`;
        const metrics = sumBy(ctx, from, to, 'metric');
        if (!metrics.length) return 'ma’lumot yo‘q';
        const file = writeReport(join(ctx.cfg.outDir, `marketing-${period}.html`), {
          title: `Marketing hisoboti — ${period}`,
          blocks: [
            { type: 'kpis', items: metrics.map((m) => ({ label: METRICS[m.key] ?? m.key, value: compact(m.total) })) },
            { type: 'bars', title: 'Lidlar — platformalar', items: platformRows(ctx, from, to).map((p) => ({ label: p.platform, value: p.leads })) },
          ],
        });
        return `oylik hisobot: ${file}`;
      },
    },
  ],
};
