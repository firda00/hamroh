import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Ctx } from '../core/types.ts';
import { applyEnv } from '../util/env.ts';
import { parseWhen } from '../util/date.ts';
import { parseAmount } from '../core/args.ts';
import { consentUrl, exchangeCode, CALENDAR_SCOPE, MARKETING_SCOPES } from '../google/auth.ts';
import { makeGcal } from '../gcal/index.ts';
import { loadConfig } from '../core/config.ts';
import { detectCategory } from '../util/categories.ts';
import { syncGcal, pushEvent, removeEvent } from '../modules/calendar-sync.ts';
import { loadSkills, draftPath, activePath, ensureDirs, DRAFTS_DIR } from '../skills/registry.ts';
import { runInSandbox } from '../skills/sandbox.ts';
import { readdirSync, renameSync, unlinkSync } from 'node:fs';
import { logger } from '../core/logger.ts';
import * as views from './pages.ts';
import { byRoleId } from '../roles/index.ts';
import { pendingApprovals, approve, reject } from '../roles/runner.ts';
import { evaluateAll, scoreOf } from '../roles/kpi.ts';
import { verifyChain, recent, record } from '../roles/audit.ts';
import { isActive } from '../modules/roles.ts';
import { setting } from '../core/db.ts';
import { dateKey, addDays, stamp } from '../util/date.ts';
import { safeEqual } from './guard.ts';

/**
 * Veb-panel yo'naltiruvchisi.
 *
 * Xavfsizlik: panel moliyaviy ma'lumotni ko'rsatadi, shuning uchun
 *   - kirish HAMROH_WEB_TOKEN bilan himoyalangan (cookie orqali),
 *   - o'zgartiruvchi so'rovlar CSRF tokeni bilan tekshiriladi,
 *   - server standart holatda faqat 127.0.0.1 da tinglaydi.
 */

const log = logger('web');
const COOKIE = 'hamroh_session';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const sessionValue = (token: string): string => sha(`session:${token}`);
const csrfValue = (token: string): string => sha(`csrf:${token}`);

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function formBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('so‘rov juda katta');
    chunks.push(c as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const html = (res: ServerResponse, body: string, code = 200): void => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const redirect = (res: ServerResponse, to: string): void => {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  res.end();
};

/** Xabarni manzil orqali uzatamiz — sessiya saqlash shart emas. */
const back = (res: ServerResponse, path: string, ok?: string, bad?: string): void => {
  const q = ok ? `?ok=${encodeURIComponent(ok)}` : bad ? `?xato=${encodeURIComponent(bad)}` : '';
  redirect(res, `${path}${q}`);
};

function flashFrom(url: URL): { kind: 'ok' | 'bad'; text: string } | undefined {
  const ok = url.searchParams.get('ok');
  const bad = url.searchParams.get('xato');
  if (ok) return { kind: 'ok', text: ok };
  if (bad) return { kind: 'bad', text: bad };
  return undefined;
}

/** OAuth qaytish manzili — Google Cloud da aynan shu yozilishi kerak. */
export function redirectUri(ctx: Ctx, req: IncomingMessage): string {
  if (ctx.cfg.webBase) return `${ctx.cfg.webBase.replace(/\/+$/, '')}/oauth/google/callback`;
  const host = req.headers.host ?? `127.0.0.1:${ctx.cfg.webPort}`;
  return `http://${host}/oauth/google/callback`;
}

/** Refresh tokenni .env ga yozadi va joriy jarayonda ham yoqadi. */
function saveGoogleToken(ctx: Ctx, refreshToken: string): void {
  const file = '.env';
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, applyEnv(existing, { HAMROH_GCAL: 'oauth', GOOGLE_REFRESH_TOKEN: refreshToken }), 'utf8');

  process.env['HAMROH_GCAL'] = 'oauth';
  process.env['GOOGLE_REFRESH_TOKEN'] = refreshToken;
  ctx.cfg = loadConfig();
  ctx.gcal = makeGcal(ctx.cfg, ctx.db);
}

/**
 * So'rovni qayta ishlaydi. `true` — panel javob berdi, `false` — bu panel yo'li emas.
 */
