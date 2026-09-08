import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { openDb } from '../src/core/db.ts';
import type { Ctx } from '../src/core/types.ts';
import { rulesProvider } from '../src/llm/rules.ts';
import { loadConfig } from '../src/core/config.ts';
import { totals, savingTips } from '../src/modules/finance.ts';
import { dayKpis, weakSpots } from '../src/modules/report.ts';
import { platformRows, marketingFindings } from '../src/modules/marketing.ts';
import { stats } from '../src/modules/products.ts';
import { enqueue, pending } from '../src/modules/notify.ts';
import { modules } from '../src/modules/index.ts';
import { collect } from '../src/core/brief.ts';
import { writeXlsx, writeDocx } from '../src/util/office.ts';
import { zip, crc32 } from '../src/util/zip.ts';

const NOW = new Date('2026-09-08T06:00:00.000Z'); // Toshkentda 11:00

function ctxFor(): Ctx {
  process.env['HAMROH_DB'] = ':memory:';
  const cfg = { ...loadConfig(), dbPath: ':memory:', tz: 'Asia/Tashkent', currency: 'UZS', offline: true };
  return { cfg, db: openDb(':memory:'), llm: rulesProvider(), now: NOW };
}

const iso = (daysAgo: number, h = 12): string =>
  new Date(Date.UTC(2026, 8, 8 - daysAgo, h - 5, 0, 0)).toISOString();

test('moliya: kirim-chiqim va tejash maslahatlari', () => {
  const ctx = ctxFor();
  const add = (kind: string, amount: number, cat: string, need = 'kerak', d = 0): void => {
    ctx.db.run(
      `INSERT INTO ledger(ts, kind, amount, currency, category, source, necessity) VALUES(?,?,?,?,?,?,?)`,
      iso(d), kind, amount, 'UZS', cat, 'manual', need,
    );
  };
  add('income', 10_000_000, 'savdo');
  add('expense', 4_000_000, 'arenda');
  add('expense', 1_000_000, 'ovqat', 'kerakmas');

  const t = totals(ctx, '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z');
  assert.equal(t.income, 10_000_000);
  assert.equal(t.expense, 5_000_000);
  assert.equal(t.net, 5_000_000);
  assert.equal(t.waste, 1_000_000);

  const tips = savingTips(ctx, '2026-09');
  assert.ok(tips.some((s) => s.includes('kerakmas')));
  assert.ok(tips.some((s) => s.includes('arenda')));
  ctx.db.close();
});

test('moliya: byudjet buzilishi aniqlanadi', () => {
  const ctx = ctxFor();
  ctx.db.run(`INSERT INTO ledger(ts, kind, amount, currency, category, source) VALUES(?,?,?,?,?,?)`,
    iso(0), 'expense', 3_000_000, 'UZS', 'ovqat', 'manual');
  ctx.db.run(`INSERT INTO budgets(category, month, limit_amount, currency) VALUES(?,?,?,?)`,
    'ovqat', '2026-09', 2_000_000, 'UZS');
  assert.ok(savingTips(ctx, '2026-09').some((s) => s.includes('Byudjet buzildi')));
  ctx.db.close();
});

test('hisobot: KPI va kamchiliklar', () => {
  const ctx = ctxFor();
  ctx.db.run(`INSERT INTO ledger(ts, kind, amount, currency, category, source) VALUES(?,?,?,?,?,?)`,
    iso(0), 'income', 5_000_000, 'UZS', 'savdo', 'manual');
  ctx.db.run(`INSERT INTO ledger(ts, kind, amount, currency, category, source) VALUES(?,?,?,?,?,?)`,
    iso(1), 'income', 2_000_000, 'UZS', 'savdo', 'manual');

  const kpis = dayKpis(ctx, NOW);
  const income = kpis.find((k) => k.key === 'income');
  assert.equal(income?.today, 5_000_000);
  assert.equal(income?.prev, 2_000_000);

  const weak = weakSpots(ctx, kpis);
  assert.ok(weak.some((w) => w.includes('lid')));
  ctx.db.close();
});

