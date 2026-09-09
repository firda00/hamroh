import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { openDb } from '../src/core/db.ts';
import type { Ctx } from '../src/core/types.ts';
import { rulesProvider } from '../src/llm/rules.ts';
import { disabledStt } from '../src/stt/provider.ts';
import { disabledTts } from '../src/tts/provider.ts';
import { disabledTel } from '../src/tel/provider.ts';
import { disabledSms } from '../src/sms/provider.ts';
import { disabledGcal } from '../src/gcal/client.ts';
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
  return { cfg, db: openDb(':memory:'), llm: rulesProvider(), stt: disabledStt(), tts: disabledTts(), tel: disabledTel(), sms: disabledSms(), gcal: disabledGcal(), now: NOW };
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

test('ovoz: Whisper serveriga multipart yuboriladi va matn qaytadi', async () => {
  const { createServer } = await import('node:http');
  const { localStt } = await import('../src/stt/local.ts');

  let seenModel = '';
  let seenLang = '';
  let sawFile = false;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      sawFile = body.includes('name="file"') && body.includes('filename="voice.ogg"');
      seenModel = body.match(/name="model"\r?\n\r?\n(.+)/)?.[1]?.trim() ?? '';
      seenLang = body.match(/name="language"\r?\n\r?\n(.+)/)?.[1]?.trim() ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: '  Ertaga soat uchda uchrashuv bor  ', language: 'uz', duration: 4.2 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  try {
    const stt = localStt({ url: `http://127.0.0.1:${port}/v1`, model: 'faster-whisper-large-v3', language: 'uz' });
    assert.equal(stt.enabled, true);
    const out = await stt.transcribe(new Uint8Array([1, 2, 3, 4]), 'voice.ogg');
    assert.equal(out.text, 'Ertaga soat uchda uchrashuv bor');
    assert.equal(out.language, 'uz');
    assert.equal(out.durationSec, 4.2);
    assert.ok(sawFile, 'fayl multipart ichida yuborilmadi');
    assert.equal(seenModel, 'faster-whisper-large-v3');
    assert.equal(seenLang, 'uz');
  } finally {
    server.close();
  }
});

test('ovoz: server yiqilsa tushunarli xato', async () => {
  const { localStt } = await import('../src/stt/local.ts');
  const stt = localStt({ url: 'http://127.0.0.1:1/v1', model: 'x', language: 'uz', timeoutMs: 1500 });
  await assert.rejects(
    () => stt.transcribe(new Uint8Array([0]), 'a.ogg'),
    (e: Error) => e.message.includes('Whisper serveri bilan aloqa yo‘q'),
  );
});

test('ovoz: o‘chirilganda yo‘riqnoma beradi', async () => {
  const stt = disabledStt();
  assert.equal(stt.enabled, false);
  await assert.rejects(
    () => stt.transcribe(new Uint8Array([0]), 'a.ogg'),
    (e: Error) => e.message.includes('HAMROH_STT') && e.message.includes('docs/VOICE.md'),
  );
});

