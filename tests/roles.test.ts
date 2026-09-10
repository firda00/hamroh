import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/core/db.ts';
import { loadConfig } from '../src/core/config.ts';
import type { Ctx } from '../src/core/types.ts';
import { rulesProvider } from '../src/llm/rules.ts';
import { disabledStt } from '../src/stt/provider.ts';
import { disabledTts } from '../src/tts/provider.ts';
import { disabledTel } from '../src/tel/provider.ts';
import { disabledSms } from '../src/sms/provider.ts';
import { disabledGcal } from '../src/gcal/client.ts';
import type { RolePack, WorkflowStep } from '../src/roles/types.ts';
import { validatePack, resolvePermission } from '../src/roles/types.ts';
import { record, verifyChain, hashEvent, GENESIS, recent } from '../src/roles/audit.ts';
import { runStep, runWorkflow, approve, reject, pendingApprovals, commandExists, slotFor } from '../src/roles/runner.ts';
import { judge, attainmentOf, evaluateKpi, evaluateAll, scoreOf, formatKpi } from '../src/roles/kpi.ts';
import { packs, byRoleId, checkPacks } from '../src/roles/index.ts';
import { marketingEmployee } from '../src/roles/packs/marketing-employee.ts';
import { rolesModule, isActive } from '../src/modules/roles.ts';

function ctxFor(): Ctx {
  process.env['HAMROH_DB'] = ':memory:';
  const cfg = { ...loadConfig(), dbPath: ':memory:', offline: true, tz: 'Asia/Tashkent' };
  return {
    cfg,
    db: openDb(':memory:'),
    llm: rulesProvider(),
    stt: disabledStt(),
    tts: disabledTts(),
    tel: disabledTel(),
    sms: disabledSms(),
    gcal: disabledGcal(),
    now: new Date('2026-09-09T06:00:00.000Z'), // seshanba
  };
}

const cmd = (name: string) => {
  const c = rolesModule.commands.find((x) => x.name === name);
  if (!c) throw new Error(`buyruq yo‘q: ${name}`);
  return c;
};

/** Sinov uchun kichik paket: haqiqiy buyruqlarga tayanadi, lekin qisqa. */
function testPack(over: Partial<RolePack> = {}): RolePack {
  return {
    id: 'sinov-roli',
    name: 'Sinov roli',
    version: 'v1',
    mission: 'Sinov uchun ishlatiladigan qisqa paket',
    does: ['sinov'],
    doesNot: ['boshqa hech narsa'],
    permissions: [
      { action: 'lid:funnel', mode: 'auto', why: 'faqat o‘qiydi' },
      { action: 'kalendar:add', mode: 'approval', why: 'kalendarga yozadi' },
      { action: 'aloqa:*', mode: 'deny', why: 'SMS bu rolning ishi emas' },
    ],
    workflow: [{ id: 'voronka', title: 'Voronka', action: 'lid:funnel', produces: 'statistika' }],
    kpis: [],
    ...over,
  };
}

const DENIED_STEP: WorkflowStep = {
  id: 'sms',
  title: 'SMS yuborish',
  action: 'aloqa:sms',
  args: ['+998901234567', 'salom'],
  produces: 'SMS',
};

// ------------------------------------------------------------------ paket

test('rol: production paketi toza — buyruqlar mavjud, qadamlar ruxsatli', () => {
  assert.deepEqual(checkPacks(), [], 'paketlarda muammo bo‘lmasligi kerak');
  assert.equal(packs.length >= 1, true);
  assert.equal(byRoleId('marketing-employee')?.name, 'NEMO Marketing Employee');
});

test('rol: tekshiruv mavjud bo‘lmagan buyruqni ushlaydi', () => {
  const bad = testPack({
    permissions: [{ action: 'yoq_modul:yoq_buyruq', mode: 'auto', why: 'sinov uchun' }],
    workflow: [{ id: 'x', title: 'X', action: 'yoq_modul:yoq_buyruq', produces: 'hech narsa' }],
  });
  const problems = validatePack(bad, commandExists);
  assert.ok(problems.some((p) => p.includes('bunday buyruq yo‘q')), problems.join(' | '));
});