export async function handleWeb(ctx: Ctx, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!ctx.cfg.webToken) return false; // panel o'chirilgan

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  const known =
    path === '/' ||
    ['/kirish', '/chiqish', '/vazifa', '/kalendar', '/moliya', '/lid', '/sozlama', '/navlar', '/rol'].includes(path) ||
    path.startsWith('/vazifa/') ||
    path.startsWith('/kalendar/') ||
    path.startsWith('/moliya/') ||
    path.startsWith('/lid/') ||
    path.startsWith('/navlar/') ||
    path.startsWith('/rol/') ||
    path.startsWith('/oauth/google');
  if (!known) return false;

  const session = sessionValue(ctx.cfg.webToken);
  const csrf = csrfValue(ctx.cfg.webToken);
  const authed = safeEqual(cookies(req)[COOKIE] ?? '', session);

  // ---------------- kirish ----------------
  if (path === '/kirish') {
    if (method === 'POST') {
      const body = await formBody(req);
      if (safeEqual(body.get('token') ?? '', ctx.cfg.webToken)) {
        res.writeHead(302, {
          location: '/',
          'set-cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
        });
        res.end();
        return true;
      }
      log.warn(`noto‘g‘ri kalit bilan urinish: ${req.socket.remoteAddress ?? '?'}`);
      html(res, views.loginPage('Kalit noto‘g‘ri.'), 401);
      return true;
    }
    html(res, authed ? views.loginPage() : views.loginPage());
    return true;
  }

  if (!authed) {
    html(res, views.loginPage(), 401);
    return true;
  }

  if (path === '/chiqish' && method === 'POST') {
    res.writeHead(302, { location: '/kirish', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` });
    res.end();
    return true;
  }

  // ---------------- OAuth ----------------
  if (path === '/oauth/google') {
    if (!ctx.cfg.googleClientId) {
      back(res, '/sozlama', undefined, 'GOOGLE_CLIENT_ID o‘rnatilmagan');
      return true;
    }
    // ?scope=marketing — Ads/YouTube/Business Profile ham so'raladi.
    // Standart holatda faqat kalendar: keraksiz ruxsat so'ralmaydi.
    const scopes =
      url.searchParams.get('scope') === 'marketing'
        ? [CALENDAR_SCOPE, ...MARKETING_SCOPES]
        : [CALENDAR_SCOPE];
    redirect(res, consentUrl(ctx.cfg.googleClientId, redirectUri(ctx, req), scopes));
    return true;
  }

  if (path === '/oauth/google/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error || !code) {
      back(res, '/sozlama', undefined, `Google ruxsat bermadi: ${error ?? 'kod kelmadi'}`);
      return true;
    }
    try {
      const tokens = await exchangeCode(
        ctx.cfg.googleClientId,
        ctx.cfg.googleClientSecret,
        code,
        redirectUri(ctx, req),
      );
      saveGoogleToken(ctx, tokens.refreshToken);
      const name = await ctx.gcal.check();
      back(res, '/sozlama', `Google Calendar ulandi: ${name}`);
    } catch (e) {
      back(res, '/sozlama', undefined, (e as Error).message);
    }
    return true;
  }

  // ---------------- o'zgartiruvchi amallar ----------------
  if (method === 'POST') {
    const body = await formBody(req);
    if (!safeEqual(body.get('_t') ?? '', csrf)) {
      back(res, '/', undefined, 'So‘rov tasdiqlanmadi (CSRF)');
      return true;
    }

    try {
      switch (path) {
        case '/vazifa/add': {
          const title = (body.get('title') ?? '').trim();
          if (!title) return (back(res, '/vazifa', undefined, 'Sarlavha bo‘sh'), true);
          const dueRaw = (body.get('due') ?? '').trim();
          const due = dueRaw ? parseWhen(dueRaw, ctx.cfg.tz, ctx.now) : null;
          if (dueRaw && !due) return (back(res, '/vazifa', undefined, `Vaqt tushunilmadi: ${dueRaw}`), true);
          ctx.db.run(
            `INSERT INTO tasks(title, due_at, priority, category, created_at) VALUES(?,?,?,?,?)`,
            title,
            due ? due.toISOString() : null,
            Number(body.get('priority') ?? 3) || 3,
            'ish',
            ctx.now.toISOString(),
          );
          back(res, '/vazifa', 'Vazifa qo‘shildi');
          return true;
        }

        case '/vazifa/done': {
          const id = Number(body.get('id'));
          ctx.db.run(`UPDATE tasks SET status='done', completed_at=? WHERE id=?`, ctx.now.toISOString(), id);
          back(res, url.searchParams.get('from') === 'home' ? '/' : '/vazifa', 'Bajarildi');
          return true;
        }

        case '/kalendar/add': {
          const title = (body.get('title') ?? '').trim();
          const at = parseWhen((body.get('at') ?? '').trim(), ctx.cfg.tz, ctx.now);
          if (!title || !at) return (back(res, '/kalendar', undefined, 'Nom yoki vaqt noto‘g‘ri'), true);
          const dur = Number(body.get('dur') ?? 60) || 60;
          const r = ctx.db.run(
            `INSERT INTO events(title, start_at, end_at, location) VALUES(?,?,?,?)`,
            title,
            at.toISOString(),
            new Date(at.getTime() + dur * 60_000).toISOString(),
            (body.get('where') ?? '').trim() || null,
          );
          const gid = await pushEvent(ctx, r.lastInsertRowid);
          back(res, '/kalendar', gid ? 'Qo‘shildi va Google Calendar ga yuborildi' : 'Uchrashuv qo‘shildi');
          return true;
        }

        case '/kalendar/rm': {
          const id = Number(body.get('id'));
          const e = ctx.db.get<{ external_id: string | null }>(`SELECT external_id FROM events WHERE id=?`, id);
          ctx.db.run(`UPDATE events SET status='bekor' WHERE id=?`, id);
          if (e?.external_id) await removeEvent(ctx, e.external_id);
          back(res, '/kalendar', 'Bekor qilindi');
          return true;
        }

        case '/kalendar/sync': {
          const r = await syncGcal(ctx);
          back(res, '/kalendar', `Olindi ${r.pulled}, yuborildi ${r.pushed}, bekor ${r.canceled}`);
          return true;
        }

        case '/moliya/add': {
          const amount = parseAmount(body.get('amount') ?? '');
          if (!amount) return (back(res, '/moliya', undefined, 'Summa noto‘g‘ri'), true);
          const kind = body.get('kind') === 'income' ? 'income' : 'expense';
          const note = (body.get('note') ?? '').trim();
          ctx.db.run(
            `INSERT INTO ledger(ts, kind, amount, currency, category, note, source, necessity) VALUES(?,?,?,?,?,?,?,?)`,
            ctx.now.toISOString(),
            kind,
            amount,
            ctx.cfg.currency,
            kind === 'income' ? 'savdo' : detectCategory(note),
            note || null,
            'web',
            body.get('waste') ? 'kerakmas' : 'kerak',
          );
          back(res, '/moliya', 'Yozildi');
          return true;
        }

        case '/rol/yoq':
        case '/rol/ochir': {
          const id = String(body.get('id') ?? '');
          const pack = byRoleId(id);
          if (!pack) return (back(res, '/rol', undefined, 'Bunday rol yo‘q'), true);
          const on = path === '/rol/yoq';
          setting.set(ctx.db, `rol:${pack.id}:faol`, on ? '1' : '0');
          record(ctx.db, ctx.now, {
            role: pack.id,
            actor: 'odam',
            event: on ? 'rol.yoqildi' : 'rol.to‘xtatildi',
            subject: 'veb-panel',
          });
          back(res, '/rol', on ? `${pack.name} yoqildi` : `${pack.name} to‘xtatildi`);
          return true;
        }

        case '/rol/tasdiq': {
          const id = Number(body.get('id') ?? 0);
          const row = ctx.db.get<{ role: string }>('SELECT role FROM role_approvals WHERE id=?', id);
          const pack = row ? byRoleId(row.role) : undefined;
          if (!pack) return (back(res, '/rol', undefined, `#${id} topilmadi`), true);
          try {
            const out = await approve(ctx, pack, id, 'panel');
            back(
              res,
              '/rol',
              out.status === 'bajarildi' ? `#${id} bajarildi: ${out.summary}` : undefined,
              out.status === 'bajarildi' ? undefined : `#${id}: ${out.summary}`,
            );
          } catch (e) {
            back(res, '/rol', undefined, (e as Error).message);
          }
          return true;
        }

        case '/rol/rad': {
          const id = Number(body.get('id') ?? 0);
          const note = String(body.get('note') ?? '').trim() || 'sabab yozilmagan';
          const row = ctx.db.get<{ role: string }>('SELECT role FROM role_approvals WHERE id=?', id);
          const pack = row ? byRoleId(row.role) : undefined;
          if (!pack) return (back(res, '/rol', undefined, `#${id} topilmadi`), true);
          try {
            reject(ctx, pack, id, 'panel', note);
            back(res, '/rol', `#${id} rad etildi`);
          } catch (e) {
            back(res, '/rol', undefined, (e as Error).message);
          }
          return true;
        }

        case '/navlar/yoq': {
          const name = String(body.get('name') ?? '');
          const from = draftPath(name);
          if (!existsSync(from)) return (back(res, '/navlar', undefined, 'Qoralama topilmadi'), true);

          const check = await runInSandbox(from);
          if (!check.ok) return (back(res, '/navlar', undefined, `Tekshiruv o‘tmadi: ${check.error}`), true);

          ensureDirs();
          const to = activePath(name);
          if (existsSync(to)) return (back(res, '/navlar', undefined, 'Bunday nom allaqachon faol'), true);
          renameSync(from, to);
          back(res, '/navlar', `"${name}" faollashtirildi`);
          return true;
        }

        case '/navlar/ochir': {
          const name = String(body.get('name') ?? '');
          for (const file of [draftPath(name), activePath(name)]) {
            if (existsSync(file)) {
              unlinkSync(file);
              back(res, '/navlar', `"${name}" o‘chirildi`);
              return true;
            }
          }
          back(res, '/navlar', undefined, 'Topilmadi');
          return true;
        }

        case '/lid/add': {
          const name = (body.get('name') ?? '').trim();
          if (!name) return (back(res, '/lid', undefined, 'Ism bo‘sh'), true);
          ctx.db.run(
            `INSERT INTO leads(created_at, name, phone, source) VALUES(?,?,?,?)`,
            ctx.now.toISOString(),
            name,
            (body.get('phone') ?? '').trim() || null,
            body.get('source') ?? 'boshqa',
          );
          back(res, '/lid', 'Lid qo‘shildi');
          return true;
        }

        default:
          back(res, '/', undefined, 'Noma’lum amal');
          return true;
      }
    } catch (e) {
      log.error((e as Error).message);
      back(res, path.split('/').slice(0, 2).join('/') || '/', undefined, (e as Error).message);
      return true;
    }
  }

  // ---------------- sahifalar ----------------
  const flash = flashFrom(url);
  switch (path) {
    case '/':
      html(res, views.dashboard(ctx, csrf, flash));
      return true;
    case '/vazifa':
      html(res, views.tasksPage(ctx, csrf, flash));
      return true;
    case '/kalendar':
      html(res, views.calendarPage(ctx, csrf, flash));
      return true;
    case '/moliya':
      html(res, views.financePage(ctx, csrf, flash));
      return true;
    case '/lid':
      html(res, views.leadsPage(ctx, csrf, flash));
      return true;
    case '/rol': {
      const pack = byRoleId('marketing-employee');
      if (!pack) { html(res, views.dashboard(ctx, csrf, flash)); return true; }

      const to = dateKey(ctx.now, ctx.cfg.tz);
      const from = dateKey(addDays(ctx.now, -6), ctx.cfg.tz);
      const kpis = evaluateAll(ctx, pack, from, to);

      html(
        res,
        views.rolePage(
          {
            pack,
            active: isActive(ctx, pack.id),
            approvals: pendingApprovals(ctx, pack.id).map((a) => ({
              id: a.id,
              action: a.action,
              preview: a.preview,
              reason: a.reason,
              created: stamp(new Date(a.created_at), ctx.cfg.tz),
            })),
            kpis,
            score: scoreOf(kpis),
            log: recent(ctx.db, 20, pack.id).map((e) => ({
              ts: stamp(new Date(e.ts), ctx.cfg.tz),
              actor: e.actor,
              event: e.event,
              subject: e.subject,
            })),
            chain: verifyChain(ctx.db, pack.id),
            runs: ctx.db.all(
              `SELECT step, status, summary, started_at FROM role_runs r
                 WHERE role = ?
                   AND started_at = (SELECT MAX(started_at) FROM role_runs
                                      WHERE role = r.role AND step = r.step)
                 ORDER BY started_at DESC`,
              pack.id,
            ),
          },
          csrf,
          flash,
        ),
      );
      return true;
    }

    case '/navlar': {
      const reg = await loadSkills();
      const active = reg.skills.map((s) => ({
        name: s.name,
        origin: s.origin,
        description: s.metadata.function.description,
        params: Object.keys(s.metadata.function.parameters.properties).join(', '),
      }));

      const drafts = [];
      if (existsSync(DRAFTS_DIR)) {
        for (const f of readdirSync(DRAFTS_DIR).filter((x) => x.endsWith('.ts'))) {
          const name = f.replace(/\.ts$/, '');
          const file = draftPath(name);
          const check = await runInSandbox(file);
          drafts.push({
            name,
            code: readFileSync(file, 'utf8').slice(0, 4000),
            check: check.ok ? `sandbox: o‘tdi (${check.ms} ms)` : `sandbox: ${check.error ?? 'xato'}`,
            ok: check.ok,
          });
        }
      }

      html(res, views.skillsPage(active, drafts, reg.errors.map((e) => `${e.file}: ${e.reason}`), csrf, flash));
      return true;
    }

    case '/sozlama': {
      const uri = redirectUri(ctx, req);
      html(res, views.settingsPage(ctx, csrf, flash, '/oauth/google', uri));
      return true;
    }
    default:
      return false;
  }
}
