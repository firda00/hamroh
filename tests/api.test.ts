import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { openDb } from '../src/core/db.ts';
import { loadConfig } from '../src/core/config.ts';
import type { Ctx } from '../src/core/types.ts';
import { rulesProvider } from '../src/llm/rules.ts';
import { disabledStt } from '../src/stt/provider.ts';
import { disabledTts } from '../src/tts/provider.ts';
import { disabledTel } from '../src/tel/provider.ts';
import { disabledSms } from '../src/sms/provider.ts';
import { disabledGcal } from '../src/gcal/client.ts';
import { handleApi } from '../src/web/api.ts';
import { resetGuard, headerToken, safeEqual } from '../src/web/guard.ts';

const TOKEN = 'sinov-kaliti-uzun-va-tasodifiy-1234567890';

function ctxFor(token: string): Ctx {
  process.env['HAMROH_DB'] = ':memory:';
  const cfg = { ...loadConfig(), dbPath: ':memory:', offline: true, webToken: token };
  return {
    cfg,
    db: openDb(':memory:'),
    llm: rulesProvider(),
    stt: disabledStt(),
    tts: disabledTts(),
    tel: disabledTel(),
    sms: disabledSms(),
    gcal: disabledGcal(),
    now: new Date('2026-09-09T06:00:00.000Z'),
  };
}

type Reply = { code: number; body: Record<string, unknown> | unknown[]; raw: string };

/** API ni haqiqiy HTTP orqali sinaydi — sarlavhalar ham tekshirilsin. */
async function withApi(
  token: string,
  fn: (call: (path: string, init?: RequestInit) => Promise<Reply>) => Promise<void>,
): Promise<void> {
  resetGuard();
  const ctx = ctxFor(token);
  const server: Server = createServer((req, res) => {
    void handleApi(ctx, req, res).catch(() => {
      res.writeHead(500);
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  const call = async (path: string, init: RequestInit = {}): Promise<Reply> => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const raw = await r.text();
    let body: Record<string, unknown> | unknown[] = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown> | unknown[];
    } catch {
      /* audio kabi javoblar JSON emas */
    }
    return { code: r.status, body, raw };
  };

  try {
    await fn(call);
  } finally {
    server.close();
    ctx.db.close();
  }
}

const bearer = (t: string): RequestInit => ({ headers: { authorization: `Bearer ${t}` } });

const post = (payload: unknown, t?: string): RequestInit => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(t ? { authorization: `Bearer ${t}` } : {}),
  },
  body: JSON.stringify(payload),
});

test('api: kalitsiz /run va /modules yopiq', async () => {
  await withApi(TOKEN, async (call) => {
    const run = await call('/run', post({ module: 'vazifa', command: 'list' }));
    assert.equal(run.code, 401, run.raw);
    assert.match(String((run.body as Record<string, string>)['qanday']), /Bearer/);

    const mods = await call('/modules');
    assert.equal(mods.code, 401);

    const brief = await call('/brief/morning');
    assert.equal(brief.code, 401);
  });
});

test('api: to‘g‘ri kalit bilan ishlaydi', async () => {
  await withApi(TOKEN, async (call) => {
    const mods = await call('/modules', bearer(TOKEN));
    assert.equal(mods.code, 200);
    assert.ok(Array.isArray(mods.body) && mods.body.length > 10, 'modullar ro‘yxati kelishi kerak');

    const run = await call('/run', post({ module: 'vazifa', command: 'list' }, TOKEN));
    assert.equal(run.code, 200, run.raw);
    assert.ok('text' in (run.body as Record<string, unknown>), run.raw);
  });
});

test('api: cookie qabul qilinmaydi (CSRF)', async () => {
  await withApi(TOKEN, async (call) => {
    const r = await call('/modules', {
      headers: { cookie: `hamroh_session=${TOKEN}; token=${TOKEN}` },
    });
    assert.equal(r.code, 401, 'API faqat sarlavhadagi kalitni tan olishi kerak');
  });
});