test('ovoz: navbat faqat o‘girilmagan audio xabarlarni oladi', async () => {
  const ctx = ctxFor();
  const { pendingVoice } = await import('../src/modules/voice.ts');
  const add = (kind: string | null, mediaId: string | null, done: string | null): void => {
    ctx.db.run(
      `INSERT INTO messages(ts, channel, direction, peer, body, media_kind, media_id, transcribed_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      iso(0), 'telegram', 'in', 'Aziz', '[voice]', kind, mediaId, done,
    );
  };
  add('voice', 'f1', null); // olinishi kerak
  add('audio', 'f2', null); // olinishi kerak
  add('voice', 'f3', '2026-09-08T10:00:00.000Z'); // allaqachon o'girilgan
  add('photo', 'f4', null); // audio emas
  add('voice', null, null); // media_id yo'q

  const items = pendingVoice(ctx, 10);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((m) => m.media_id).sort(), ['f1', 'f2']);
  ctx.db.close();
});

test('bot: ruxsat nazorati — ro‘yxatdagilar va begonalar', async () => {
  const ctx = ctxFor();
  const { isAllowed, allowedIds } = await import('../src/modules/bot.ts');

  ctx.cfg.telegram = { token: 'x', chatId: '111' };
  delete process.env['TELEGRAM_ALLOWED_IDS'];
  assert.deepEqual(allowedIds(ctx), ['111']);
  assert.equal(isAllowed(ctx, '111', '999'), true, 'chat_id bo‘yicha ruxsat');
  assert.equal(isAllowed(ctx, '222', '999'), false, 'begona chat kirmasligi kerak');

  process.env['TELEGRAM_ALLOWED_IDS'] = '222, 333';
  assert.equal(isAllowed(ctx, '222', '0'), true);
  assert.equal(isAllowed(ctx, '444', '333'), true, 'user_id bo‘yicha ham');
  assert.equal(isAllowed(ctx, '444', '555'), false);
  delete process.env['TELEGRAM_ALLOWED_IDS'];

  // Ro'yxat umuman bo'sh bo'lsa — hech kimga ruxsat yo'q (ataylab)
  ctx.cfg.telegram = { token: 'x', chatId: '' };
  assert.equal(isAllowed(ctx, '111', '111'), false);
  ctx.db.close();
});

test('bot: tasdiq kutayotgan amal bir marta bajariladi', async () => {
  const ctx = ctxFor();
  const { stashAction, takeAction } = await import('../src/modules/bot.ts');

  const intent = {
    module: 'aloqa', command: 'sms', args: ['+998901234567', 'salom'],
    confidence: 0.8, explain: 'SMS yuborish', needsConfirm: true, source: 'rules' as const,
  };
  const id = stashAction(ctx, '111', intent);
  assert.ok(id.length > 0);
  assert.ok(id.length <= 64, 'callback_data 64 baytdan oshmasligi kerak');

  const first = takeAction(ctx, id);
  assert.deepEqual(first?.args, intent.args);
  assert.equal(takeAction(ctx, id), null, 'ikkinchi marta bajarilmasligi kerak');
  assert.equal(takeAction(ctx, 'yoq'), null);
  ctx.db.close();
});

test('sms buyrug‘i: raqam bazadan topiladi va tasdiq talab qilinadi', async () => {
  const ctx = ctxFor();
  const { routeByRules } = await import('../src/intent/rules.ts');
  ctx.db.run(
    `INSERT INTO leads(created_at, name, phone, source) VALUES(?,?,?,?)`,
    iso(0), 'Nodira opa', '+998901234567', 'instagram',
  );

  const intent = routeByRules(ctx, 'Nodira opaga sms yubor ertaga soat 10 da kutamiz');
  assert.ok(intent, 'sms buyrug‘i tanilmadi');
  assert.equal(intent.module, 'aloqa');
  assert.equal(intent.command, 'sms');
  assert.equal(intent.args[0], '+998901234567', 'raqam bazadan topilishi kerak');
  assert.ok(intent.args[1]?.includes('kutamiz'), intent.args[1]);
  assert.equal(intent.needsConfirm, true, 'SMS tasdiqsiz ketmasligi kerak');

  // Notanish ism va raqamsiz — buyruq yasalmaydi
  assert.equal(routeByRules(ctx, 'kimgadir sms yubor'), null);
  ctx.db.close();
});

test('qo‘ng‘iroq: raqam bir ko‘rinishga keltiriladi', async () => {
  const { normalizeNumber } = await import('../src/tel/provider.ts');
  assert.equal(normalizeNumber('901234567'), '+998901234567');
  assert.equal(normalizeNumber('998901234567'), '+998901234567');
  assert.equal(normalizeNumber('+998 90 123-45-67'), '+998901234567');
  assert.equal(normalizeNumber('+12025550100'), '+12025550100');
});

test('qo‘ng‘iroq: faqat ruxsat berilgan raqamlarga', async () => {
  const { isAllowedNumber, allowedNumbers } = await import('../src/tel/index.ts');
  const base = { ...loadConfig(), telMyNumber: '901234567', telAllowed: ['+998907776655'] };

  assert.deepEqual(allowedNumbers(base), ['+998901234567', '+998907776655']);
  assert.equal(isAllowedNumber(base, '+998901234567'), true);
  assert.equal(isAllowedNumber(base, '90 123 45 67'), true, 'formatdan qat’i nazar');
  assert.equal(isAllowedNumber(base, '+998901110000'), false, 'begona raqam');

  // Ro'yxat bo'sh bo'lsa hech kimga ruxsat yo'q
  const empty = { ...base, telMyNumber: '', telAllowed: [] };
  assert.deepEqual(allowedNumbers(empty), []);
  assert.equal(isAllowedNumber(empty, '+998901234567'), false);
});

test('qo‘ng‘iroq: o‘chirilganda va ruxsatsiz raqamda tushunarli xato', async () => {
  const ctx = ctxFor();
  const { makeCall } = await import('../src/modules/call.ts');

  await assert.rejects(
    () => makeCall(ctx, '+998901234567', 'salom'),
    (e: Error) => e.message.includes('HAMROH_TEL=off'),
  );

  // Provayder yoqilgan, lekin raqam ro'yxatda yo'q
  ctx.tel = { id: 'test', enabled: true, call: () => Promise.resolve({ ok: true, provider: 'test' }) };
  ctx.tts = { id: 'test', enabled: true, speak: () => Promise.resolve({ bytes: new Uint8Array([1]), ext: 'wav', provider: 'test' }) };
  ctx.cfg.telMyNumber = '+998901234567';
  ctx.cfg.telAllowed = [];

  await assert.rejects(
    () => makeCall(ctx, '+998907776655', 'salom'),
    (e: Error) => e.message.includes('ruxsat ro‘yxatida yo‘q'),
  );

  // O'z raqamiga — ishlaydi va tarixga yoziladi
  const out = await makeCall(ctx, '901234567', 'Arenda to‘lovi bugun');
  assert.equal(out.ok, true);
  assert.equal(out.to, '+998901234567');
  const row = ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM calls WHERE direction='out'`);
  assert.equal(row?.n, 1, 'chiquvchi qo‘ng‘iroq tarixga yozilishi kerak');
  ctx.db.close();
});

test('sozlash ustasi: javoblar .env ga to‘g‘ri yoziladi', async () => {
  const { runWizard } = await import('../src/modules/setup.ts');
  const { readEnvValue } = await import('../src/util/env.ts');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'hamroh-setup-'));
  const envPath = join(dir, '.env');
  writeFileSync(envPath, '# izoh\nHAMROH_CITY=Tashkent\nHAMROH_LLM=rules\n');

  const ctx = ctxFor();
  // Savollar tartibi bo'yicha javoblar (tarmoqqa chiqadigan yo'llar chetlab o'tiladi)
  const answers = [
    'Samarqand',        // shahar
    'Asia/Tashkent',    // vaqt zonasi
    'UZS',              // valyuta
    '',                 // telegram token — o'tkazib yuboriladi
    'rules',            // LLM
    'yo‘q',             // STT kerak emas
    'yo‘q',             // SMS kerak emas
    '901234567',        // telefon raqami
  ];
  let i = 0;
  const asked: string[] = [];
  const ask = async (q: string, current = ''): Promise<string> => {
    asked.push(q);
    return answers[i++] ?? current;
  };

  try {
    const notes = await runWizard(ctx, ask, () => {}, envPath);
    const after = readFileSync(envPath, 'utf8');

    assert.equal(readEnvValue(after, 'HAMROH_CITY'), 'Samarqand');
    assert.equal(readEnvValue(after, 'HAMROH_STT'), 'off');
    assert.equal(readEnvValue(after, 'HAMROH_SMS'), 'off');
    assert.equal(readEnvValue(after, 'HAMROH_TEL_MY_NUMBER'), '+998901234567', 'raqam normallashishi kerak');
    assert.ok(after.includes('# izoh'), 'izohlar saqlanishi kerak');
    assert.equal(readEnvValue(after, 'TELEGRAM_BOT_TOKEN'), '', 'bo‘sh token yozilmasligi kerak');
    assert.ok(notes.some((n) => n.includes('CALLS.md')), 'telefon bo‘yicha eslatma berilishi kerak');
    assert.equal(asked.length, answers.length, `savollar soni: ${asked.join(' | ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    ctx.db.close();
  }
});

test('moliya: toifa matndan avtomatik aniqlanadi', async () => {
  const ctx = ctxFor();
  const { financeModule } = await import('../src/modules/finance.ts');
  const out = financeModule.commands.find((c) => c.name === 'out');
  assert.ok(out);

  const cases: [string[], string][] = [
    [['250000', 'taksiga', 'berdim'], 'transport'],
    [['1200000', 'ofis', 'arendasi'], 'arenda'],
    [['90000', 'dorixonadan', 'dori'], 'sogliq'],
    [['300000', 'instagram', 'reklamasi'], 'reklama'],
    [['70000', 'tushunarsiz', 'narsa'], 'boshqa'],
    [['500000', '--cat=maxsus', 'qo‘lda'], 'maxsus'],
  ];

  for (const [args, expected] of cases) {
    await out.run(ctx, args);
    const row = ctx.db.get<{ category: string }>(`SELECT category FROM ledger ORDER BY id DESC LIMIT 1`);
    assert.equal(row?.category, expected, `"${args.join(' ')}" -> ${row?.category}`);
  }

  // Kirim har doim savdo
  const inCmd = financeModule.commands.find((c) => c.name === 'in');
  await inCmd?.run(ctx, ['1000000', 'kurs to‘lovi']);
  assert.equal(ctx.db.get<{ category: string }>(`SELECT category FROM ledger ORDER BY id DESC LIMIT 1`)?.category, 'savdo');
  ctx.db.close();
});

test('SMS: Eskiz zanjiri — login, yuborish, token keshi, 401 da qayta kirish', async () => {
  const { createServer } = await import('node:http');
  const { eskizSms } = await import('../src/sms/eskiz.ts');
  const { queueSms, flushSms, sentToday } = await import('../src/modules/comms.ts');

  let logins = 0;
  let sends = 0;
  let rejectOnce = false;
  const seen: { phone: string; message: string; from: string }[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const field = (name: string): string =>
        body.match(new RegExp(`name="${name}"\r?\n\r?\n([^\r]*)`))?.[1] ?? '';
      const auth = req.headers.authorization ?? '';
      res.setHeader('content-type', 'application/json');

      if (req.url?.endsWith('/auth/login')) {
        logins++;
        res.writeHead(200);
        res.end(JSON.stringify({ data: { token: `tok-${logins}` } }));
        return;
      }
      if (req.url?.endsWith('/user/get-limit')) {
        res.writeHead(200);
        res.end(JSON.stringify({ data: { balance: 1234 } }));
        return;
      }
      if (req.url?.endsWith('/message/sms/send')) {
        if (rejectOnce && auth === 'Bearer tok-1') {
          rejectOnce = false;
          res.writeHead(401);
          res.end(JSON.stringify({ message: 'Unauthorized' }));
          return;
        }
        sends++;
        seen.push({ phone: field('mobile_phone'), message: field('message'), from: field('from') });
        res.writeHead(200);
        res.end(JSON.stringify({ id: `msg-${sends}`, status: 'waiting' }));
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const ctx = ctxFor();
  ctx.sms = eskizSms({
    db: ctx.db,
    email: 'a@b.uz',
    password: 'parol',
    from: '4546',
    base: `http://127.0.0.1:${port}/api`,
  });

  try {
    // 1. Navbat -> yuborish
    queueSms(ctx, '+998 90 123-45-67', 'Ertaga soat 10 da kutamiz');
    queueSms(ctx, '901112233', 'Ikkinchi xabar');
    const r1 = await flushSms(ctx);
    assert.equal(r1.sent, 2, r1.lines.join(' | '));
    assert.equal(r1.failed, 0);
    assert.equal(logins, 1, 'token keshlanishi kerak — bitta login');
    assert.equal(seen[0]?.phone, '998901234567', 'raqam plyussiz bo‘lishi kerak');
    assert.equal(seen[0]?.from, '4546');

    const row = ctx.db.get<{ status: string; external_id: string; sent_at: string }>(
      `SELECT status, external_id, sent_at FROM messages WHERE channel='sms' ORDER BY id LIMIT 1`,
    );
    assert.equal(row?.status, 'yuborildi');
    assert.equal(row?.external_id, 'msg-1');
    assert.ok(row?.sent_at);
    assert.equal(sentToday(ctx), 2);

    // 2. Token eskirsa — qayta kiradi va xabar baribir ketadi
    rejectOnce = true;
    queueSms(ctx, '901112233', 'Uchinchi');
    const r2 = await flushSms(ctx);
    assert.equal(r2.sent, 1, r2.lines.join(' | '));
    assert.equal(logins, 2, '401 dan keyin qayta login bo‘lishi kerak');

    // 3. Kunlik chegara
    ctx.cfg.smsDailyLimit = 3;
    queueSms(ctx, '901112233', 'To‘rtinchi');
    const r3 = await flushSms(ctx);
    assert.equal(r3.sent, 0, 'chegaradan oshmasligi kerak');
    assert.ok(r3.lines[0]?.includes('chegara'), r3.lines[0]);
    assert.equal(
      ctx.db.get<{ status: string }>(`SELECT status FROM messages ORDER BY id DESC LIMIT 1`)?.status,
      'navbatda',
      'chegara tufayli qolgan xabar navbatda turishi kerak',
    );

    // 4. Balans
    assert.equal(await ctx.sms.balance?.(), '1234');
  } finally {
    server.close();
    ctx.db.close();
  }
});