test('marketing: turli metrikalar qo‘shilib ketmaydi', () => {
  const ctx = ctxFor();
  const set = (platform: string, metric: string, value: number): void => {
    ctx.db.run(`INSERT INTO marketing_metrics(date, platform, metric, value) VALUES(?,?,?,?)`,
      '2026-09-08', platform, metric, value);
  };
  set('instagram', 'reach', 10_000);
  set('instagram', 'leads', 20);
  set('google_ads', 'cost', 2_000_000);
  set('google_ads', 'leads', 5);

  const rows = platformRows(ctx, '2026-09-01', '2026-09-30');
  const ig = rows.find((r) => r.platform === 'instagram');
  assert.equal(ig?.audience, 10_000);
  assert.equal(ig?.leads, 20);
  assert.equal(rows.find((r) => r.platform === 'google_ads')?.cost, 2_000_000);

  const findings = marketingFindings(ctx, '2026-09-01', '2026-09-30', '2026-08-01', '2026-08-31');
  assert.ok(findings.some((f) => f.includes('lid narxi')));
  ctx.db.close();
});

test('mahsulot: foyda tannarx bo‘yicha hisoblanadi', () => {
  const ctx = ctxFor();
  ctx.db.run(`INSERT INTO products(name, category, cost_price, sell_price) VALUES(?,?,?,?)`,
    'Kurs', 'kurs', 1_000_000, 3_000_000);
  ctx.db.run(`INSERT INTO sales(ts, product_id, qty, unit_price, discount) VALUES(?,?,?,?,?)`,
    iso(0), 1, 2, 3_000_000, 500_000);

  const rows = stats(ctx, '2026-09');
  assert.equal(rows[0]?.revenue, 5_500_000);
  assert.equal(rows[0]?.profit, 3_500_000);
  ctx.db.close();
});

test('eslatma: dedupe kaliti takrorlanmaydi', () => {
  const ctx = ctxFor();
  assert.equal(enqueue(ctx, { module: 't', title: 'A', body: 'b', dedupeKey: 'k1' }), true);
  assert.equal(enqueue(ctx, { module: 't', title: 'A', body: 'b', dedupeKey: 'k1' }), false);
  assert.equal(pending(ctx).length, 1);
  ctx.db.close();
});

test('brifing: hamma modul bo‘limlari xatosiz yig‘iladi', async () => {
  const ctx = ctxFor();
  const morning = await collect(ctx, modules, 'morning');
  const evening = await collect(ctx, modules, 'evening');
  for (const s of [...morning, ...evening]) {
    assert.ok(s.title.length > 0, 'bo‘lim sarlavhasi bo‘sh');
    assert.ok(!s.title.includes('xato'), `modul xato berdi: ${s.title} — ${s.lines.join(' ')}`);
  }
  assert.ok(morning.length >= 3);
  ctx.db.close();
});

test('zip: crc32 va OOXML paketlari haqiqiy', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);

  const dir = mkdtempSync(join(tmpdir(), 'hamroh-'));
  try {
    const xlsx = writeXlsx(join(dir, 'a.xlsx'), [{ name: 'Test', headers: ['A', 'B'], rows: [['x', 1]] }]);
    const docx = writeDocx(join(dir, 'a.docx'), [{ style: 'title', text: 'Sarlavha' }, { style: 'p', text: 'Matn' }]);
    for (const f of [xlsx, docx]) {
      const buf = readFileSync(f);
      assert.equal(buf.subarray(0, 2).toString(), 'PK', `${f} ZIP emas`);
      assert.ok(buf.includes(Buffer.from('[Content_Types].xml')), `${f} da Content_Types yo‘q`);
    }
    const empty = zip([]);
    assert.equal(empty.length, 22);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
