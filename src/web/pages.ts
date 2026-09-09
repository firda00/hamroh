import type { Ctx } from '../core/types.ts';
import { page, card, kpi, table, bars, esc } from './layout.ts';
import { dateKey, stamp, timeKey, startOfDay, endOfDay, monthKey, humanUntil, weekdayUz } from '../util/date.ts';
import { money, growth, compact, truncate } from '../util/fmt.ts';
import { openTasks, overdue } from '../modules/tasks.ts';
import { eventsBetween } from '../modules/calendar.ts';
import { totals, byCategory, savingTips } from '../modules/finance.ts';
import { dayKpis, weakSpots } from '../modules/report.ts';
import { unpaid } from '../modules/recurring.ts';
import { leadsSince } from '../modules/leads.ts';
import { pendingSms } from '../modules/comms.ts';

/** Sahifalar. Har biri tayyor HTML qaytaradi — shablon dvigateli yo'q. */

type Flash = { kind: 'ok' | 'bad'; text: string } | undefined;

const csrfField = (token: string): string => `<input type="hidden" name="_t" value="${esc(token)}"/>`;

// ------------------------------------------------------------------ bosh sahifa

export function dashboard(ctx: Ctx, csrf: string, flash: Flash): string {
  const today = dateKey(ctx.now, ctx.cfg.tz);
  const kpis = dayKpis(ctx, ctx.now);
  const weak = weakSpots(ctx, kpis);

  // Chiqimning o'sishi yaxshi xabar emas — rang shuni hisobga oladi
  const higherIsBetter = (key: string): boolean => key !== 'expense';

  const cards = kpis
    .slice(0, 4)
    .map((k) => {
      const g = growth(k.prev, k.today);
      const good = higherIsBetter(k.key) ? g.up : !g.up;
      return kpi(k.label, k.unit === 'pul' ? compact(k.today) : `${k.today}`, g.text, good);
    })
    .join('');

  const late = overdue(ctx);
  const todayTasks = openTasks(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
  const lateIds = new Set(late.map((t) => t.id));

  const taskRows = [
    ...late.map((t) => [
      `<span class="pill bad">kechikdi</span>`,
      esc(t.title),
      esc(humanUntil(new Date(t.due_at ?? ''), ctx.now)),
      doneButton(t.id, csrf),
    ]),
    ...todayTasks
      .filter((t) => !lateIds.has(t.id))
      .map((t) => [
        esc(timeKey(new Date(t.due_at ?? ''), ctx.cfg.tz)),
        esc(t.title),
        esc(t.category),
        doneButton(t.id, csrf),
      ]),
  ];

  const events = eventsBetween(ctx, startOfDay(ctx.now, ctx.cfg.tz), endOfDay(ctx.now, ctx.cfg.tz));
  const payments = unpaid(ctx);

  const body = [
    `<div class="kpis">${cards}</div>`,
    card(
      `Bugungi ishlar (${taskRows.length})`,
      table(['Vaqt', 'Vazifa', '', ''], taskRows, 'Bugunga muddatli ish yo‘q.'),
    ),
    card(
      `Uchrashuvlar (${events.length})`,
      table(
        ['Vaqt', 'Uchrashuv', 'Joy'],
        events.map((e) => [
          esc(timeKey(new Date(e.start_at), ctx.cfg.tz)),
          esc(e.title),
          esc(e.location ?? '—'),
        ]),
        'Bugun uchrashuv yo‘q.',
      ),
    ),
    payments.length
      ? card(
          'To‘lanmagan majburiyatlar',
          table(
            ['To‘lov', 'Kun', 'Summa'],
            payments.map((p) => [esc(p.title), `${p.day_of_month}`, esc(money(p.amount, p.currency))]),
          ),
        )
      : '',
    card('E’tibor talab qiladi', `<ul class="plain">${weak.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`),
  ].join('');

  return page(
    { title: 'Bosh sahifa', subtitle: `${today}, ${weekdayUz(ctx.now, ctx.cfg.tz)}`, path: '/', flash },
    body,
  );
}

const doneButton = (id: number, csrf: string): string =>
  `<form method="post" action="/vazifa/done" style="margin:0">${csrfField(csrf)}<input type="hidden" name="id" value="${id}"/><button class="ghost">bajarildi</button></form>`;

// ------------------------------------------------------------------ vazifalar

export function tasksPage(ctx: Ctx, csrf: string, flash: Flash): string {
  const items = openTasks(ctx);
  const rows = items.map((t) => [
    `<span class="pill">${t.priority}</span>`,
    esc(t.title),
    t.due_at ? esc(stamp(new Date(t.due_at), ctx.cfg.tz)) : '<span class="muted">—</span>',
    esc(t.category),
    doneButton(t.id, csrf),
  ]);

  const form = `
    <form method="post" action="/vazifa/add" class="row">
      ${csrfField(csrf)}
      <input type="text" name="title" placeholder="Nima qilish kerak?" required/>
      <input type="text" name="due" placeholder="ertaga 10:00" style="flex:0 1 150px"/>
      <select name="priority">
        <option value="1">1 — shoshilinch</option>
        <option value="2">2</option>
        <option value="3" selected>3 — oddiy</option>
        <option value="4">4</option>
        <option value="5">5 — past</option>
      </select>
      <button>Qo‘shish</button>
    </form>
    <div class="note" style="margin-top:10px">Vaqtni odam tilida yozing: «ertaga 10:00», «juma 15:30», «+2h»</div>`;

  return page(
    { title: 'Vazifalar', subtitle: `${items.length} ta ochiq`, path: '/vazifa', flash },
    card('Yangi vazifa', form) + card('Ochiq vazifalar', table(['Muhim', 'Vazifa', 'Muddat', 'Toifa', ''], rows, 'Ochiq vazifa yo‘q.')),
  );
}

// ------------------------------------------------------------------ kalendar

export function calendarPage(ctx: Ctx, csrf: string, flash: Flash): string {
  const from = startOfDay(ctx.now, ctx.cfg.tz);
  const to = endOfDay(new Date(ctx.now.getTime() + 14 * 86_400_000), ctx.cfg.tz);
  const items = eventsBetween(ctx, from, to);

  const rows = items.map((e) => [
    esc(stamp(new Date(e.start_at), ctx.cfg.tz)),
    esc(e.title),
    esc(e.location ?? '—'),
    e.external_id ? '<span class="pill ok">Google</span>' : '<span class="pill">mahalliy</span>',
    `<form method="post" action="/kalendar/rm" style="margin:0">${csrfField(csrf)}<input type="hidden" name="id" value="${e.id}"/><button class="ghost">bekor</button></form>`,
  ]);

  const form = `
    <form method="post" action="/kalendar/add" class="row">
      ${csrfField(csrf)}
      <input type="text" name="title" placeholder="Kim bilan / nima haqida" required/>
      <input type="text" name="at" placeholder="ertaga 15:00" required style="flex:0 1 160px"/>
      <input type="number" name="dur" value="60" min="15" step="15" style="flex:0 1 90px" title="daqiqa"/>
      <input type="text" name="where" placeholder="Joy" style="flex:0 1 130px"/>
      <button>Belgilash</button>
    </form>`;

  const sync = ctx.gcal.enabled
    ? `<form method="post" action="/kalendar/sync" class="row">${csrfField(csrf)}<button class="ghost">Google bilan sinxronlash</button></form>`
    : `<div class="note">Google Calendar ulanmagan — <a href="/sozlama">Sozlamalar</a> bo‘limidan ulang.</div>`;

  return page(
    { title: 'Kalendar', subtitle: 'Keyingi 14 kun', path: '/kalendar', flash },
    card('Yangi uchrashuv', form) +
      card('Jadval', table(['Vaqt', 'Uchrashuv', 'Joy', 'Manba', ''], rows, 'Uchrashuv yo‘q.') + `<div style="margin-top:12px">${sync}</div>`),
  );
}

// ------------------------------------------------------------------ moliya

export function financePage(ctx: Ctx, csrf: string, flash: Flash): string {
  const period = monthKey(ctx.now, ctx.cfg.tz);
  const from = `${period}-01T00:00:00.000Z`;
  const to = `${period}-31T23:59:59.999Z`;
  const t = totals(ctx, from, to);
  const cats = byCategory(ctx, from, to);

  const recent = ctx.db.all<{ id: number; ts: string; kind: string; amount: number; category: string; note: string | null }>(
    `SELECT id, ts, kind, amount, category, note FROM ledger ORDER BY id DESC LIMIT 15`,
  );

  const form = `
    <form method="post" action="/moliya/add" class="row">
      ${csrfField(csrf)}
      <select name="kind">
        <option value="expense">Chiqim</option>
        <option value="income">Kirim</option>
      </select>
      <input type="text" name="amount" placeholder="250000 yoki 2mln" required style="flex:0 1 150px"/>
      <input type="text" name="note" placeholder="Nima uchun (toifa o‘zi aniqlanadi)"/>
      <label class="muted" style="font-size:13px"><input type="checkbox" name="waste" value="1" style="min-width:auto"/> keraksiz</label>
      <button>Yozish</button>
    </form>`;

  return page(
    { title: 'Moliya', subtitle: `${period} · sof natija ${money(t.net, ctx.cfg.currency)}`, path: '/moliya', flash },
    `<div class="kpis">
      ${kpi('Kirim', money(t.income, ctx.cfg.currency))}
      ${kpi('Chiqim', money(t.expense, ctx.cfg.currency))}
      ${kpi('Sof natija', money(t.net, ctx.cfg.currency))}
      ${kpi('Keraksiz', money(t.waste, ctx.cfg.currency))}
    </div>` +
      card('Yangi yozuv', form) +
      card(
        'Chiqim toifalari',
        cats.length
          ? bars(cats.map((c) => ({ label: c.category, value: c.total, text: money(c.total, ctx.cfg.currency) })))
          : '<div class="empty">Bu oy chiqim yo‘q.</div>',
      ) +
      card(
        'Oxirgi yozuvlar',
        table(
          ['Sana', 'Tur', 'Summa', 'Toifa', 'Izoh'],
          recent.map((e) => [
            esc(stamp(new Date(e.ts), ctx.cfg.tz).slice(5, 16)),
            e.kind === 'income' ? '<span class="up">+</span>' : '<span class="down">−</span>',
            esc(compact(e.amount)),
            esc(e.category),
            esc(truncate(e.note ?? '', 40)),
          ]),
        ),
      ) +
      card('Maslahatlar', `<ul class="plain">${savingTips(ctx, period).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`),
  );
}

// ------------------------------------------------------------------ lidlar

export function leadsPage(ctx: Ctx, csrf: string, flash: Flash): string {
  const items = ctx.db.all<{ id: number; created_at: string; name: string; phone: string | null; source: string; status: string; amount: number | null }>(
    `SELECT * FROM leads ORDER BY id DESC LIMIT 40`,
  );
  const todayCount = leadsSince(ctx, startOfDay(ctx.now, ctx.cfg.tz).toISOString()).length;

  const rows = items.map((l) => [
    esc(stamp(new Date(l.created_at), ctx.cfg.tz).slice(5, 16)),
    esc(l.name),
    esc(l.phone ?? '—'),
    esc(l.source),
    `<span class="pill ${l.status === 'sotildi' ? 'ok' : l.status === 'rad' ? 'bad' : ''}">${esc(l.status)}</span>`,
    l.amount ? esc(money(l.amount, ctx.cfg.currency)) : '<span class="muted">—</span>',
  ]);

  const form = `
    <form method="post" action="/lid/add" class="row">
      ${csrfField(csrf)}
      <input type="text" name="name" placeholder="Ism" required/>
      <input type="text" name="phone" placeholder="+998..." style="flex:0 1 160px"/>
      <select name="source">
        <option>instagram</option><option>google</option><option>2gis</option>
        <option>telegram</option><option>tavsiya</option><option>boshqa</option>
      </select>
      <button>Qo‘shish</button>
    </form>`;

  return page(
    { title: 'Lidlar', subtitle: `Bugun ${todayCount} ta`, path: '/lid', flash },
    card('Yangi lid', form) + card('Oxirgi lidlar', table(['Sana', 'Ism', 'Telefon', 'Manba', 'Holat', 'Summa'], rows, 'Lid yo‘q.')),
  );
}

// ------------------------------------------------------------------ sozlamalar

export function settingsPage(ctx: Ctx, csrf: string, flash: Flash, oauthUrl: string, redirectUri: string): string {
  const state = (ok: boolean, on: string, off: string): string =>
    ok ? `<span class="pill ok">${esc(on)}</span>` : `<span class="pill">${esc(off)}</span>`;

  const rows = [
    ['LLM', state(ctx.llm.smart, ctx.llm.id, 'qoidaviy rejim'), 'docs/LLM.md'],
    ['Ovoz → matn', state(ctx.stt.enabled, ctx.stt.id, 'o‘chirilgan'), 'docs/VOICE.md'],
    ['Gapirish', state(ctx.tts.enabled, ctx.tts.id, 'o‘chirilgan'), 'docs/VOICE.md'],
    ['Telegram', state(Boolean(ctx.cfg.telegram.token), 'ulangan', 'ulanmagan'), 'docs/TELEGRAM.md'],
    ['SMS', state(ctx.sms.enabled, ctx.sms.id, 'ulanmagan'), 'docs/SMS.md'],
    ['Qo‘ng‘iroq', state(ctx.tel.enabled, ctx.tel.id, 'o‘chirilgan'), 'docs/CALLS.md'],
    ['Google Calendar', state(ctx.gcal.enabled, ctx.gcal.id, 'ulanmagan'), 'docs/GCALENDAR.md'],
  ].map(([name, badge, doc]) => [esc(name as string), badge as string, `<span class="muted">${esc(doc as string)}</span>`]);

  const pendingOut = pendingSms(ctx, 5).length;

  const google = ctx.gcal.enabled
    ? `<div class="note">Google Calendar ulangan: <b>${esc(ctx.gcal.id)}</b>. Sinxronlash har 20 daqiqada avtomatik.</div>`
    : ctx.cfg.googleClientId && ctx.cfg.googleClientSecret
      ? `<p><a href="${esc(oauthUrl)}"><button>Google Calendar'ni ulash</button></a></p>
         <div class="note">Google sizni shu manzilga qaytaradi:<br/><code>${esc(redirectUri)}</code><br/>
         Shu manzil Google Cloud → Credentials → «Authorized redirect URIs» ro‘yxatida bo‘lishi kerak.</div>`
      : `<div class="note">Avval Google Cloud da OAuth mijozi yarating (turi: <b>Web application</b>) va
         <code>.env</code> ga <code>GOOGLE_CLIENT_ID</code> hamda <code>GOOGLE_CLIENT_SECRET</code> ni qo‘ying.<br/><br/>
         «Authorized redirect URIs» ga shuni kiriting:<br/><code>${esc(redirectUri)}</code><br/><br/>
         Qadamma-qadam: <b>docs/GCALENDAR.md</b></div>`;

  return page(
    { title: 'Sozlamalar', subtitle: `Baza: ${ctx.cfg.dbPath}`, path: '/sozlama', flash },
    card('Ulanishlar', table(['Imkoniyat', 'Holat', 'Hujjat'], rows)) +
      card('Google Calendar', google) +
      card(
        'Navbatlar',
        `<ul class="plain">
          <li>Yuborilmagan SMS: ${pendingOut} ta</li>
          <li>Vaqt zonasi: ${esc(ctx.cfg.tz)} · Valyuta: ${esc(ctx.cfg.currency)}</li>
        </ul>`,
      ) +
      card(
        'Xavfsizlik',
        `<div class="note">Panel moliyaviy ma’lumotni ko‘rsatadi. Uni internetga ochsangiz —
        albatta HTTPS va kuchli <code>HAMROH_WEB_TOKEN</code> bilan. Standart holatda panel
        faqat <code>127.0.0.1</code> da tinglaydi.</div>
        <form method="post" action="/chiqish" style="margin-top:12px">${csrfField(csrf)}<button class="ghost">Chiqish</button></form>`,
      ),
  );
}

// ------------------------------------------------------------------ kirish

export function loginPage(error = ''): string {
  return page(
    { title: 'Kirish', path: '/kirish' },
    card(
      'Kalit so‘z',
      `${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
      <form method="post" action="/kirish" class="row">
        <input type="password" name="token" placeholder="HAMROH_WEB_TOKEN" required autofocus/>
        <button>Kirish</button>
      </form>
      <div class="note" style="margin-top:12px">Kalit <code>.env</code> dagi <code>HAMROH_WEB_TOKEN</code> qiymati.</div>`,
    ),
  );
}