test('api: xavfli buyruq ochiq tasdiqsiz bajarilmaydi', async () => {
  await withApi(TOKEN, async (call) => {
    const no = await call('/run', post({ module: 'vazifa', command: 'rm', args: ['1'] }, TOKEN));
    assert.equal(no.code, 428, no.raw);
    assert.equal((no.body as Record<string, string>)['buyruq'], 'vazifa:rm');

    const yes = await call('/run', post({ module: 'vazifa', command: 'rm', args: ['1'], confirm: true }, TOKEN));
    assert.equal(yes.code, 200, yes.raw);
  });
});

test('api: kalit topishga urinish cheklanadi', async () => {
  await withApi(TOKEN, async (call) => {
    for (let i = 0; i < 10; i++) {
      const r = await call('/modules', bearer('yolgon'));
      assert.equal(r.code, 401, `${i}-urinish`);
    }
    const blocked = await call('/modules', bearer('yolgon'));
    assert.equal(blocked.code, 429, blocked.raw);

    // Bloklangan manzilga to‘g‘ri kalit ham darrov yordam bermaydi
    const even = await call('/modules', bearer(TOKEN));
    assert.equal(even.code, 429);
  });
});

test('api: kalit qo‘yilmagan bo‘lsa API butunlay yopiq', async () => {
  await withApi('', async (call) => {
    const r = await call('/modules', bearer('nima-bolsa-ham'));
    assert.equal(r.code, 503, r.raw);
    assert.match(String((r.body as Record<string, string>)['yechim']), /HAMROH_WEB_TOKEN/);
  });
});

test('api: /health ochiq, lekin kalitsiz tafsilot bermaydi', async () => {
  await withApi(TOKEN, async (call) => {
    const open = await call('/health');
    assert.equal(open.code, 200);
    assert.deepEqual(open.body, { ok: true }, 'kalitsiz faqat "tirikman"');

    const full = await call('/health', bearer(TOKEN));
    assert.equal(full.code, 200);
    assert.ok('tz' in (full.body as Record<string, unknown>), 'kalit bilan tafsilot');
  });
});

test('api: telegram webhook sirsiz ishlamaydi', async () => {
  const saved = process.env['TELEGRAM_WEBHOOK_SECRET'];
  delete process.env['TELEGRAM_WEBHOOK_SECRET'];
  try {
    await withApi(TOKEN, async (call) => {
      const r = await call('/telegram', post({ message: { text: 'salom' } }));
      assert.equal(r.code, 503, r.raw);
      assert.match(String((r.body as Record<string, string>)['yechim']), /TELEGRAM_WEBHOOK_SECRET/);
    });

    process.env['TELEGRAM_WEBHOOK_SECRET'] = 'sir';
    await withApi(TOKEN, async (call) => {
      const wrong = await call('/telegram', post({ message: { text: 'salom' } }));
      assert.equal(wrong.code, 401, wrong.raw);
    });
  } finally {
    if (saved === undefined) delete process.env['TELEGRAM_WEBHOOK_SECRET'];
    else process.env['TELEGRAM_WEBHOOK_SECRET'] = saved;
  }
});

test('api: audio nomi tekshiriladi', async () => {
  await withApi(TOKEN, async (call) => {
    const bad = await call('/audio/..%2F..%2Fpackage.json');
    assert.ok(bad.code === 400 || bad.code === 404, `kutilmagan: ${bad.code}`);
    const missing = await call('/audio/yoq-bunday.ogg');
    assert.equal(missing.code, 404);
  });
});

test('api: sarlavhadan kalit to‘g‘ri olinadi', () => {
  const fake = (h: Record<string, string>): Parameters<typeof headerToken>[0] =>
    ({ headers: h }) as unknown as Parameters<typeof headerToken>[0];

  assert.equal(headerToken(fake({ authorization: 'Bearer abc' })), 'abc');
  assert.equal(headerToken(fake({ authorization: 'bearer   abc  ' })), 'abc');
  assert.equal(headerToken(fake({ 'x-hamroh-token': 'abc' })), 'abc');
  assert.equal(headerToken(fake({ authorization: 'Basic abc' })), '');
  assert.equal(headerToken(fake({})), '');

  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false, 'uzunlik farqi yiqilmasligi kerak');
});
