import { createServer } from 'node:http';
import { createCtx } from './core/context.ts';
import { modules, byId } from './modules/index.ts';
import { buildBrief } from './core/brief.ts';
import { logger } from './core/logger.ts';

/**
 * Kichik lokal HTTP API — kelajakdagi mobil/veb interfeys uchun.
 * Faqat 127.0.0.1 da tinglaydi (tashqi tarmoqqa ochilmaydi).
 */

const log = logger('server');
const PORT = Number(process.env['HAMROH_PORT'] ?? 7391);

const json = (res: import('node:http').ServerResponse, code: number, body: unknown): void => {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
};

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const ctx = await createCtx();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
      ctx.now = new Date();
      try {
        if (url.pathname === '/health') {
          return json(res, 200, { ok: true, tz: ctx.cfg.tz, llm: ctx.llm.id, modules: modules.length });
        }

        if (url.pathname === '/modules') {
          return json(
            res,
            200,
            modules.map((m) => ({
              id: m.id,
              title: m.title,
              about: m.about,
              commands: m.commands.map((c) => ({ name: c.name, usage: c.usage, about: c.about })),
            })),
          );
        }

        if (url.pathname === '/brief/morning' || url.pathname === '/brief/evening') {
          const kind = url.pathname.endsWith('morning') ? 'morning' : 'evening';
          const { text, sections } = await buildBrief(ctx, modules, kind);
          return json(res, 200, { kind, text, sections });
        }

        // Telegram webhook — bot.ts dagi bir xil ishlov beruvchiga boradi
        if (url.pathname === '/telegram' && req.method === 'POST') {
          const secret = process.env['TELEGRAM_WEBHOOK_SECRET'] ?? '';
          if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
            return json(res, 401, { error: 'secret token mos kelmadi' });
          }
          const update = await readBody(req);
          // Telegram tez javob kutadi — ishlov fonda ketadi
          json(res, 200, { ok: true });
          const { handleUpdate } = await import('./modules/bot.ts');
          handleUpdate(ctx, update as never).catch((e: unknown) => log.error(`webhook: ${(e as Error).message}`));
          return;
        }

        if (url.pathname === '/run' && req.method === 'POST') {
          const body = await readBody(req);
          const mod = byId(String(body['module'] ?? ''));
          const cmd = mod?.commands.find((c) => c.name === String(body['command'] ?? ''));
          if (!mod || !cmd) return json(res, 404, { error: 'modul yoki buyruq topilmadi' });
          const args = Array.isArray(body['args']) ? (body['args'] as unknown[]).map(String) : [];
          const out = await cmd.run(ctx, args);
          return json(res, 200, out);
        }

        json(res, 404, { error: 'topilmadi', paths: ['/health', '/modules', '/brief/morning', '/brief/evening', 'POST /run'] });
      } catch (e) {
        log.error((e as Error).message);
        json(res, 500, { error: (e as Error).message });
      }
    })();
  });

  server.listen(PORT, '127.0.0.1', () => log.info(`API: http://127.0.0.1:${PORT}`));
  process.on('SIGINT', () => {
    server.close();
    ctx.db.close();
    process.exit(0);
  });
}

void main();
