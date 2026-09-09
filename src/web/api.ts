import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Ctx } from '../core/types.ts';
import { modules, byId } from '../modules/index.ts';
import { buildBrief } from '../core/brief.ts';
import { needsConfirmation } from '../intent/types.ts';
import { logger } from '../core/logger.ts';
import { checkApi, denyApi } from './guard.ts';

/**
 * JSON API.
 *
 * Yo'llar ikkiga bo'linadi:
 *
 *   ochiq   /health      faqat "tirikman" — kuzatuv tizimlari uchun
 *           /audio/*     qo'ng'iroq audiosi: Twilio uni internetdan oladi, kalit bera olmaydi
 *           /telegram    o'zining webhook siri bilan himoyalangan
 *
 *   yopiq   /modules, /brief/*, POST /run — HAMROH_WEB_TOKEN sarlavhada shart
 *
 * Nega yopiq: `POST /run` istalgan modul buyrug'ini bajaradi — SMS yuboradi,
 * qo'ng'iroq qiladi, vazifa o'chiradi. Bu panel sahifalaridan kuchliroq imkoniyat,
 * shuning uchun kalitsiz ochiq qolmaydi.
 */

const log = logger('api');

export const json = (res: ServerResponse, code: number, body: unknown): void => {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new Error('so‘rov juda katta');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const AUDIO_NAME = /^[A-Za-z0-9_.-]+$/;

/** `true` — javob berildi. */
export async function handleApi(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // ---------------- ochiq yo'llar ----------------

  // Kuzatuv uchun: kalitsiz faqat "tirikman". Versiya, TZ, modellar —
  // kalit bilan, chunki bular tizim haqida ma'lumot beradi.
  if (path === '/health') {
    if (checkApi(req, ctx.cfg.webToken) === 'ok') {
      json(res, 200, { ok: true, tz: ctx.cfg.tz, llm: ctx.llm.id, modules: modules.length });
    } else {
      json(res, 200, { ok: true });
    }
    return true;
  }

  // Qo'ng'iroq audiosi: Twilio faylni internetdan oladi va sarlavha qo'sha olmaydi.
  // Himoya — nomning o'zi: u UUID, taxmin qilib bo'lmaydi. Faqat out/public ichi.
  if (path.startsWith('/audio/')) {
    const name = path.slice('/audio/'.length);
    if (!AUDIO_NAME.test(name) || name.includes('..')) {
      json(res, 400, { error: 'noto‘g‘ri nom' });
      return true;
    }
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      const bytes = await readFile(join(ctx.cfg.outDir, 'public', name));
      const ext = name.split('.').pop() ?? '';
      const mime: Record<string, string> = { ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav' };
      res.writeHead(200, {
        'content-type': mime[ext] ?? 'application/octet-stream',
        'content-length': bytes.length,
      });
      res.end(bytes);
    } catch {
      json(res, 404, { error: 'topilmadi' });
    }
    return true;
  }

  // Telegram webhook. Sir MAJBURIY: usiz istalgan odam o'zini siz deb ko'rsatib
  // xabar yuborishi mumkin bo'lardi — bot esa buyruqlarni bajaradi.
  if (path === '/telegram' && req.method === 'POST') {
    const secret = process.env['TELEGRAM_WEBHOOK_SECRET'] ?? '';
    if (!secret) {
      log.warn('/telegram so‘rovi rad etildi — TELEGRAM_WEBHOOK_SECRET qo‘yilmagan');
      json(res, 503, {
        error: 'webhook yopiq',
        sabab: 'TELEGRAM_WEBHOOK_SECRET qo‘yilmagan',
        yechim: '.env ga TELEGRAM_WEBHOOK_SECRET yozing va setWebhook da xuddi shu qiymatni bering',
      });
      return true;
    }
    if (req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      log.warn(`/telegram: sir mos kelmadi (${req.socket.remoteAddress ?? '?'})`);
      json(res, 401, { error: 'secret token mos kelmadi' });
      return true;
    }
    const update = await readBody(req);
    json(res, 200, { ok: true }); // Telegram tez javob kutadi — ishlov fonda
    const { handleUpdate } = await import('../modules/bot.ts');
    handleUpdate(ctx, update as never).catch((e: unknown) => log.error(`webhook: ${(e as Error).message}`));
    return true;
  }

  // ---------------- kalit talab qiladigan yo'llar ----------------

  const closed = path === '/modules' || path === '/brief/morning' || path === '/brief/evening' || path === '/run';
  if (closed) {
    const verdict = checkApi(req, ctx.cfg.webToken);
    if (verdict !== 'ok') {
      if (verdict === 'notogri') log.warn(`${path}: noto‘g‘ri kalit (${req.socket.remoteAddress ?? '?'})`);
      denyApi(res, verdict);
      return true;
    }
  }

  if (path === '/modules') {
    json(
      res,
      200,
      modules.map((m) => ({
        id: m.id,
        title: m.title,
        about: m.about,
        commands: m.commands.map((c) => ({ name: c.name, usage: c.usage, about: c.about })),
      })),
    );
    return true;
  }

  if (path === '/brief/morning' || path === '/brief/evening') {
    const kind = path.endsWith('morning') ? 'morning' : 'evening';
    const { text, sections } = await buildBrief(ctx, modules, kind);
    json(res, 200, { kind, text, sections });
    return true;
  }

  if (path === '/run') {
    if (req.method !== 'POST') {
      json(res, 405, { error: 'faqat POST' });
      return true;
    }
    const body = await readBody(req);
    const modId = String(body['module'] ?? '');
    const cmdName = String(body['command'] ?? '');
    const mod = byId(modId);
    const cmd = mod?.commands.find((c) => c.name === cmdName);
    if (!mod || !cmd) {
      json(res, 404, { error: 'modul yoki buyruq topilmadi', modul: modId, buyruq: cmdName });
      return true;
    }

    // Tashqi dunyoga chiqadigan buyruqlar (SMS, qo'ng'iroq, o'chirish) uchun
    // so'rovda ochiq-oydin `"confirm": true` bo'lishi kerak. Kalitni bilgan
    // skript ham adashib SMS tarqatib yubormasin.
    if (needsConfirmation(mod.id, cmd.name) && body['confirm'] !== true) {
      json(res, 428, {
        error: 'tasdiq kerak',
        buyruq: `${mod.id}:${cmd.name}`,
        sabab: 'bu buyruq tashqariga chiqadi yoki qaytarib bo‘lmaydi',
        yechim: 'so‘rov tanasiga "confirm": true qo‘shing',
      });
      return true;
    }

    const args = Array.isArray(body['args']) ? (body['args'] as unknown[]).map(String) : [];
    const out = await cmd.run(ctx, args);
    log.info(`run ${mod.id}:${cmd.name}`);
    json(res, 200, out);
    return true;
  }

  json(res, 404, {
    error: 'topilmadi',
    paths: ['/health', '/modules', '/brief/morning', '/brief/evening', 'POST /run'],
    eslatma: 'ochiq bo‘lmagan yo‘llar uchun: Authorization: Bearer <HAMROH_WEB_TOKEN>',
  });
  return true;
}
