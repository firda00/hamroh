import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { openDb } from '../src/core/db.ts';
import { loadConfig } from '../src/core/config.ts';
import type { Ctx } from '../src/core/types.ts';
import { rulesProvider } from '../src/llm/rules.ts';
import { disabledStt } from '../src/stt/provider.ts';
import { disabledTts } from '../src/tts/provider.ts';
import { disabledTel } from '../src/tel/provider.ts';
import { disabledSms } from '../src/sms/provider.ts';
import { disabledGcal } from '../src/gcal/client.ts';
import { validateMetadata, validateArgs } from '../src/skills/types.ts';
import { loadSkills } from '../src/skills/registry.ts';
import { runInSandbox, safeEnv } from '../src/skills/sandbox.ts';
import { runToolLoop } from '../src/llm/tools.ts';

function ctxFor(): Ctx {
  process.env['HAMROH_DB'] = ':memory:';
  const cfg = { ...loadConfig(), dbPath: ':memory:', offline: true };
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

const GOOD_META = {
  type: 'function' as const,
  function: {
    name: 'send_sms',
    description: 'SMS yuboradi mijozga',
    parameters: {
      type: 'object' as const,
      properties: {
        phone: { type: 'string' as const },
        count: { type: 'integer' as const },
        mode: { type: 'string' as const, enum: ['tez', 'oddiy'] },
      },
      required: ['phone'],
    },
  },
};

test('navyklar: metama’lumot tekshiriladi', () => {
  assert.equal(validateMetadata(undefined).ok, false);
  assert.ok(validateMetadata({ type: 'function' }).problems.some((p) => p.includes('function')));

  const bad = validateMetadata({
    type: 'function',
    function: { name: 'Bad Name', description: 'qisqa', parameters: { type: 'object', properties: {} } },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.length, 2, bad.problems.join(' | '));

  assert.equal(validateMetadata(GOOD_META).ok, true);
});

test('navyklar: argumentlar sxemaga solishtiriladi', () => {
  assert.deepEqual(validateArgs(GOOD_META, { phone: '+998901234567' }), []);
  assert.ok(validateArgs(GOOD_META, {}).some((p) => p.includes('majburiy')));
  assert.ok(validateArgs(GOOD_META, { phone: 998 }).some((p) => p.includes('string')));
  assert.ok(validateArgs(GOOD_META, { phone: 'x', count: 1.5 }).some((p) => p.includes('butun')));
  assert.ok(validateArgs(GOOD_META, { phone: 'x', mode: 'yolgon' }).some((p) => p.includes('faqat shulardan')));
  assert.ok(validateArgs(GOOD_META, { phone: 'x', begona: 1 }).some((p) => p.includes('sxemada yo‘q')));
});

test('navyklar: registr yuklaydi, buzuq faylni chetlab o‘tadi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hamroh-skills-'));
  writeFileSync(
    join(dir, 'yaxshi.mjs'),
    `export const SKILL = { type:'function', function:{ name:'test_qosh', description:'Ikki sonni qoshadi',
      parameters:{ type:'object', properties:{ a:{type:'number'}, b:{type:'number'} }, required:['a','b'] } } };
     export function execute(args) { return { sum: args.a + args.b }; }`,
  );
  writeFileSync(join(dir, 'buzuq.mjs'), `export const SKILL = { nonsense: true };`);
  writeFileSync(
    join(dir, 'executesiz.mjs'),
    `export const SKILL = { type:'function', function:{ name:'yoq_execute',
      description:'execute funksiyasi yoq', parameters:{ type:'object', properties:{} } } };`,
  );

  const ctx = ctxFor();
  try {
    const reg = await loadSkills(dir);
    assert.ok(reg.byName('test_qosh'), 'yaxshi navyk yuklanishi kerak');
    assert.equal(reg.errors.length, 2, reg.errors.map((e) => e.reason).join(' | '));
    assert.ok(reg.errors.some((e) => e.reason.includes('execute')));

    assert.ok(reg.byName('create_event'), 'ichki navyklar ham yuklanishi kerak');
    assert.ok(reg.toolsSchema().length >= 3);

    assert.deepEqual(await reg.execute('test_qosh', { a: 2, b: 3 }, ctx), { sum: 5 });

    const bad = await reg.execute('test_qosh', { a: 'ikki', b: 3 }, ctx);
    assert.ok(String((bad as { error: string }).error).includes('noto‘g‘ri'), JSON.stringify(bad));

    const missing = await reg.execute('yoq_bunday', {}, ctx);
    assert.ok(String((missing as { error: string }).error).includes('yo‘q'));
  } finally {
    ctx.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('navyklar: sandbox fayl, jarayon va sirlarni bloklaydi', async () => {
  const cleaned = safeEnv({ PATH: '/bin', TELEGRAM_BOT_TOKEN: 'maxfiy', ESKIZ_PASSWORD: 'p', HOME: '/h' });
  assert.equal(cleaned['PATH'], '/bin');
  assert.equal(cleaned['TELEGRAM_BOT_TOKEN'], undefined, 'token sandboxga o‘tmasligi kerak');
  assert.equal(cleaned['ESKIZ_PASSWORD'], undefined);

  const dir = mkdtempSync(join(tmpdir(), 'hamroh-sandbox-'));
  const file = join(dir, 'sinov.mjs');
  writeFileSync(
    file,
    `export const SKILL = { type:'function', function:{ name:'chegara_sinovi',
       description:'Sandbox chegaralarini tekshiradi', parameters:{ type:'object', properties:{} } } };
     export async function execute() {
       const out = {};
       try { const fs = await import('node:fs'); fs.readFileSync('package.json'); out.fs = 'RUXSAT'; }
       catch (e) { out.fs = e.code; }
       try { const cp = await import('node:child_process'); cp.execSync('echo x'); out.proc = 'RUXSAT'; }
       catch (e) { out.proc = e.code; }
       out.secrets = Object.keys(process.env).filter((k) => /TOKEN|PASSWORD/i.test(k)).length;
       return out;
     }`,
  );

  try {
    const r = await runInSandbox(file, {});
    assert.equal(r.ok, true, r.error);
    const v = r.value as { fs: string; proc: string; secrets: number };
    assert.equal(v.fs, 'ERR_ACCESS_DENIED', 'fayl o‘qish bloklanishi kerak');
    assert.equal(v.proc, 'ERR_ACCESS_DENIED', 'dochyor jarayon bloklanishi kerak');
    assert.equal(v.secrets, 0, 'sirlar sandboxga o‘tmasligi kerak');

    const meta = await runInSandbox(file);
    assert.equal(meta.ok, true);
    assert.equal(meta.value, undefined, 'argumentsiz execute chaqirilmasligi kerak');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('navyklar: sandbox cheksiz halqani to‘xtatadi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hamroh-loop-'));
  const file = join(dir, 'halqa.mjs');
  writeFileSync(
    file,
    `export const SKILL = { type:'function', function:{ name:'cheksiz_halqa',
       description:'Hech qachon tugamaydigan navyk', parameters:{ type:'object', properties:{} } } };
     export async function execute() { while (true) {} }`,
  );
  try {
    const r = await runInSandbox(file, {}, 1500);
    assert.equal(r.ok, false);
    assert.ok(r.error?.includes('to‘xtatildi'), r.error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('navyklar: tool calling halqasi natijani modelga qaytaradi', async () => {
  const seenRoles: string[][] = [];
  let round = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages: { role: string }[];
        tools?: unknown[];
      };
      seenRoles.push(body.messages.map((m) => m.role));
      res.writeHead(200, { 'content-type': 'application/json' });

      if (round++ === 0) {
        assert.ok((body.tools ?? []).length > 0, 'tools uzatilishi kerak');
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: '',
                  tool_calls: [{ id: 'c1', function: { name: 'test_qosh', arguments: '{"a":2,"b":3}' } }],
                },
              },
            ],
          }),
        );
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: 'Jami besh bo‘ldi.' } }] }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  try {
    const out = await runToolLoop({
      url: `http://127.0.0.1:${port}/v1`,
      model: 'sinov',
      system: 'Sen yordamchisan',
      prompt: 'ikki qo‘shuv uch',
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_qosh',
            description: 'Ikki sonni qoshadi',
            parameters: {
              type: 'object',
              properties: { a: { type: 'number' }, b: { type: 'number' } },
              required: ['a', 'b'],
            },
          },
        },
      ],
      onCall: (name, args) => Promise.resolve({ sum: Number(args['a']) + Number(args['b']), tool: name }),
    });

    assert.equal(out.text, 'Jami besh bo‘ldi.');
    assert.equal(out.calls.length, 1);
    assert.deepEqual(out.calls[0]?.result, { sum: 5, tool: 'test_qosh' });
    assert.deepEqual(seenRoles[1], ['system', 'user', 'assistant', 'tool'], 'tool javobi tarixga qo‘shilishi kerak');
  } finally {
    server.close();
  }
});

test('navyklar: buzuq argumentlarda ham halqa yiqilmaydi', async () => {
  let round = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (round++ === 0) {
        // Model buzuq JSON yozdi
        res.end(
          JSON.stringify({
            choices: [
              { message: { tool_calls: [{ id: 'c1', function: { name: 'test_qosh', arguments: '{buzuq' } }] } },
            ],
          }),
        );
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: 'Tushundim.' } }] }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;

  try {
    const out = await runToolLoop({
      url: `http://127.0.0.1:${port}/v1`,
      model: 'sinov',
      system: 's',
      prompt: 'p',
      tools: [],
      onCall: (_name, args) => Promise.resolve({ received: args }),
    });
    assert.equal(out.text, 'Tushundim.');
    assert.deepEqual(out.calls[0]?.args, {}, 'buzuq JSON bo‘sh obyektga aylanishi kerak');
  } finally {
    server.close();
  }
});