test('SMS: xato bo‘lsa xabar yo‘qolmaydi, keyin qayta uriniladi', async () => {
  const { queueSms, flushSms, pendingSms } = await import('../src/modules/comms.ts');
  const ctx = ctxFor();

  let fail = true;
  ctx.sms = {
    id: 'test',
    enabled: true,
    send: () => (fail ? Promise.reject(new Error('shablon mos emas')) : Promise.resolve({ ok: true, id: 'x1', provider: 'test' })),
  };

  queueSms(ctx, '901112233', 'Salom');
  const bad = await flushSms(ctx);
  assert.equal(bad.failed, 1);
  const stored = ctx.db.get<{ status: string; error: string }>(`SELECT status, error FROM messages ORDER BY id DESC LIMIT 1`);
  assert.equal(stored?.status, 'xato');
  assert.ok(stored?.error.includes('shablon'));
  assert.equal(pendingSms(ctx).length, 1, 'xato xabar navbatda qolishi kerak');

  fail = false;
  const good = await flushSms(ctx);
  assert.equal(good.sent, 1, 'keyingi urinishda ketishi kerak');
  assert.equal(pendingSms(ctx).length, 0);
  ctx.db.close();
});

test('Google Calendar: ikki tomonlama sinxronizatsiya', async () => {
  const { createServer } = await import('node:http');
  const { gcalClient } = await import('../src/gcal/client.ts');
  const { syncGcal } = await import('../src/modules/calendar-sync.ts');

  let remote: Record<string, unknown>[] = [];
  const created: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  let nextId = 100;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      const path = req.url ?? '';

      if (req.method === 'POST' && path.includes('/events')) {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        created.push(body);
        res.writeHead(200);
        res.end(JSON.stringify({ id: `g-${nextId++}`, ...body }));
        return;
      }
      if (req.method === 'DELETE') {
        deleted.push(decodeURIComponent(path.split('/').pop() ?? ''));
        res.writeHead(204);
        res.end();
        return;
      }
      if (path.includes('/events?')) {
        assert.ok(path.includes('singleEvents=true'), 'takrorlanuvchilar yoyilishi kerak');
        res.writeHead(200);
        res.end(JSON.stringify({ items: remote }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({ summary: 'Ish kalendari' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const ctx = ctxFor();
  ctx.gcal = gcalClient(
    { mode: 'oauth', who: 'test', accessToken: () => Promise.resolve('tok') },
    'primary',
    `http://127.0.0.1:${port}`,
  );

  try {
    // 1. Google -> mahalliy
    remote = [
      {
        id: 'g-1',
        summary: 'Investor bilan',
        location: 'Ofis',
        start: { dateTime: '2026-09-10T10:00:00Z' },
        end: { dateTime: '2026-09-10T11:00:00Z' },
      },
    ];
    const first = await syncGcal(ctx);
    assert.equal(first.pulled, 1, first.lines.join(' | '));
    const local = ctx.db.get<{ id: number; title: string; source: string }>(`SELECT * FROM events WHERE external_id='g-1'`);
    assert.equal(local?.title, 'Investor bilan');
    assert.equal(local?.source, 'google');

    // 2. Google'da nom o'zgardi -> mahalliy yangilanadi, dublikat yaratilmaydi
    remote[0]!['summary'] = 'Investor bilan (ko‘chirildi)';
    const second = await syncGcal(ctx);
    assert.equal(second.pulled, 0, 'mavjud hodisa qayta qo‘shilmasligi kerak');
    assert.equal(
      ctx.db.get<{ n: number }>(`SELECT COUNT(*) n FROM events WHERE external_id='g-1'`)?.n,
      1,
      'dublikat paydo bo‘ldi',
    );
    assert.equal(
      ctx.db.get<{ title: string }>(`SELECT title FROM events WHERE external_id='g-1'`)?.title,
      'Investor bilan (ko‘chirildi)',
    );

    // 3. Mahalliy -> Google
    ctx.db.run(
      `INSERT INTO events(title, start_at, end_at, location) VALUES(?,?,?,?)`,
      'Buxgalter bilan',
      '2026-09-11T09:00:00.000Z',
      '2026-09-11T10:00:00.000Z',
      'Zoom',
    );
    const third = await syncGcal(ctx);
    assert.equal(third.pushed, 1, third.lines.join(' | '));
    assert.equal(created[0]?.['summary'], 'Buxgalter bilan');
    assert.ok(
      ctx.db.get<{ external_id: string }>(`SELECT external_id FROM events WHERE title='Buxgalter bilan'`)?.external_id,
      'yuborilgandan keyin external_id saqlanishi kerak',
    );

    // Ikkinchi marta qayta yuborilmaydi
    const fourth = await syncGcal(ctx);
    assert.equal(fourth.pushed, 0, 'bir hodisa ikki marta yuborilmasligi kerak');

    // 4. Google'da bekor qilindi -> mahalliy ham yopiladi
    remote[0]!['status'] = 'cancelled';
    const fifth = await syncGcal(ctx);
    assert.equal(fifth.canceled, 1);
    assert.equal(ctx.db.get<{ status: string }>(`SELECT status FROM events WHERE external_id='g-1'`)?.status, 'bekor');

    // 5. Mahalliy o'chirish -> Google'dan ham
    const { removeEvent } = await import('../src/modules/calendar-sync.ts');
    assert.equal(await removeEvent(ctx, 'g-100'), true);
    assert.deepEqual(deleted, ['g-100']);
  } finally {
    server.close();
    ctx.db.close();
  }
});

test('Google Calendar: kun bo‘yi hodisa va xatolar', async () => {
  const { createServer } = await import('node:http');
  const { gcalClient } = await import('../src/gcal/client.ts');
  const { syncGcal } = await import('../src/modules/calendar-sync.ts');

  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if ((req.url ?? '').includes('/events?')) {
      res.writeHead(200);
      res.end(JSON.stringify({ items: [{ id: 'g-day', summary: 'Bayram', start: { date: '2026-09-12' }, end: { date: '2026-09-13' } }] }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: { message: 'Not Found' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const ctx = ctxFor();
  ctx.gcal = gcalClient(
    { mode: 'service', who: 'sa@test', accessToken: () => Promise.resolve('tok') },
    'primary',
    `http://127.0.0.1:${port}`,
  );

  try {
    const r = await syncGcal(ctx);
    assert.equal(r.pulled, 1, 'kun bo‘yi hodisa ham olinishi kerak');
    assert.ok(ctx.db.get(`SELECT id FROM events WHERE external_id='g-day'`));

    // 404 xatosi xizmat hisobi uchun izoh beradi
    await assert.rejects(
      () => ctx.gcal.check(),
      (e: Error) => e.message.includes('xizmat hisobiga ulashdingizmi'),
    );
  } finally {
    server.close();
    ctx.db.close();
  }
});
