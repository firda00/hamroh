import { createCtx } from './core/context.ts';
import { modules } from './modules/index.ts';
import { tick } from './core/scheduler.ts';
import { flush } from './modules/notify.ts';
import { logger } from './core/logger.ts';
import { stamp } from './util/date.ts';

/**
 * Fon rejimi: har daqiqada cron vazifalarini tekshiradi va eslatmalarni yetkazadi.
 * Ishga tushirish:  npm run daemon
 */

const log = logger('daemon');
const INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  const ctx = await createCtx();
  log.info(`Hamroh daemon ishga tushdi · ${stamp(ctx.now, ctx.cfg.tz)} (${ctx.cfg.tz}) · ${modules.length} modul`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    log.info('To‘xtatilmoqda…');
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const run = async (): Promise<void> => {
    ctx.now = new Date();
    try {
      await tick(ctx, modules);
      const sent = await flush(ctx);
      if (sent.sent) log.info(`${sent.sent} ta eslatma yuborildi`);
    } catch (e) {
      log.error(`tik xatosi: ${(e as Error).message}`);
    }
  };

  await run();
  setInterval(() => void run(), INTERVAL_MS);
}

void main();