test('rol: ruxsatsiz qadam paket darajasida ushlanadi', () => {
  // Eng oson yo'qotiladigan xato: ish oqimiga qadam qo'shildi, ruxsat unutildi.
  const bad = testPack({
    workflow: [{ id: 'sms', title: 'SMS', action: 'telegram:send', produces: 'xabar' }],
  });
  const problems = validatePack(bad, commandExists);
  assert.ok(problems.some((p) => p.includes('ruxsat ro‘yxatida yo‘q')), problems.join(' | '));
});

test('rol: aniq ruxsat modul darajasidan ustun, qolgani taqiq', () => {
  const pack = testPack({
    permissions: [
      { action: 'marketing:*', mode: 'approval', why: 'butun modul tasdiq bilan' },
      { action: 'marketing:report', mode: 'auto', why: 'hisobot xavfsiz' },
      { action: 'aloqa:*', mode: 'deny', why: 'taqiq' },
    ],
    workflow: [{ id: 'r', title: 'R', action: 'marketing:report', produces: 'fayl' }],
  });

  assert.equal(resolvePermission(pack, 'marketing:report').mode, 'auto', 'aniq mos ustun turadi');
  assert.equal(resolvePermission(pack, 'marketing:sync').mode, 'approval', 'modul darajasi');
  assert.equal(resolvePermission(pack, 'aloqa:sms').mode, 'deny');

  // Ro'yxatda umuman yo'q — standart taqiq
  const unknown = resolvePermission(pack, 'moliya:kirim');
  assert.equal(unknown.mode, 'deny');
  assert.match(unknown.rule, /standart/);
});

test('rol: marketing paketi pulga va SMS ga tegmaydi', () => {
  // Bu mijozga beriladigan asosiy kafolat — test bilan mahkamlanadi.
  for (const action of ['moliya:kirim', 'moliya:chiqim', 'aloqa:sms', 'qongiroq:qil', 'navlar:yoq', 'sozlash:start']) {
    assert.equal(
      resolvePermission(marketingEmployee, action).mode,
      'deny',
      `${action} taqiqlangan bo‘lishi kerak`,
    );
  }
  // Tashqariga chiqadigan amallar — faqat tasdiq bilan
  for (const action of ['telegram:send', 'telegram:file', 'kalendar:add']) {
    assert.equal(resolvePermission(marketingEmployee, action).mode, 'approval', action);
  }
});

// ------------------------------------------------------------------ jurnal

test('rol: jurnal zanjiri quriladi va tekshiriladi', () => {
  const ctx = ctxFor();
  try {
    const a = record(ctx.db, ctx.now, { role: 'r', actor: 'agent', event: 'bir' });
    const b = record(ctx.db, ctx.now, { role: 'r', actor: 'odam', event: 'ikki', subject: 's' });

    assert.equal(a.prev_hash, GENESIS, 'birinchi yozuv genesis dan boshlanadi');
    assert.equal(b.prev_hash, a.hash, 'ikkinchi birinchiga bog‘lanadi');
    assert.equal(verifyChain(ctx.db).ok, true);
    assert.equal(verifyChain(ctx.db).checked, 2);
  } finally {
    ctx.db.close();
  }
});

test('rol: yozuv o‘zgartirilsa zanjir buzilganini ko‘rsatadi', () => {
  const ctx = ctxFor();
  try {
    record(ctx.db, ctx.now, { role: 'r', actor: 'agent', event: 'bir' });
    record(ctx.db, ctx.now, { role: 'r', actor: 'odam', event: 'tasdiq.berildi' });
    record(ctx.db, ctx.now, { role: 'r', actor: 'agent', event: 'uch' });

    // Tasdiqni «odam berdi» dan «agent berdi» ga o'zgartiramiz — eng xavfli soxtalashtirish
    ctx.db.run(`UPDATE audit_events SET actor='agent' WHERE event='tasdiq.berildi'`);

    const check = verifyChain(ctx.db);
    assert.equal(check.ok, false);
    assert.equal(check.brokenAt?.event, 'tasdiq.berildi');
    assert.match(String(check.brokenAt?.reason), /mazmuni o‘zgartirilgan/);
  } finally {
    ctx.db.close();
  }
});

