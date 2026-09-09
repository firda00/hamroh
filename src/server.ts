import { createServer } from 'node:http';
import { createCtx } from './core/context.ts';
import { logger } from './core/logger.ts';
import { handleApi, json } from './web/api.ts';

/**
 * Lokal HTTP server: veb-panel (HTML) + JSON API.
 * Standart holatda faqat 127.0.0.1 da tinglaydi — tashqi tarmoqqa ochilmaydi.
 *
 * Yo'nalish tartibi: avval panel (o'z cookie himoyasi bilan), keyin API
 * (sarlavhadagi kalit bilan). Ikkalasi ham HAMROH_WEB_TOKEN ga tayanadi.
 */

const log = logger('server');
const PORT = Number(process.env['HAMROH_PORT'] ?? 7391);
const HOST = process.env['HAMROH_WEB_HOST'] ?? '127.0.0.1';

async function main(): Promise<void> {
  const ctx = await createCtx();

  const server = createServer((req, res) => {
    void (async () => {
      ctx.now = new Date();
      try {
        // Veb-panel — o'z yo'llarini o'zi hal qiladi
        const { handleWeb } = await import('./web/router.ts');
        if (await handleWeb(ctx, req, res)) return;

        await handleApi(ctx, req, res);
      } catch (e) {
        log.error((e as Error).message);
        if (!res.headersSent) json(res, 500, { error: (e as Error).message });
        else res.end();
      }
    })();
  });

  server.listen(PORT, HOST, () => {
    log.info(`Panel: http://${HOST}:${PORT}`);
    if (!ctx.cfg.webToken) {
      log.warn('HAMROH_WEB_TOKEN yo‘q — panel ham, API ham yopiq. Faqat /health javob beradi.');
    }
    if (HOST !== '127.0.0.1') log.warn(`Server tashqi tarmoqqa ochiq (${HOST}) — HTTPS va kuchli kalit shart.`);
  });

  process.on('SIGINT', () => {
    server.close();
    ctx.db.close();
    process.exitCode = 0;
  });
}

void main();