test('rol: yozuv o‘chirilsa ham zanjir buzilganini ko‘rsatadi', () => {
  const ctx = ctxFor();
  try {
    record(ctx.db, ctx.now, { role: 'r', actor: 'agent', event: 'bir' });
    record(ctx.db, ctx.now, { role: 'r', actor: 'agent', event: 'ikki' });
    record(ctx.db, ctx.now, { role: 'r', actor: 'agent', event: 'uch' });

    ctx.db.run(`DELETE FROM audit_events WHERE event='ikki'`);

    const check = verifyChain(ctx.db);
    assert.equal(check.ok, false);
    assert.match(String(check.brokenAt?.reason), /o‘chirilgan|o‘zgartirilgan/);
  } finally {
    ctx.db.close();
  }
});

test('rol: hash maydonlar tartibiga bog‘liq', () => {
  const base = { ts: 't', role: 'r', actor: 'agent', event: 'e', subject: 'a', detail: 'b' };
  const swapped = { ...base, subject: 'b', detail: 'a' };
  assert.notEqual(hashEvent(GENESIS, base), hashEvent(GENESIS, swapped), 'joyi almashsa hash boshqa bo‘lishi kerak');
});

// ------------------------------------------------------------------ bajarish

test('rol: auto qadam bajariladi va jurnalga tushadi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const out = await runStep(ctx, pack, pack.workflow[0]!);
    assert.equal(out.status, 'bajarildi', out.summary);

    const events = recent(ctx.db, 10, pack.id).map((e) => e.event);
    assert.ok(events.includes('qadam.boshlandi'));
    assert.ok(events.includes('amal.bajarildi'));
    assert.ok(events.includes('qadam.bajarildi'));
    assert.equal(verifyChain(ctx.db).ok, true);
  } finally {
    ctx.db.close();
  }
});

test('rol: taqiqlangan amal BAJARILMAYDI', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const out = await runStep(ctx, pack, DENIED_STEP);

    assert.equal(out.status, 'bloklandi');
    // Eng muhimi: SMS navbatiga hech narsa tushmagan bo'lishi kerak
    const smsQueue = ctx.db.all(`SELECT * FROM messages WHERE media_kind IS NULL`);
    assert.equal(smsQueue.length, 0, 'taqiq amalni to‘xtatishi kerak, log qilib qo‘yish emas');

    const events = recent(ctx.db, 10, pack.id).map((e) => e.event);
    assert.ok(events.includes('ruxsat.rad_etildi'));
    assert.equal(events.includes('amal.bajarildi'), false, 'bajarilmagan bo‘lishi kerak');
  } finally {
    ctx.db.close();
  }
});

test('rol: tasdiq talab qiladigan amal navbatga tushadi, bajarilmaydi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const step: WorkflowStep = {
      id: 'uchrashuv',
      title: 'Uchrashuv',
      action: 'kalendar:add',
      args: ['Sinov', '--at=ertaga 10:00'],
      produces: 'kalendarda yozuv',
    };
    const out = await runStep(ctx, pack, step);

    assert.equal(out.status, 'tasdiq_kutmoqda');
    assert.ok(out.approvalId);
    assert.equal(ctx.db.all('SELECT * FROM events').length, 0, 'tasdiqsiz yozilmasligi kerak');
    assert.equal(pendingApprovals(ctx, pack.id).length, 1);

    // Ikkinchi marta chaqirilsa yangi so'rov yaratilmaydi
    const again = await runStep(ctx, pack, step, { force: true });
    assert.equal(again.approvalId, out.approvalId, 'takroriy so‘rov yaratilmasin');
    assert.equal(pendingApprovals(ctx, pack.id).length, 1);
  } finally {
    ctx.db.close();
  }
});

test('rol: tasdiqdan keyin aynan o‘sha amal bajariladi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const step: WorkflowStep = {
      id: 'uchrashuv',
      title: 'Uchrashuv',
      action: 'kalendar:add',
      args: ['Marketing sharhi', '--at=ertaga 10:00', '--dur=45'],
      produces: 'kalendarda yozuv',
    };
    const held = await runStep(ctx, pack, step);
    const out = await approve(ctx, pack, held.approvalId!, 'Firdavs');

    assert.equal(out.status, 'bajarildi', out.summary);
    const events = ctx.db.all<{ title: string }>('SELECT title FROM events');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.title, 'Marketing sharhi', 'ko‘rgan narsangiz bajarilishi kerak');

    const log = recent(ctx.db, 20, pack.id);
    assert.ok(log.some((e) => e.event === 'tasdiq.berildi' && e.actor === 'odam'));
    assert.equal(verifyChain(ctx.db).ok, true);

    // Ikkinchi marta tasdiqlab bo'lmaydi
    await assert.rejects(() => approve(ctx, pack, held.approvalId!, 'Firdavs'), /hal qilingan/);
  } finally {
    ctx.db.close();
  }
});

test('rol: rad etilgan amal bajarilmaydi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const step: WorkflowStep = {
      id: 'uchrashuv',
      title: 'Uchrashuv',
      action: 'kalendar:add',
      args: ['Sinov', '--at=ertaga 10:00'],
      produces: 'yozuv',
    };
    const held = await runStep(ctx, pack, step);
    const out = reject(ctx, pack, held.approvalId!, 'Firdavs', 'hozir kerak emas');

    assert.equal(out.status, 'rad_etildi');
    assert.equal(ctx.db.all('SELECT * FROM events').length, 0);
    assert.ok(recent(ctx.db, 10, pack.id).some((e) => e.event === 'tasdiq.rad_etildi'));
  } finally {
    ctx.db.close();
  }
});

test('rol: paket taqiqqa o‘zgarsa, navbatdagi so‘rov ham bajarilmaydi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const step: WorkflowStep = {
      id: 'uchrashuv',
      title: 'Uchrashuv',
      action: 'kalendar:add',
      args: ['Sinov', '--at=ertaga 10:00'],
      produces: 'yozuv',
    };
    const held = await runStep(ctx, pack, step);

    // Paket yangilandi: endi kalendarga yozish taqiqlangan
    const tightened = testPack({
      permissions: [{ action: 'kalendar:add', mode: 'deny', why: 'endi taqiqlangan' }],
    });
    const out = await approve(ctx, tightened, held.approvalId!, 'Firdavs');

    assert.equal(out.status, 'bloklandi', 'eski navbat yangi taqiqni aylanib o‘tmasligi kerak');
    assert.equal(ctx.db.all('SELECT * FROM events').length, 0);
  } finally {
    ctx.db.close();
  }
});

test('rol: buyruq ish qilmasa «bajarildi» deb yozilmaydi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const step: WorkflowStep = {
      id: 'voronka',
      title: 'Voronka',
      action: 'lid:funnel',
      produces: 'statistika',
      verify: () => 'kutilgan natija chiqmadi',
    };
    const out = await runStep(ctx, pack, step);
    assert.equal(out.status, 'xato');
    assert.match(out.summary, /kutilgan natija chiqmadi/);
  } finally {
    ctx.db.close();
  }
});

test('rol: bir uyada ish takrorlanmaydi, --force esa qayta bajaradi', async () => {
  const ctx = ctxFor();
  try {
    const pack = testPack();
    const step = pack.workflow[0]!;

    assert.equal((await runStep(ctx, pack, step)).status, 'bajarildi');
    assert.equal((await runStep(ctx, pack, step)).status, 'o‘tkazildi', 'ikkinchi marta ishlamasin');
    assert.equal((await runStep(ctx, pack, step, { force: true })).status, 'bajarildi');
  } finally {
    ctx.db.close();
  }
});

test('rol: haftalik qadam dushanba uyasiga tushadi', () => {
  const weekly: WorkflowStep = { id: 'w', title: 'W', action: 'lid:funnel', produces: 'x', weekly: true };
  const daily: WorkflowStep = { id: 'd', title: 'D', action: 'lid:funnel', produces: 'x' };
  const tz = 'Asia/Tashkent';

  const tue = new Date('2026-09-09T06:00:00Z');
  const thu = new Date('2026-09-11T06:00:00Z');
  assert.equal(slotFor(weekly, tue, tz), slotFor(weekly, thu, tz), 'bir hafta ichida uya bir xil');
  assert.notEqual(slotFor(daily, tue, tz), slotFor(daily, thu, tz), 'kunlik uya har kuni boshqa');
  assert.match(slotFor(weekly, tue, tz), /^H2026-09-07$/);
});

// --------------------------------------------------------------------- KPI

test('rol: KPI bahosi yo‘nalishni hisobga oladi', () => {
  // Kam bo'lgani yaxshi (CPL)
  assert.equal(judge(40_000, 50_000, 'down'), 'yaxshi');
  assert.equal(judge(53_000, 50_000, 'down'), 'chegarada');
  assert.equal(judge(80_000, 50_000, 'down'), 'yomon');
  // Ko'p bo'lgani yaxshi (lidlar)
  assert.equal(judge(50, 40, 'up'), 'yaxshi');
  assert.equal(judge(37, 40, 'up'), 'chegarada');
  assert.equal(judge(10, 40, 'up'), 'yomon');
  // Ma'lumot yo'q — nol emas
  assert.equal(judge(null, 40, 'up'), 'ma’lumot yo‘q');

  assert.equal(attainmentOf(20, 40, 'up'), 50);
  assert.equal(attainmentOf(25_000, 50_000, 'down'), 200, 'arzonroq — maqsaddan yaxshiroq');
  assert.equal(attainmentOf(null, 40, 'up'), null);
});

test('rol: kichik va kasrli KPI qiymatlari yo‘qolmaydi', () => {
  // compact() 0.45 ni «0» qilib yuborardi — CTR umuman ko‘rinmay qolardi.
  assert.equal(formatKpi(0.45, '%'), '0.45 %');
  assert.equal(formatKpi(1.5, '%'), '1.50 %');
  assert.equal(formatKpi(12.34, '%'), '12.3 %');
  assert.equal(formatKpi(35, 'ta'), '35 ta');
  assert.equal(formatKpi(67_500, 'so‘m'), '67.5 ming so‘m');
  assert.equal(formatKpi(2_400_000, 'so‘m'), '2.4 mln so‘m');
  assert.equal(formatKpi(null, 'ta'), 'ma’lumot yo‘q');
});

test('rol: nol qiymat cheksizlikka aylanmaydi', () => {
  // «Ma’lumot yangiligi 0 soat» — mukammal natija, xato emas.
  assert.equal(attainmentOf(0, 26, 'down'), 999);
  assert.equal(attainmentOf(0, 40, 'up'), 0);
  // Juda yaxshi natija ham chegaralanadi — jadval buzilmasin
  assert.equal(attainmentOf(1, 50_000, 'down'), 999);
});

test('rol: o‘lchov yiqilsa butun hisobot yiqilmaydi', () => {
  const ctx = ctxFor();
  try {
    const result = evaluateKpi(
      ctx,
      {
        id: 'buzuq',
        title: 'Buzuq o‘lchov',
        unit: 'ta',
        target: 10,
        direction: 'up',
        why: 'sinov',
        measure: () => {
          throw new Error('baza yiqildi');
        },
      },
      '2026-09-01',
      '2026-09-07',
    );
    assert.equal(result.value, null);
    assert.equal(result.verdict, 'ma’lumot yo‘q');
  } finally {
    ctx.db.close();
  }
});

test('rol: KPI ma’lumotsiz nol o‘ylab topmaydi', () => {
  const ctx = ctxFor();
  try {
    const results = evaluateAll(ctx, marketingEmployee, '2026-09-01', '2026-09-07');
    // Bo'sh bazada hamma ko'rsatkich «ma'lumot yo'q» bo'lishi kerak — nol emas
    assert.equal(
      results.every((r) => r.value === null),
      true,
      JSON.stringify(results.map((r) => [r.id, r.value])),
    );
    assert.equal(scoreOf(results).percent, null, 'baho berish uchun asos yo‘q');
  } finally {
    ctx.db.close();
  }
});

test('rol: KPI haqiqiy raqamlardan hisoblanadi', () => {
  const ctx = ctxFor();
  try {
    const put = (metric: string, value: number, date = '2026-09-05'): void => {
      ctx.db.run(
        `INSERT INTO marketing_metrics(date, platform, metric, value, account) VALUES(?,?,?,?,'main')`,
        date,
        'google_ads',
        metric,
        value,
      );
    };
    put('cost', 900_000);
    put('leads', 30);
    put('clicks', 300);
    put('views', 20_000);
    put('reach', 10_000);

    const results = evaluateAll(ctx, marketingEmployee, '2026-09-01', '2026-09-07');
    const by = (id: string) => results.find((r) => r.id === id);

    assert.equal(by('cpl')?.value, 30_000, '900 000 / 30');
    assert.equal(by('cpl')?.verdict, 'yaxshi', 'maqsad 50 000 dan arzon');
    assert.equal(by('lidlar')?.value, 30);
    assert.equal(by('qamrov')?.value, 30_000, 'reach + views');
    assert.equal(by('ctr')?.value, 1, '300 / 30 000');
    assert.equal(by('ctr')?.verdict, 'yomon', 'maqsad 1.5%');
  } finally {
    ctx.db.close();
  }
});

// ------------------------------------------------------------------- modul

test('rol: modul buyruqlari ishlaydi', async () => {
  const ctx = ctxFor();
  try {
    const list = await cmd('list').run(ctx, []);
    assert.match(list.text, /NEMO Marketing Employee/);

    const view = await cmd('korish').run(ctx, ['marketing-employee']);
    assert.match(view.text, /QILADI/);
    assert.match(view.text, /QILMAYDI/);
    assert.match(view.text, /moliya/, 'taqiqlar ham ko‘rinishi kerak');

    assert.equal(isActive(ctx, 'marketing-employee'), false);
    await cmd('yoq').run(ctx, ['marketing-employee']);
    assert.equal(isActive(ctx, 'marketing-employee'), true);
    assert.ok(recent(ctx.db, 5).some((e) => e.event === 'rol.yoqildi' && e.actor === 'odam'));

    await cmd('ochir').run(ctx, ['marketing-employee']);
    assert.equal(isActive(ctx, 'marketing-employee'), false);

    const audit = await cmd('audit').run(ctx, []);
    assert.match(audit.text, /Zanjir butun/);
  } finally {
    ctx.db.close();
  }
});

test('rol: noma’lum rol tushunarli xato beradi', () => {
  const ctx = ctxFor();
  try {
    assert.throws(() => cmd('korish').run(ctx, ['yoq-bunday-rol']), /Bunday rol yo‘q/);
  } finally {
    ctx.db.close();
  }
});

test('rol: har bir jadvalli qadam alohida job bo‘ladi', () => {
  const jobs = rolesModule.jobs ?? [];
  const scheduled = marketingEmployee.workflow.filter((s) => s.cron);
  assert.equal(jobs.length, scheduled.length, 'qadam va job soni mos kelishi kerak');
  for (const step of scheduled) {
    const job = jobs.find((j) => j.name === `rol.marketing-employee.${step.id}`);
    assert.ok(job, `${step.id} uchun job yo‘q`);
    assert.equal(job?.cron, step.cron, `${step.id}: jadval mos emas`);
  }
});

test('rol: o‘chiq rol jadval bo‘yicha ishlamaydi', async () => {
  const ctx = ctxFor();
  try {
    const job = (rolesModule.jobs ?? []).find((j) => j.name === 'rol.marketing-employee.raqamlar');
    assert.ok(job);
    assert.match(await job!.run(ctx), /o‘chiq/);
    assert.equal(ctx.db.all('SELECT * FROM role_runs').length, 0, 'o‘chiq rol iz qoldirmasin');
  } finally {
    ctx.db.close();
  }
});

test('rol: to‘liq ish oqimi — auto bajariladi, tashqi amal to‘xtaydi', async () => {
  const ctx = ctxFor();
  try {
    const outcomes = await runWorkflow(ctx, marketingEmployee, { force: true });
    const byStep = new Map(outcomes.map((o) => [o.step, o]));

    // Ichki ishlar o'zi bajariladi
    for (const id of ['raqamlar', 'voronka', 'hisobot']) {
      assert.equal(byStep.get(id)?.status, 'bajarildi', `${id}: ${byStep.get(id)?.summary}`);
    }
    // Tashqariga chiqadiganlari to'xtaydi
    for (const id of ['uchrashuv', 'yuborish']) {
      assert.equal(byStep.get(id)?.status, 'tasdiq_kutmoqda', id);
    }
    assert.equal(pendingApprovals(ctx, 'marketing-employee').length, 2);
    // Hech narsa tashqariga chiqmagan
    assert.equal(ctx.db.all('SELECT * FROM events').length, 0);
    assert.equal(verifyChain(ctx.db).ok, true);
  } finally {
    ctx.db.close();
  }
});
